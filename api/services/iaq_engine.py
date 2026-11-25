"""Indoor air quality (IAQ) and ventilation window optimization engine."""

import logging
from datetime import datetime
from typing import Final

from api.models.schemas import VentilationWindowResponse

logger = logging.getLogger(__name__)

CLOSED_IO_RATIO: Final[float] = 0.55  # Indoor/outdoor infiltration ratio with closed windows
OPEN_IO_RATIO: Final[float] = 0.95  # Indoor/outdoor infiltration ratio with open windows
HEPA_REDUCTION: Final[float] = 0.60  # Fractional PM2.5 reduction with portable HEPA filter
DAYLIGHT_START_HOUR: Final[int] = 6  # Earliest daylight ventilation hour (06:00 local)
DAYLIGHT_END_HOUR: Final[int] = 22  # Latest daylight ventilation hour (22:00 local)
EXCELLENT_OUTDOOR_PM25_UG_M3: Final[float] = 15.0  # WHO 24h guideline PM2.5 threshold (µg/m³)
MODERATE_OUTDOOR_PM25_UG_M3: Final[float] = 35.0  # Brief cross-ventilation upper threshold (µg/m³)


def _format_readable_hour(iso_str: str | None) -> str:
    """Format an ISO timestamp like '2026-11-24T15:00:00' to human-readable '3:00 PM'."""
    if not iso_str:
        return "N/A"
    try:
        iso_clean = iso_str.replace("Z", "")
        dt = datetime.fromisoformat(iso_clean)
        return dt.strftime("%I:%M %p").lstrip("0")
    except ValueError as exc:
        logger.warning("Falling back to manual ISO hour parsing for %r: %s", iso_str, exc)
        if "T" in iso_str:
            time_part = iso_str.split("T")[-1]
            parts = time_part.split(":")
            h = int(parts[0])
            m = parts[1] if len(parts) > 1 else "00"
            period = "AM" if h < 12 else "PM"
            h12 = h % 12
            if h12 == 0:
                h12 = 12
            return f"{h12}:{m} {period}"
        return iso_str


def _parse_hour(time_str: str) -> int:
    """Extract integer hour from ISO string or time string."""
    try:
        if "T" in time_str:
            iso_clean = time_str.replace("Z", "")
            return datetime.fromisoformat(iso_clean).hour
        elif ":" in time_str:
            return int(time_str.split(":")[0])
        return int(time_str)
    except (ValueError, TypeError, IndexError):
        return 12  # fallback noon


def find_optimal_ventilation_window(
    hourly_times: list[str],
    hourly_pm25: list[float | None],
    has_hepa: bool = False,
) -> VentilationWindowResponse:
    """Scan daylight hours (06:00-22:00) for the lowest 1-hour outdoor PM2.5 window.

    Calculates expected indoor PM2.5 with closed vs open envelope conditions
    (applying HEPA reduction if present) and provides actionable ventilation advice.
    """
    if not hourly_times or not hourly_pm25:
        return VentilationWindowResponse(
            best_start_hour_iso=None,
            best_end_hour_iso=None,
            indoor_pm25_closed=0.0,
            indoor_pm25_open=0.0,
            outdoor_pm25_min=0.0,
            recommendation="Insufficient meteorological data to determine ventilation window.",
        )

    # Filter for daylight hours (06:00 to 22:00 inclusive) with valid PM2.5 readings
    daylight_indices: list[int] = []
    all_valid_indices: list[int] = []

    for i, t_str in enumerate(hourly_times):
        if i < len(hourly_pm25) and hourly_pm25[i] is not None:
            all_valid_indices.append(i)
            hour = _parse_hour(t_str)
            if DAYLIGHT_START_HOUR <= hour <= DAYLIGHT_END_HOUR:
                daylight_indices.append(i)

    # Fallback to all valid indices if daylight hours are not present
    candidate_indices = daylight_indices if daylight_indices else all_valid_indices

    if not candidate_indices:
        return VentilationWindowResponse(
            best_start_hour_iso=None,
            best_end_hour_iso=None,
            indoor_pm25_closed=0.0,
            indoor_pm25_open=0.0,
            outdoor_pm25_min=0.0,
            recommendation="No valid PM2.5 observations in the target window.",
        )

    # Find the index with the minimum PM2.5 concentration
    def _pm25_at(idx: int) -> float:
        val = hourly_pm25[idx]
        return float(val) if val is not None else float("inf")

    best_idx = min(candidate_indices, key=_pm25_at)
    outdoor_pm25_min = _pm25_at(best_idx)

    best_start = hourly_times[best_idx]
    best_end = hourly_times[best_idx + 1] if best_idx + 1 < len(hourly_times) else None

    # Calculate indoor infiltration
    closed_factor = CLOSED_IO_RATIO * (1.0 - HEPA_REDUCTION) if has_hepa else CLOSED_IO_RATIO
    indoor_pm25_closed = round(outdoor_pm25_min * closed_factor, 2)
    indoor_pm25_open = round(outdoor_pm25_min * OPEN_IO_RATIO, 2)

    # Formulate clinical/environmental recommendation
    start_readable = _format_readable_hour(best_start)
    if outdoor_pm25_min <= EXCELLENT_OUTDOOR_PM25_UG_M3:
        recommendation = (
            f"Excellent window for natural ventilation at {start_readable}. Outdoor PM2.5 drops to "
            f"{outdoor_pm25_min:.1f} µg/m³. Safe to air out indoor living spaces."
        )
    elif outdoor_pm25_min <= MODERATE_OUTDOOR_PM25_UG_M3:
        recommendation = (
            f"Moderate outdoor air quality at {start_readable} ({outdoor_pm25_min:.1f} µg/m³). Brief 15-minute "
            f"cross-ventilation permissible if indoor CO2 is elevated, then close windows."
        )
    else:
        hepa_note = " Continue running HEPA filtration." if has_hepa else " Consider indoor filtration."
        recommendation = (
            f"Outdoor air remains elevated ({outdoor_pm25_min:.1f} µg/m³). Keep windows tightly closed. "
            f"Opening windows would raise indoor PM2.5 to ~{indoor_pm25_open:.1f} µg/m³ vs "
            f"{indoor_pm25_closed:.1f} µg/m³ closed.{hepa_note}"
        )

    return VentilationWindowResponse(
        best_start_hour_iso=best_start,
        best_end_hour_iso=best_end,
        indoor_pm25_closed=indoor_pm25_closed,
        indoor_pm25_open=indoor_pm25_open,
        outdoor_pm25_min=round(outdoor_pm25_min, 2),
        recommendation=recommendation,
    )
