"""Typed tool definitions, OpenAI/Groq schemas, and glass-box execution tracer."""

import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any

import httpx

from api.models.schemas import ActivityType, DoseRequest, MaskFit, MaskType, PersonaType
from api.services.dose_engine import calculate_dose
from api.services.iaq_engine import find_optimal_ventilation_window
from api.services.inversion_detector import analyze_inversion_series
from api.services.open_meteo import DEMO_CITIES, fetch_atmospheric_bundle, geocode_city
from api.services.openaq import calibrate_with_openaq
from api.services.route_scorer import compare_clean_air_routes as score_routes
from api.services.schedule_solver import TaskItem, solve_schedule

logger = logging.getLogger("aether.ai_agent")

DEFAULT_LAT = 28.6139
DEFAULT_LON = 77.2090


def build_system_prompt(
    city_name: str = "Delhi",
    lat: float = DEFAULT_LAT,
    lon: float = DEFAULT_LON,
    persona: str = "healthy_adult",
) -> str:
    """Construct authoritative system prompt with injected active location and persona."""
    return (
        "You are Aether v2, an authoritative clinical and atmospheric health co-pilot.\n"
        f"Active Location: {city_name} ({lat}, {lon}) | Active Persona: {persona}\n\n"
        "CRITICAL MANDATES:\n"
        "1. NEVER ask the user for their city or coordinates if Active Location is already provided; "
        "immediately call your tools using those coordinates.\n"
        "2. You must NEVER invent, hallucinate, or estimate numbers. You MUST ALWAYS call the "
        "provided tools and cite the exact figures returned by the tool outputs (such as PM2.5 "
        "concentrations in µg/m³, Ventilation Index in m²/s, inhaled dose in µg, WHO reference "
        "budget percentages, and optimal schedule slots).\n"
        "3. Be concise, scientific, clinical, and directly actionable."
    )


SYSTEM_PROMPT: str = build_system_prompt()


async def fetch_atmospheric_state(city_or_coords: str = "Delhi") -> dict[str, Any]:
    """Fetch live CAMS atmospheric forecast and OpenAQ ground calibration."""
    city_str = city_or_coords.strip() if city_or_coords else "Delhi"
    lat, lon = DEFAULT_LAT, DEFAULT_LON

    if city_str in DEMO_CITIES:
        lat = DEMO_CITIES[city_str]["lat"]
        lon = DEMO_CITIES[city_str]["lon"]
    elif "," in city_str:
        try:
            parts = city_str.split(",")
            lat, lon = float(parts[0]), float(parts[1])
        except (ValueError, IndexError):
            lat, lon = DEFAULT_LAT, DEFAULT_LON
    else:
        results = await geocode_city(city_str)
        if results:
            lat = results[0]["lat"]
            lon = results[0]["lon"]

    bundle = await fetch_atmospheric_bundle(lat, lon)
    openaq_cal = await calibrate_with_openaq(lat, lon)
    aq_hourly = bundle.get("air_quality", {}).get("hourly", {})
    weather_hourly = bundle.get("weather", {}).get("hourly", {})

    def _first(series: list[Any], default: float) -> float:
        return float(series[0]) if series and series[0] is not None else default

    return {
        "city_or_coords": city_str,
        "latitude": lat,
        "longitude": lon,
        "current_pm25_ug_m3": round(_first(aq_hourly.get("pm2_5", []), 50.0), 1),
        "current_no2_ug_m3": round(_first(aq_hourly.get("nitrogen_dioxide", []), 20.0), 1),
        "current_o3_ug_m3": round(_first(aq_hourly.get("ozone", []), 40.0), 1),
        "boundary_layer_height_m": round(_first(weather_hourly.get("boundary_layer_height", []), 500.0), 1),
        "wind_speed_kmh": round(_first(weather_hourly.get("wind_speed_10m", []), 8.0), 1),
        "blh_source": bundle.get("blh_source", "ecmwf_ifs_hres"),
        "openaq_calibrated": openaq_cal,
    }


