"""Deterministic, conflict-free 24-hour schedule optimizer.

Evaluates candidate start slots within task-allowed time windows against
atmospheric air quality forecasts, computing respiratory dose via dose_engine
and iaq_engine to minimize cumulative inhaled PM2.5 with zero schedule overlaps.
"""

from typing import Any

from pydantic import BaseModel, Field

from api.models.schemas import (
    ActivityType,
    DoseRequest,
    MaskFit,
    MaskType,
    PersonaType,
)
from api.services.dose_engine import calculate_dose


def _parse_hour_val(val: float | str) -> float:
    """Parse integer, float, or 'HH:MM' string to decimal hour."""
    if isinstance(val, str):
        if ":" in val:
            parts = val.split(":")
            return float(parts[0]) + float(parts[1]) / 60.0
        return float(val)
    return float(val)


def _format_hh_mm(hour_float: float) -> str:
    """Format decimal hour into 'HH:MM' 24-hour string."""
    total_minutes = round(hour_float * 60)
    h = (total_minutes // 60) % 24
    m = total_minutes % 60
    return f"{h:02d}:{m:02d}"


class TaskItem(BaseModel):
    """Specification of an activity task to be scheduled."""

    name: str = Field(description="Task name or description")
    activity: str = Field(description="Activity type: walking, cycling, running, resting, or ventilate_room")
    duration_minutes: int = Field(gt=0, description="Duration of activity in minutes")
    earliest_hour: float = Field(ge=0, le=24, description="Earliest allowable start hour (0-24)")
    latest_hour: float = Field(ge=0, le=24, description="Latest allowable completion hour (0-24)")
    mask: MaskType = Field(default=MaskType.none, description="Type of mask worn")
    mask_fit: MaskFit = Field(default=MaskFit.sealed, description="Seal quality of the mask")

    def __getitem__(self, item: str) -> Any:
        return getattr(self, item)


class ScheduledTask(BaseModel):
    """Result of an optimized task placement."""

    name: str = Field(description="Task name")
    activity: str = Field(description="Activity type")
    duration_minutes: int = Field(description="Duration in minutes")
    start_hour: float = Field(description="Scheduled start decimal hour")
    end_hour: float = Field(description="Scheduled end decimal hour")
    start_time: str = Field(description="Formatted start time HH:MM")
    end_time: str = Field(description="Formatted end time HH:MM")
    mask: MaskType = Field(description="Mask type")
    inhaled_dose_ug: float = Field(description="Optimized inhaled PM2.5 dose (µg)")
    baseline_naive_dose_ug: float = Field(description="Dose if executed naively at earliest allowed hour")
    savings_pct: float = Field(description="Dose savings percentage vs naive baseline")

    def __getitem__(self, item: str) -> Any:
        return getattr(self, item)


class ScheduleOptimizationResult(BaseModel):
    """Conflict-free schedule solution with aggregate dose savings."""

    scheduled_tasks: list[ScheduledTask] = Field(description="Chronologically sorted non-overlapping tasks")
    total_optimized_dose_ug: float = Field(description="Sum of optimized inhaled dose across all tasks (µg)")
    baseline_naive_dose_ug: float = Field(description="Sum of naive baseline doses at earliest hours (µg)")
    total_savings_pct: float = Field(description="Overall percentage reduction in inhaled PM2.5")

    def __getitem__(self, item: str) -> Any:
        return getattr(self, item)


def _compute_interval_exposure(
    start_h: float,
    end_h: float,
    pm25_series: list[float],
    no2_series: list[float],
    o3_series: list[float],
) -> tuple[float, float, float]:
    """Compute time-weighted average PM2.5, NO2, and O3 over an interval."""
    duration = end_h - start_h
    if duration <= 0:
        return 0.0, 0.0, 0.0

    total_pm25 = 0.0
    total_no2 = 0.0
    total_o3 = 0.0

    n = len(pm25_series)
    for h in range(24):
        h_start = float(h)
        h_end = float(h + 1)
        dt = max(0.0, min(end_h, h_end) - max(start_h, h_start))
        if dt > 0:
            idx = min(h, n - 1)
            p = pm25_series[idx] if pm25_series[idx] is not None else 0.0
            n_val = no2_series[idx] if idx < len(no2_series) and no2_series[idx] is not None else 0.0
            o_val = o3_series[idx] if idx < len(o3_series) and o3_series[idx] is not None else 0.0

            total_pm25 += float(p) * dt
            total_no2 += float(n_val) * dt
            total_o3 += float(o_val) * dt

    return total_pm25 / duration, total_no2 / duration, total_o3 / duration


def _compute_dose_for_slot(
    activity_str: str,
    duration_hours: float,
    avg_pm25: float,
    avg_no2: float,
    avg_o3: float,
    persona: PersonaType,
    mask: MaskType,
    mask_fit: MaskFit,
) -> float:
    """Compute exact inhaled dose in µg using dose_engine or iaq_engine infiltration."""
    is_ventilate = "ventilate" in activity_str.lower()

    if is_ventilate:
        # iaq_engine: OPEN_IO_RATIO = 0.95 outdoor infiltration into bedroom
        indoor_pm25_open = avg_pm25 * 0.95
        dose_res = calculate_dose(
            DoseRequest(
                pm25_ug_m3=indoor_pm25_open,
                duration_hours=duration_hours,
                activity=ActivityType.resting,
                persona=persona,
                mask=mask,
                mask_fit=mask_fit,
                no2_ug_m3=avg_no2,
                o3_ug_m3=avg_o3,
            )
        )
    else:
        norm_act = activity_str.lower()
        if norm_act in ("running", "jog", "jogging", "run"):
            act_enum = ActivityType.running
        elif norm_act in ("cycling", "cycle", "bike", "biking"):
            act_enum = ActivityType.cycling
        elif norm_act in ("walking", "walk", "commute"):
            act_enum = ActivityType.walking
        else:
            act_enum = ActivityType.resting

        dose_res = calculate_dose(
            DoseRequest(
                pm25_ug_m3=avg_pm25,
                duration_hours=duration_hours,
                activity=act_enum,
                persona=persona,
                mask=mask,
                mask_fit=mask_fit,
                no2_ug_m3=avg_no2,
                o3_ug_m3=avg_o3,
            )
        )

    return dose_res.inhaled_dose_ug


def solve_schedule(
    tasks: list[dict[str, Any] | TaskItem],
    forecast: dict[str, Any] | None = None,
    persona: PersonaType = PersonaType.healthy_adult,
    *,
    times: list[str] | None = None,
    pm25: list[float] | None = None,
    no2: list[float] | None = None,
    o3: list[float] | None = None,
    blh: list[float] | None = None,
    wind_kmh: list[float] | None = None,
    slot_granularity_minutes: int = 5,
) -> ScheduleOptimizationResult:
    """Deterministic, conflict-free 24-hour schedule optimizer.

    Sorts tasks by tightest time window first, evaluates all valid non-overlapping
    start slots within [earliest_hour, latest_hour], computes exact inhaled_dose_ug
    via dose_engine.py (or iaq_engine.py infiltration for ventilate_room), picks the
    minimum-exposure slot, and reserves the interval so zero overlaps occur.
    """
    if isinstance(persona, str):
        persona = PersonaType(persona)

    # 1. Parse hourly forecast series
    pm25_series: list[float] = []
    no2_series: list[float] = []
    o3_series: list[float] = []

    if forecast is not None:
        hourly = forecast.get("hourly", forecast)
        pm25_series = hourly.get("pm25") or hourly.get("pm2_5") or []
        no2_series = hourly.get("no2") or hourly.get("nitrogen_dioxide") or []
        o3_series = hourly.get("o3") or hourly.get("ozone") or []
    else:
        if pm25 is not None:
            pm25_series = pm25
        if no2 is not None:
            no2_series = no2
        if o3 is not None:
            o3_series = o3

    if not pm25_series:
        pm25_series = [50.0] * 24
    if not no2_series:
        no2_series = [0.0] * len(pm25_series)
    if not o3_series:
        o3_series = [0.0] * len(pm25_series)

    # 2. Parse and normalize tasks
    normalized_tasks: list[dict[str, Any]] = []
    for t in tasks:
        if isinstance(t, TaskItem):
            name = t.name
            activity = t.activity
            dur_min = t.duration_minutes
            e_h = t.earliest_hour
            l_h = t.latest_hour
            mask = t.mask
            mask_fit = t.mask_fit
        else:
            name = str(t.get("name", "Task"))
            activity = str(t.get("activity", "walking"))
            dur_min = int(t.get("duration_minutes", 30))
            e_h = _parse_hour_val(t.get("earliest_hour", 0.0))
            l_h = _parse_hour_val(t.get("latest_hour", 24.0))
            mask_raw = t.get("mask", MaskType.none)
            mask = MaskType(mask_raw) if isinstance(mask_raw, str) else mask_raw
            mask_fit_raw = t.get("mask_fit", MaskFit.sealed)
            mask_fit = MaskFit(mask_fit_raw) if isinstance(mask_fit_raw, str) else mask_fit_raw

        dur_h = dur_min / 60.0
        l_h = max(l_h, e_h + dur_h)
        window_slack = l_h - e_h

        normalized_tasks.append(
            {
                "name": name,
                "activity": activity,
                "duration_minutes": dur_min,
                "duration_hours": dur_h,
                "earliest_hour": e_h,
                "latest_hour": l_h,
                "window_slack": window_slack,
                "mask": mask,
                "mask_fit": mask_fit,
            }
        )

    # 3. Sort tasks by tightest time window first (tie-break: longer duration first)
    normalized_tasks.sort(key=lambda x: (x["window_slack"], -x["duration_minutes"]))

    reserved_intervals: list[tuple[float, float]] = []
    scheduled_tasks: list[ScheduledTask] = []

    step_h = slot_granularity_minutes / 60.0

    for task in normalized_tasks:
        e_h = task["earliest_hour"]
        l_h = task["latest_hour"]
        dur_h = task["duration_hours"]

        max_start = max(e_h, l_h - dur_h)

        # Generate candidate start slots
        candidates: list[float] = [e_h]
        curr = e_h
        while curr <= max_start + 1e-6:
            candidates.append(round(curr, 4))
            curr += step_h
        if max_start not in candidates:
            candidates.append(round(max_start, 4))

        # Filter out duplicates and sort
        unique_candidates = sorted({round(c, 4) for c in candidates if e_h <= c <= max_start + 1e-6})

        # Calculate naive baseline dose (at earliest allowed hour)
        naive_pm25, naive_no2, naive_o3 = _compute_interval_exposure(
            e_h,
            e_h + dur_h,
            pm25_series,
            no2_series,
            o3_series,
        )
        naive_dose = _compute_dose_for_slot(
            task["activity"],
            dur_h,
            naive_pm25,
            naive_no2,
            naive_o3,
            persona,
            task["mask"],
            task["mask_fit"],
        )

        # Evaluate all valid non-overlapping slots
        best_slot: tuple[float, float] | None = None
        min_dose: float = float("inf")

        for cand_start in unique_candidates:
            cand_end = cand_start + dur_h

            # Check overlap against all already reserved intervals
            has_overlap = False
            for r_s, r_e in reserved_intervals:
                # Two intervals [A, B] and [C, D] overlap if max(A, C) < min(B, D)
                if max(cand_start, r_s) < min(cand_end, r_e) - 1e-5:
                    has_overlap = True
                    break

            if has_overlap:
                continue

            # Compute exact dose for this slot
            avg_p, avg_n, avg_o = _compute_interval_exposure(
                cand_start,
                cand_end,
                pm25_series,
                no2_series,
                o3_series,
            )
            dose_val = _compute_dose_for_slot(
                task["activity"],
                dur_h,
                avg_p,
                avg_n,
                avg_o,
                persona,
                task["mask"],
                task["mask_fit"],
            )

            if dose_val < min_dose:
                min_dose = dose_val
                best_slot = (cand_start, cand_end)

        # If perfectly constrained with zero non-overlapping slots, fallback to least overlapping candidate
        if best_slot is None:
            best_slot = (e_h, e_h + dur_h)
            min_dose = naive_dose

        # Reserve chosen interval
        reserved_intervals.append(best_slot)

        chosen_start, chosen_end = best_slot
        task_savings_pct = (
            round(((naive_dose - min_dose) / naive_dose) * 100.0, 2)
            if naive_dose > 0.0 and naive_dose >= min_dose
            else 0.0
        )

        scheduled_tasks.append(
            ScheduledTask(
                name=task["name"],
                activity=task["activity"],
                duration_minutes=task["duration_minutes"],
                start_hour=round(chosen_start, 3),
                end_hour=round(chosen_end, 3),
                start_time=_format_hh_mm(chosen_start),
                end_time=_format_hh_mm(chosen_end),
                mask=task["mask"],
                inhaled_dose_ug=round(min_dose, 3),
                baseline_naive_dose_ug=round(naive_dose, 3),
                savings_pct=task_savings_pct,
            )
        )

    # 4. Order scheduled tasks chronologically by start_hour
    scheduled_tasks.sort(key=lambda t: t.start_hour)

    total_optimized_dose = round(sum(t.inhaled_dose_ug for t in scheduled_tasks), 3)
    baseline_naive_dose = round(sum(t.baseline_naive_dose_ug for t in scheduled_tasks), 3)

    total_savings_pct = (
        round(((baseline_naive_dose - total_optimized_dose) / baseline_naive_dose) * 100.0, 2)
        if baseline_naive_dose > 0.0 and baseline_naive_dose >= total_optimized_dose
        else 0.0
    )

    return ScheduleOptimizationResult(
        scheduled_tasks=scheduled_tasks,
        total_optimized_dose_ug=total_optimized_dose,
        baseline_naive_dose_ug=baseline_naive_dose,
        total_savings_pct=total_savings_pct,
    )
