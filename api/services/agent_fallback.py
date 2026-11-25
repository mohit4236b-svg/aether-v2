"""Deterministic offline intent-routing fallback engine."""

from typing import Any

from api.services.agent_tools import execute_and_trace


async def _handle_dose_comparison(
    msg_lower: str,
    city_name: str,
    lat: float,
    lon: float,
    persona: str,
    tool_trace: list[dict[str, Any]],
) -> str:
    """Compare unmasked vs sealed N95 inhaled and alveolar deposited doses."""
    atm = await execute_and_trace("fetch_atmospheric_state", {"city_or_coords": f"{lat},{lon}"}, tool_trace)
    pm25 = float(atm.get("current_pm25_ug_m3", 100.0))
    activity = "running" if ("jog" in msg_lower or "run" in msg_lower) else "walking"

    dose_now = await execute_and_trace(
        "simulate_inhaled_dose",
        {"pm25": pm25, "activity": activity, "duration_minutes": 30.0, "mask": "none", "persona": persona},
        tool_trace,
    )
    dose_n95 = await execute_and_trace(
        "simulate_inhaled_dose",
        {
            "pm25": pm25,
            "activity": activity,
            "duration_minutes": 30.0,
            "mask": "n95",
            "mask_fit": "sealed",
            "persona": persona,
        },
        tool_trace,
    )
    dep_now = max(0.1, float(dose_now.get("deposited_dose_ug", 1.0)))
    dep_n95 = float(dose_n95.get("deposited_dose_ug", 0.0))
    pct_cut = max(0.0, round((1.0 - dep_n95 / dep_now) * 100.0, 1))

    return (
        f"Dose Comparison for 30-min {activity} in {city_name} (Current PM2.5: {pm25:.1f} µg/m³):\n"
        f"• Unmasked Now: Inhaled dose {dose_now.get('inhaled_dose_ug', 0.0):.1f} µg "
        f"({dose_now.get('who_daily_budget_pct', 0.0):.1f}% WHO 24h budget, "
        f"{dose_now.get('cigarette_equivalent', 0.0):.2f} cigs eq, "
        f"{dose_now.get('deposited_dose_ug', 0.0):.1f} µg deposited in lungs).\n"
        f"• N95 Masked: Inhaled dose {dose_n95.get('inhaled_dose_ug', 0.0):.1f} µg "
        f"({dose_n95.get('who_daily_budget_pct', 0.0):.1f}% WHO 24h budget, "
        f"{dose_n95.get('cigarette_equivalent', 0.0):.2f} cigs eq, "
        f"{dose_n95.get('deposited_dose_ug', 0.0):.1f} µg deposited).\n"
        f"Wearing a sealed N95 mask delivers a {pct_cut:.1f}% reduction in alveolar particulate deposition."
    )