async def simulate_inhaled_dose(
    pm25: float = 100.0,
    activity: str = "walking",
    duration_minutes: float = 60.0,
    mask: str = "none",
    mask_fit: str = "sealed",
    persona: str = "healthy_adult",
) -> dict[str, Any]:
    """Compute personalized inhaled dose, alveolar deposition, and clinical alerts."""
    act_map = {
        "walking": ActivityType.walking,
        "cycling": ActivityType.cycling,
        "running": ActivityType.running,
        "jog": ActivityType.running,
        "resting": ActivityType.resting,
    }
    act_enum = act_map.get(activity.lower(), ActivityType.walking)
    try:
        mask_enum = MaskType(mask.lower())
    except ValueError:
        mask_enum = MaskType.none
    try:
        fit_enum = MaskFit(mask_fit.lower())
    except ValueError:
        fit_enum = MaskFit.sealed
    try:
        persona_enum = PersonaType(persona.lower())
    except ValueError:
        persona_enum = PersonaType.healthy_adult

    req = DoseRequest(
        pm25_ug_m3=float(pm25),
        duration_hours=float(duration_minutes) / 60.0,
        activity=act_enum,
        persona=persona_enum,
        mask=mask_enum,
        mask_fit=fit_enum,
    )
    return calculate_dose(req).model_dump()


async def analyze_smog_trap(lat: float, lon: float) -> dict[str, Any]:
    """Analyze atmospheric boundary layer height and ventilation index."""
    bundle = await fetch_atmospheric_bundle(lat, lon)
    weather_hourly = bundle.get("weather", {}).get("hourly", {})
    inv = analyze_inversion_series(
        weather_hourly.get("time", []),
        weather_hourly.get("boundary_layer_height", []),
        weather_hourly.get("wind_speed_10m", []),
    )
    return inv.model_dump()


async def optimize_window_ventilation(lat: float, lon: float, has_hepa: bool = False) -> dict[str, Any]:
    """Scan daylight hours for the lowest PM2.5 natural indoor ventilation window."""
    bundle = await fetch_atmospheric_bundle(lat, lon)
    aq_hourly = bundle.get("air_quality", {}).get("hourly", {})
    window = find_optimal_ventilation_window(
        aq_hourly.get("time", []), aq_hourly.get("pm2_5", []), has_hepa=has_hepa
    )
    return window.model_dump()


async def optimize_daily_schedule(
    lat: float, lon: float, tasks: list[dict[str, Any]], persona: str = "healthy_adult"
) -> dict[str, Any]:
    """Deterministic, conflict-free 24-hour schedule optimizer."""
    bundle = await fetch_atmospheric_bundle(lat, lon)
    task_items = [
        TaskItem(
            name=t.get("name", "Task"),
            activity=t.get("activity", "walking"),
            duration_minutes=int(t.get("duration_minutes", 30)),
            earliest_hour=float(t.get("earliest_hour", 0.0)),
            latest_hour=float(t.get("latest_hour", 24.0)),
            mask=MaskType(t.get("mask", "none")) if isinstance(t.get("mask"), str) else t.get("mask", MaskType.none),
            mask_fit=(
                MaskFit(t.get("mask_fit", "sealed"))
                if isinstance(t.get("mask_fit"), str)
                else t.get("mask_fit", MaskFit.sealed)
            ),
        )
        for t in tasks
    ]
    return solve_schedule(tasks=task_items, forecast=bundle, persona=PersonaType(persona)).model_dump()


async def compare_clean_air_routes(
    origin: tuple[float, float],
    destination: tuple[float, float],
    mode: str = "walking",
    lat: float | None = None,
    lon: float | None = None,
    persona: str = "healthy_adult",
    mask: str = "none",
) -> dict[str, Any]:
    """Evaluate alternative transit routes with LUR road type and uphill steepness multipliers."""
    bg_pm25 = 100.0
    if lat is not None and lon is not None:
        bundle = await fetch_atmospheric_bundle(lat, lon)
        series = bundle.get("air_quality", {}).get("hourly", {}).get("pm2_5", [])
        if series and series[0] is not None:
            bg_pm25 = float(series[0])

    routes_res = await score_routes(
        origin=origin,
        destination=destination,
        mode=mode,
        background_pm25=bg_pm25,
        persona=PersonaType(persona),
        mask=MaskType(mask),
    )
    return routes_res.model_dump()


TOOL_REGISTRY: dict[str, Callable[..., Awaitable[dict[str, Any]]]] = {
    "fetch_atmospheric_state": fetch_atmospheric_state,
    "simulate_inhaled_dose": simulate_inhaled_dose,
    "analyze_smog_trap": analyze_smog_trap,
    "optimize_window_ventilation": optimize_window_ventilation,
    "optimize_daily_schedule": optimize_daily_schedule,
    "compare_clean_air_routes": compare_clean_air_routes,
}


def _schema(name: str, desc: str, props: dict[str, Any], req: list[str]) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": desc,
            "parameters": {"type": "object", "properties": props, "required": req},
        },
    }


GROQ_TOOLS: list[dict[str, Any]] = [
    _schema(
        "fetch_atmospheric_state",
        "Fetch live ambient PM2.5, NO2, O3, BLH, and OpenAQ calibration.",
        {"city_or_coords": {"type": "string", "description": "City name or 'lat,lon'"}},
        ["city_or_coords"],
    ),
    _schema(
        "simulate_inhaled_dose",
        "Calculate respiratory inhaled and deposited PM2.5 dose and WHO budget %.",
        {
            "pm25": {"type": "number"},
            "activity": {"type": "string", "enum": ["resting", "walking", "cycling", "running"]},
            "duration_minutes": {"type": "number"},
            "mask": {"type": "string", "enum": ["none", "cloth", "surgical", "n95"]},
            "mask_fit": {"type": "string", "enum": ["sealed", "loose"]},
            "persona": {
                "type": "string",
                "enum": [
                    "healthy_adult",
                    "asthma_copd",
                    "child_commute",
                    "endurance_athlete",
                    "elderly_cardio",
                ],
            },
        },
        ["pm25"],
    ),
    _schema(
        "analyze_smog_trap",
        "Detect atmospheric thermal inversion layer trapping and project lift hour.",
        {"lat": {"type": "number"}, "lon": {"type": "number"}},
        ["lat", "lon"],
    ),
    _schema(
        "optimize_window_ventilation",
        "Scan daylight hours for the cleanest 1-hour indoor ventilation window.",
        {"lat": {"type": "number"}, "lon": {"type": "number"}, "has_hepa": {"type": "boolean"}},
        ["lat", "lon"],
    ),
    _schema(
        "optimize_daily_schedule",
        "Compute conflict-free non-overlapping 24h schedule minimizing total inhaled dose.",
        {
            "lat": {"type": "number"},
            "lon": {"type": "number"},
            "tasks": {"type": "array", "items": {"type": "object"}},
            "persona": {"type": "string"},
        },
        ["lat", "lon", "tasks"],
    ),
    _schema(
        "compare_clean_air_routes",
        "Compare travel routes using Land-Use Regression and steepness multipliers.",
        {
            "origin": {"type": "array", "items": {"type": "number"}},
            "destination": {"type": "array", "items": {"type": "number"}},
            "mode": {"type": "string", "enum": ["walking", "cycling", "driving"]},
            "lat": {"type": "number"},
            "lon": {"type": "number"},
            "persona": {"type": "string"},
            "mask": {"type": "string"},
        },
        ["origin", "destination"],
    ),
]


async def execute_and_trace(
    tool_name: str, args: dict[str, Any], tool_trace: list[dict[str, Any]]
) -> dict[str, Any]:
    """Execute a registered tool and record glass-box latency and summary."""
    fn = TOOL_REGISTRY.get(tool_name)
    if fn is None:
        err_res: dict[str, Any] = {"error": f"Tool '{tool_name}' not found."}
        tool_trace.append({"tool_name": tool_name, "arguments": args, "latency_ms": 0.0, "result_summary": err_res})
        return err_res

    t0 = time.perf_counter()
    try:
        res = await fn(**args)
    except (ValueError, TypeError, KeyError, RuntimeError, AttributeError, httpx.HTTPError) as exc:
        logger.warning("Tool execution error in %s: %s", tool_name, exc)
        res = {"error": str(exc)}
    latency = round((time.perf_counter() - t0) * 1000.0, 1)

    summary: dict[str, Any] = {}
    for k, v in res.items():
        if isinstance(v, list) and len(v) > 2:
            summary[k] = f"{len(v)} items"
        elif isinstance(v, dict) and len(v) > 4:
            summary[k] = f"{len(v)} keys"
        else:
            summary[k] = v

    tool_trace.append({"tool_name": tool_name, "arguments": args, "latency_ms": latency, "result_summary": summary})
    return res