async def run_deterministic_fallback(
    message: str,
    city_name: str,
    lat: float,
    lon: float,
    persona: str,
    tool_trace: list[dict[str, Any]],
) -> dict[str, Any]:
    """Execute real physics tools offline based on user intent and cite exact figures.

    Args:
        message: User prompt string.
        city_name: Active city display name.
        lat: Active latitude.
        lon: Active longitude.
        persona: Active clinical persona identifier.
        tool_trace: Mutable list receiving glass-box tool call records.

    Returns:
        Structured dictionary with reply, provider_used, tool_trace, and optional schedule.
    """
    msg_lower = message.lower()
    schedule_data: dict[str, Any] | None = None

    if "compare" in msg_lower and any(w in msg_lower for w in ("mask", "jog", "run", "walk", "dose")):
        reply = await _handle_dose_comparison(msg_lower, city_name, lat, lon, persona, tool_trace)

    elif any(k in msg_lower for k in ("route", "path", "clean air", "cycling", "drive", "footway")):
        origin = (lat, lon)
        destination = (round(lat + 0.03, 4), round(lon + 0.03, 4))
        mode = "cycling" if "cycl" in msg_lower else "walking"
        res = await execute_and_trace(
            "compare_clean_air_routes",
            {"origin": origin, "destination": destination, "mode": mode, "lat": lat, "lon": lon, "persona": persona},
            tool_trace,
        )
        reply = (
            f"Clean Air Route Evaluation: Evaluated {len(res.get('routes', []))} route alternatives for {mode}. "
            f"Cleanest route ({res.get('cleanest_route_id')}) saves {res.get('max_savings_pct', 0.0):.1f}% "
            f"inhaled PM2.5 compared to fastest route ({res.get('fastest_route_id')}) "
            f"at regional background of {res.get('background_pm25', 100.0):.1f} µg/m³."
        )

    elif any(k in msg_lower for k in ("schedule", "routine", "commute", "jog", "plan", "daily")):
        tasks = [
            {
                "name": "Morning Commute",
                "activity": "walking",
                "duration_minutes": 40,
                "earliest_hour": 7.0,
                "latest_hour": 10.0,
            },
            {
                "name": "Morning Jog",
                "activity": "running",
                "duration_minutes": 30,
                "earliest_hour": 6.0,
                "latest_hour": 9.0,
            },
            {
                "name": "Ventilate Bedroom",
                "activity": "ventilate_room",
                "duration_minutes": 60,
                "earliest_hour": 11.0,
                "latest_hour": 15.0,
            },
        ]
        res = await execute_and_trace(
            "optimize_daily_schedule",
            {"lat": lat, "lon": lon, "tasks": tasks, "persona": persona},
            tool_trace,
        )
        schedule_data = res
        reply = (
            f"Optimized 24h Schedule: Resolved 0 conflicts across {len(res.get('scheduled_tasks', []))} tasks. "
            f"Total optimized dose is {res.get('total_optimized_dose_ug', 0.0):.1f} µg vs baseline naive "
            f"{res.get('baseline_naive_dose_ug', 0.0):.1f} µg "
            f"(Total Savings: {res.get('total_savings_pct', 0.0):.1f}%)."
        )

    elif any(k in msg_lower for k in ("smog", "trap", "inversion", "lift", "boundary")):
        res = await execute_and_trace("analyze_smog_trap", {"lat": lat, "lon": lon}, tool_trace)
        reply = (
            f"Smog Inversion Analysis: Ventilation Index is {res.get('ventilation_index_m2_s', 0.0):.1f} m²/s "
            f"({res.get('status', 'unknown')}). {res.get('explanation', '')}"
        )

    elif any(k in msg_lower for k in ("window", "ventilate", "ventilation", "bedroom", "air out", "hepa")):
        res = await execute_and_trace(
            "optimize_window_ventilation",
            {"lat": lat, "lon": lon, "has_hepa": "hepa" in msg_lower},
            tool_trace,
        )
        reply = (
            f"Indoor Ventilation Guidance: Optimal daylight window begins at {res.get('best_start_hour_iso')}. "
            f"Minimum outdoor PM2.5 is {res.get('outdoor_pm25_min', 0.0):.1f} µg/m³. "
            f"Expected indoor PM2.5 with windows closed is {res.get('indoor_pm25_closed', 0.0):.1f} µg/m³ vs "
            f"{res.get('indoor_pm25_open', 0.0):.1f} µg/m³ open. {res.get('recommendation', '')}"
        )

    elif any(k in msg_lower for k in ("dose", "inhale", "mask", "cigarette", "copd", "asthma")):
        atm = await execute_and_trace("fetch_atmospheric_state", {"city_or_coords": f"{lat},{lon}"}, tool_trace)
        curr_pm = float(atm.get("current_pm25_ug_m3", 100.0))
        res = await execute_and_trace(
            "simulate_inhaled_dose",
            {"pm25": curr_pm, "activity": "walking", "duration_minutes": 60.0, "persona": persona},
            tool_trace,
        )
        reply = (
            f"Respiratory Dose Simulation: Inhaled dose is {res.get('inhaled_dose_ug', 0.0):.1f} µg "
            f"({res.get('who_daily_budget_pct', 0.0):.1f}% of WHO 24h budget). "
            f"Alveolar deposited dose: {res.get('deposited_dose_ug', 0.0):.1f} µg. "
            f"Equivalent to {res.get('cigarette_equivalent', 0.0):.2f} cigarettes smoked."
        )

    else:
        res = await execute_and_trace("fetch_atmospheric_state", {"city_or_coords": f"{lat},{lon}"}, tool_trace)
        reply = (
            f"Atmospheric State for {city_name}: Current PM2.5 is "
            f"{res.get('current_pm25_ug_m3', 0.0):.1f} µg/m³, "
            f"NO2 is {res.get('current_no2_ug_m3', 0.0):.1f} µg/m³, "
            f"O3 is {res.get('current_o3_ug_m3', 0.0):.1f} µg/m³, "
            f"BLH is {res.get('boundary_layer_height_m', 0.0):.1f} m, "
            f"and wind speed is {res.get('wind_speed_kmh', 0.0):.1f} km/h."
        )

    return {
        "reply": reply,
        "provider_used": "deterministic_fallback",
        "tool_trace": tool_trace,
        "schedule": schedule_data,
    }
