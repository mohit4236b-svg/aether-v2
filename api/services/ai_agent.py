"""Glass-Box Agentic Co-Pilot with 6 typed tools and Dual-LLM Failover.

Primary: google-genai SDK (gemini-2.5-flash) with native function calling.
Automatic Failover: Groq (openai/gpt-oss-120b / openai/gpt-oss-20b) on missing key, 429, 5xx, or timeout.
Deterministic Fallback: Offline local execution citing exact figures from real tools.
"""

import json
import logging
import os
import time
from typing import Any

import httpx

from api.models.schemas import MaskFit, MaskType, PersonaType
from api.services.dose_engine import calculate_dose
from api.services.iaq_engine import find_optimal_ventilation_window
from api.services.inversion_detector import analyze_inversion_series
from api.services.open_meteo import DEMO_CITIES, fetch_atmospheric_bundle, geocode_city
from api.services.openaq import calibrate_with_openaq
from api.services.route_scorer import compare_clean_air_routes as score_routes
from api.services.schedule_solver import TaskItem, solve_schedule

logger = logging.getLogger("aether.ai_agent")

SYSTEM_PROMPT: str = """You are Aether v2, an authoritative clinical and atmospheric health co-pilot.
CRITICAL MANDATE: You must NEVER invent, hallucinate, or estimate numbers. You MUST ALWAYS call the provided tools and cite the exact figures returned by the tool outputs (such as PM2.5 concentrations in µg/m³, Ventilation Index in m²/s, inhaled dose in µg, WHO reference budget percentages, and optimal schedule slots).
Be concise, scientific, clinical, and directly actionable."""

# --- 6 Typed Tools ---


async def fetch_atmospheric_state(city_or_coords: str = "Delhi") -> dict[str, Any]:
    """Fetch live CAMS atmospheric forecast and OpenAQ ground calibration for a city or coordinates."""
    city_str = city_or_coords.strip() if city_or_coords else "Delhi"

    lat, lon = 28.6139, 77.2090  # Default Delhi
    if city_str in DEMO_CITIES:
        lat = DEMO_CITIES[city_str]["lat"]
        lon = DEMO_CITIES[city_str]["lon"]
    elif "," in city_str:
        try:
            parts = city_str.split(",")
            lat, lon = float(parts[0]), float(parts[1])
        except (ValueError, IndexError):
            lat, lon = 28.6139, 77.2090
    else:
        results = await geocode_city(city_str)
        if results:
            lat = results[0]["lat"]
            lon = results[0]["lon"]

    bundle = await fetch_atmospheric_bundle(lat, lon)
    openaq_cal = await calibrate_with_openaq(lat, lon)

    aq_hourly = bundle.get("air_quality", {}).get("hourly", {})
    weather_hourly = bundle.get("weather", {}).get("hourly", {})

    pm25_series = aq_hourly.get("pm2_5", [])
    no2_series = aq_hourly.get("nitrogen_dioxide", [])
    o3_series = aq_hourly.get("ozone", [])
    blh_series = weather_hourly.get("boundary_layer_height", [])
    wind_series = weather_hourly.get("wind_speed_10m", [])

    curr_pm25 = float(pm25_series[0]) if pm25_series and pm25_series[0] is not None else 50.0
    curr_no2 = float(no2_series[0]) if no2_series and no2_series[0] is not None else 20.0
    curr_o3 = float(o3_series[0]) if o3_series and o3_series[0] is not None else 40.0
    curr_blh = float(blh_series[0]) if blh_series and blh_series[0] is not None else 500.0
    curr_wind = float(wind_series[0]) if wind_series and wind_series[0] is not None else 8.0

    return {
        "city_or_coords": city_str,
        "latitude": lat,
        "longitude": lon,
        "current_pm25_ug_m3": round(curr_pm25, 1),
        "current_no2_ug_m3": round(curr_no2, 1),
        "current_o3_ug_m3": round(curr_o3, 1),
        "boundary_layer_height_m": round(curr_blh, 1),
        "wind_speed_kmh": round(curr_wind, 1),
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
    from api.models.schemas import ActivityType, DoseRequest

    act_map = {
        "walking": ActivityType.walking,
        "cycling": ActivityType.cycling,
        "running": ActivityType.running,
        "jog": ActivityType.running,
        "resting": ActivityType.resting,
    }
    act_enum = act_map.get(activity.lower(), ActivityType.walking)

    mask_enum = MaskType.none
    try:
        mask_enum = MaskType(mask.lower())
    except ValueError:
        pass

    fit_enum = MaskFit.sealed
    try:
        fit_enum = MaskFit(mask_fit.lower())
    except ValueError:
        pass

    persona_enum = PersonaType.healthy_adult
    try:
        persona_enum = PersonaType(persona.lower())
    except ValueError:
        pass

    req = DoseRequest(
        pm25_ug_m3=float(pm25),
        duration_hours=float(duration_minutes) / 60.0,
        activity=act_enum,
        persona=persona_enum,
        mask=mask_enum,
        mask_fit=fit_enum,
    )
    res = calculate_dose(req)
    return res.model_dump()


async def analyze_smog_trap(lat: float, lon: float) -> dict[str, Any]:
    """Analyze atmospheric boundary layer height and ventilation index for thermal inversion trapping."""
    bundle = await fetch_atmospheric_bundle(lat, lon)
    weather_hourly = bundle.get("weather", {}).get("hourly", {})
    times = weather_hourly.get("time", [])
    blh = weather_hourly.get("boundary_layer_height", [])
    wind = weather_hourly.get("wind_speed_10m", [])

    inv = analyze_inversion_series(times, blh, wind)
    return inv.model_dump()


async def optimize_window_ventilation(
    lat: float,
    lon: float,
    has_hepa: bool = False,
) -> dict[str, Any]:
    """Scan daylight hours for the lowest PM2.5 natural indoor ventilation window."""
    bundle = await fetch_atmospheric_bundle(lat, lon)
    aq_hourly = bundle.get("air_quality", {}).get("hourly", {})
    times = aq_hourly.get("time", [])
    pm25 = aq_hourly.get("pm2_5", [])

    window = find_optimal_ventilation_window(times, pm25, has_hepa=has_hepa)
    return window.model_dump()


async def optimize_daily_schedule(
    lat: float,
    lon: float,
    tasks: list[dict[str, Any]],
    persona: str = "healthy_adult",
) -> dict[str, Any]:
    """Deterministic, conflict-free 24-hour schedule optimizer minimizing cumulative exposure."""
    bundle = await fetch_atmospheric_bundle(lat, lon)
    task_items: list[TaskItem] = []
    for t in tasks:
        task_items.append(
            TaskItem(
                name=t.get("name", "Task"),
                activity=t.get("activity", "walking"),
                duration_minutes=int(t.get("duration_minutes", 30)),
                earliest_hour=float(t.get("earliest_hour", 0.0)),
                latest_hour=float(t.get("latest_hour", 24.0)),
                mask=MaskType(t.get("mask", "none")) if isinstance(t.get("mask"), str) else t.get("mask", MaskType.none),
                mask_fit=MaskFit(t.get("mask_fit", "sealed")) if isinstance(t.get("mask_fit"), str) else t.get("mask_fit", MaskFit.sealed),
            )
        )

    res = solve_schedule(tasks=task_items, forecast=bundle, persona=PersonaType(persona))
    return res.model_dump()


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


TOOL_REGISTRY: dict[str, Any] = {
    "fetch_atmospheric_state": fetch_atmospheric_state,
    "simulate_inhaled_dose": simulate_inhaled_dose,
    "analyze_smog_trap": analyze_smog_trap,
    "optimize_window_ventilation": optimize_window_ventilation,
    "optimize_daily_schedule": optimize_daily_schedule,
    "compare_clean_air_routes": compare_clean_air_routes,
}


async def _execute_and_trace(
    tool_name: str,
    args: dict[str, Any],
    tool_trace: list[dict[str, Any]],
) -> dict[str, Any]:
    """Execute a registered tool and record glass-box latency and summary."""
    fn = TOOL_REGISTRY.get(tool_name)
    if fn is None:
        err_res = {"error": f"Tool '{tool_name}' not found."}
        tool_trace.append(
            {
                "tool_name": tool_name,
                "arguments": args,
                "latency_ms": 0.0,
                "result_summary": err_res,
            }
        )
        return err_res

    t0 = time.perf_counter()
    try:
        res = await fn(**args)
    except (ValueError, TypeError, KeyError, RuntimeError, AttributeError, httpx.HTTPError) as e:
        logger.warning("Tool execution error in %s: %s", tool_name, e)
        res = {"error": str(e)}
    latency = round((time.perf_counter() - t0) * 1000.0, 1)

    # Concise summary for trace
    summary: dict[str, Any] = {}
    if isinstance(res, dict):
        for k, v in res.items():
            if isinstance(v, list) and len(v) > 2:
                summary[k] = f"{len(v)} items"
            elif isinstance(v, dict) and len(v) > 4:
                summary[k] = f"{len(v)} keys"
            else:
                summary[k] = v
    else:
        summary = {"result": str(res)}

    tool_trace.append(
        {
            "tool_name": tool_name,
            "arguments": args,
            "latency_ms": latency,
            "result_summary": summary,
        }
    )
    return res


# Tool definitions for Groq / OpenAI-compatible function calling
GROQ_TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "fetch_atmospheric_state",
            "description": "Fetch live ambient PM2.5, NO2, O3, BLH, and OpenAQ sensor calibration.",
            "parameters": {
                "type": "object",
                "properties": {
                    "city_or_coords": {
                        "type": "string",
                        "description": "City name (e.g. Delhi, London) or 'lat,lon'",
                    }
                },
                "required": ["city_or_coords"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "simulate_inhaled_dose",
            "description": "Calculate respiratory inhaled and deposited PM2.5 dose in micrograms and WHO budget %.",
            "parameters": {
                "type": "object",
                "properties": {
                    "pm25": {"type": "number", "description": "Ambient PM2.5 in µg/m³"},
                    "activity": {"type": "string", "enum": ["resting", "walking", "cycling", "running"]},
                    "duration_minutes": {"type": "number", "description": "Exposure duration in minutes"},
                    "mask": {"type": "string", "enum": ["none", "cloth", "surgical", "n95"]},
                    "mask_fit": {"type": "string", "enum": ["sealed", "loose"]},
                    "persona": {"type": "string", "enum": ["healthy_adult", "asthma_copd", "child_commute", "endurance_athlete", "elderly_cardio"]},
                },
                "required": ["pm25"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "analyze_smog_trap",
            "description": "Detect atmospheric thermal inversion layer trapping and project lift hour.",
            "parameters": {
                "type": "object",
                "properties": {
                    "lat": {"type": "number"},
                    "lon": {"type": "number"},
                },
                "required": ["lat", "lon"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "optimize_window_ventilation",
            "description": "Scan daylight hours for the cleanest 1-hour natural window for indoor ventilation.",
            "parameters": {
                "type": "object",
                "properties": {
                    "lat": {"type": "number"},
                    "lon": {"type": "number"},
                    "has_hepa": {"type": "boolean"},
                },
                "required": ["lat", "lon"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "optimize_daily_schedule",
            "description": "Compute conflict-free non-overlapping 24h schedule minimizing total inhaled dose.",
            "parameters": {
                "type": "object",
                "properties": {
                    "lat": {"type": "number"},
                    "lon": {"type": "number"},
                    "tasks": {
                        "type": "array",
                        "items": {"type": "object"},
                        "description": "List of tasks with name, activity, duration_minutes, earliest_hour, latest_hour",
                    },
                    "persona": {"type": "string"},
                },
                "required": ["lat", "lon", "tasks"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "compare_clean_air_routes",
            "description": "Compare travel routes using Land-Use Regression road type and uphill steepness multipliers.",
            "parameters": {
                "type": "object",
                "properties": {
                    "origin": {"type": "array", "items": {"type": "number"}},
                    "destination": {"type": "array", "items": {"type": "number"}},
                    "mode": {"type": "string", "enum": ["walking", "cycling", "driving"]},
                    "lat": {"type": "number"},
                    "lon": {"type": "number"},
                    "persona": {"type": "string"},
                    "mask": {"type": "string"},
                },
                "required": ["origin", "destination"],
            },
        },
    },
]


async def _run_gemini(
    message: str,
    tool_trace: list[dict[str, Any]],
) -> dict[str, Any]:
    """Execute query with Google GenAI SDK (gemini-2.5-flash)."""
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise ValueError("GEMINI_API_KEY missing")

    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)

    # Convert our python tools to types.Tool
    tools = [
        fetch_atmospheric_state,
        simulate_inhaled_dose,
        analyze_smog_trap,
        optimize_window_ventilation,
        optimize_daily_schedule,
        compare_clean_air_routes,
    ]

    config = types.GenerateContentConfig(
        system_instruction=SYSTEM_PROMPT,
        tools=tools,  # type: ignore[arg-type]
    )

    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=message,
        config=config,
    )

    # Process function calls if requested
    if hasattr(response, "function_calls") and response.function_calls:
        for call in response.function_calls:
            call_name = getattr(call, "name", "")
            call_args = dict(getattr(call, "args", {}) or {})
            await _execute_and_trace(call_name, call_args, tool_trace)

        # Call again with tool outputs for final synthesized text
        follow_up = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=f"User query: {message}. Tool execution trace: {json.dumps(tool_trace)}. Summarize citing exact numbers.",
            config=types.GenerateContentConfig(system_instruction=SYSTEM_PROMPT),
        )
        return {
            "reply": follow_up.text or "Analysis complete.",
            "provider_used": "gemini-2.5-flash",
            "tool_trace": tool_trace,
        }

    return {
        "reply": response.text or "Atmospheric assessment complete.",
        "provider_used": "gemini-2.5-flash",
        "tool_trace": tool_trace,
    }


async def _run_groq(
    message: str,
    tool_trace: list[dict[str, Any]],
) -> dict[str, Any]:
    """Execute query with Groq (openai/gpt-oss-120b with fallback to openai/gpt-oss-20b) tool calling."""
    groq_key = os.environ.get("GROQ_API_KEY", "").strip()
    if not groq_key:
        raise ValueError("GROQ_API_KEY missing")

    from groq import AsyncGroq

    client = AsyncGroq(api_key=groq_key)

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": message},
    ]

    models_to_try = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"]
    resp = None
    chosen_model = models_to_try[0]

    for model_name in models_to_try:
        try:
            resp = await client.chat.completions.create(
                model=model_name,
                messages=messages,  # type: ignore[arg-type]
                tools=GROQ_TOOLS,  # type: ignore[arg-type]
                tool_choice="auto",
            )
            chosen_model = model_name
            break
        except Exception as e:
            logger.warning("Groq model %s error: %s", model_name, e)
            if model_name == models_to_try[-1]:
                raise

    if resp is None:
        raise RuntimeError("No Groq model succeeded")

    choice = resp.choices[0]
    msg = choice.message

    if msg.tool_calls:
        messages.append(msg)  # type: ignore[arg-type]
        for t_call in msg.tool_calls:
            fname = t_call.function.name
            try:
                fargs = json.loads(t_call.function.arguments)
            except (ValueError, TypeError):
                fargs = {}

            t_result = await _execute_and_trace(fname, fargs, tool_trace)
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": t_call.id,
                    "content": json.dumps(t_result),
                }  # type: ignore[dict-item]
            )

        second_resp = await client.chat.completions.create(
            model=chosen_model,
            messages=messages,  # type: ignore[arg-type]
        )
        reply_text = second_resp.choices[0].message.content or "Completed analysis."
    else:
        reply_text = msg.content or "Atmospheric assessment ready."

    return {
        "reply": reply_text,
        "provider_used": "groq_failover",
        "tool_trace": tool_trace,
    }


async def _run_deterministic_fallback(
    message: str,
    city_or_coords: str,
    persona: str,
    tool_trace: list[dict[str, Any]],
) -> dict[str, Any]:
    """Offline safe fallback: executes real tools based on user intent and cites exact figures."""
    msg_lower = message.lower()
    schedule_data: dict[str, Any] | None = None

    # Intent routing
    if any(k in msg_lower for k in ["route", "path", "clean air", "cycling", "drive", "footway"]):
        origin = (28.6139, 77.2090)
        destination = (28.6500, 77.2300)
        mode = "cycling" if "cycl" in msg_lower else "walking"
        res = await _execute_and_trace(
            "compare_clean_air_routes",
            {"origin": origin, "destination": destination, "mode": mode, "persona": persona},
            tool_trace,
        )
        fastest_id = res.get("fastest_route_id")
        cleanest_id = res.get("cleanest_route_id")
        max_savings = res.get("max_savings_pct", 0.0)
        reply = (
            f"Clean Air Route Evaluation: Evaluated {len(res.get('routes', []))} route alternatives for {mode}. "
            f"Cleanest route ({cleanest_id}) saves {max_savings:.1f}% inhaled PM2.5 compared to fastest route ({fastest_id}) "
            f"at regional background of {res.get('background_pm25', 100.0):.1f} µg/m³."
        )

    elif any(k in msg_lower for k in ["schedule", "routine", "commute", "jog", "plan", "daily"]):
        tasks = [
            {"name": "Morning Commute", "activity": "walking", "duration_minutes": 40, "earliest_hour": 7.0, "latest_hour": 10.0},
            {"name": "Morning Jog", "activity": "running", "duration_minutes": 30, "earliest_hour": 6.0, "latest_hour": 9.0},
            {"name": "Ventilate Bedroom", "activity": "ventilate_room", "duration_minutes": 60, "earliest_hour": 11.0, "latest_hour": 15.0},
        ]
        res = await _execute_and_trace(
            "optimize_daily_schedule",
            {"lat": 28.6139, "lon": 77.2090, "tasks": tasks, "persona": persona},
            tool_trace,
        )
        schedule_data = res
        reply = (
            f"Optimized 24h Schedule: Resolved 0 conflicts across {len(res.get('scheduled_tasks', []))} tasks. "
            f"Total optimized dose is {res.get('total_optimized_dose_ug', 0.0):.1f} µg vs baseline naive "
            f"{res.get('baseline_naive_dose_ug', 0.0):.1f} µg (Total Savings: {res.get('total_savings_pct', 0.0):.1f}%)."
        )

    elif any(k in msg_lower for k in ["smog", "trap", "inversion", "lift", "boundary"]):
        res = await _execute_and_trace("analyze_smog_trap", {"lat": 28.6139, "lon": 77.2090}, tool_trace)
        reply = (
            f"Smog Inversion Analysis: Ventilation Index is {res.get('ventilation_index_m2_s', 0.0):.1f} m²/s "
            f"({res.get('status', 'unknown')}). {res.get('explanation', '')}"
        )

    elif any(k in msg_lower for k in ["window", "ventilate", "ventilation", "bedroom", "air out", "hepa"]):
        res = await _execute_and_trace(
            "optimize_window_ventilation",
            {"lat": 28.6139, "lon": 77.2090, "has_hepa": "hepa" in msg_lower},
            tool_trace,
        )
        reply = (
            f"Indoor Ventilation Guidance: Optimal daylight window begins at {res.get('best_start_hour_iso')}. "
            f"Minimum outdoor PM2.5 is {res.get('outdoor_pm25_min', 0.0):.1f} µg/m³. "
            f"Expected indoor PM2.5 with windows closed is {res.get('indoor_pm25_closed', 0.0):.1f} µg/m³ vs "
            f"{res.get('indoor_pm25_open', 0.0):.1f} µg/m³ open. {res.get('recommendation', '')}"
        )

    elif any(k in msg_lower for k in ["dose", "inhale", "mask", "cigarette", "copd", "asthma"]):
        res = await _execute_and_trace(
            "simulate_inhaled_dose",
            {"pm25": 120.0, "activity": "walking", "duration_minutes": 60.0, "persona": persona},
            tool_trace,
        )
        reply = (
            f"Respiratory Dose Simulation: Inhaled dose is {res.get('inhaled_dose_ug', 0.0):.1f} µg "
            f"({res.get('who_daily_budget_pct', 0.0):.1f}% of WHO 24h budget). "
            f"Alveolar deposited dose: {res.get('deposited_dose_ug', 0.0):.1f} µg. "
            f"Equivalent to {res.get('cigarette_equivalent', 0.0):.2f} cigarettes smoked."
        )

    else:
        res = await _execute_and_trace("fetch_atmospheric_state", {"city_or_coords": city_or_coords}, tool_trace)
        reply = (
            f"Atmospheric State for {res.get('city_or_coords', 'Delhi')}: Current PM2.5 is "
            f"{res.get('current_pm25_ug_m3', 0.0):.1f} µg/m³, NO2 is {res.get('current_no2_ug_m3', 0.0):.1f} µg/m³, "
            f"O3 is {res.get('current_o3_ug_m3', 0.0):.1f} µg/m³, BLH is {res.get('boundary_layer_height_m', 0.0):.1f} m, "
            f"and wind speed is {res.get('wind_speed_kmh', 0.0):.1f} km/h."
        )

    return {
        "reply": reply,
        "provider_used": "deterministic_fallback",
        "tool_trace": tool_trace,
        "schedule": schedule_data,
    }


async def run_copilot(
    message: str,
    city_or_coords: str = "Delhi",
    persona: str = "healthy_adult",
    history: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    """Execute Glass-Box Copilot with Dual-LLM Failover and Deterministic Fallback."""
    tool_trace: list[dict[str, Any]] = []

    # 1. Primary: Google GenAI (gemini-2.5-flash)
    try:
        return await _run_gemini(message, tool_trace)
    except (ValueError, TypeError, KeyError, RuntimeError, AttributeError, httpx.HTTPError) as e:
        logger.info("Primary Gemini failed or unavailable (%s), triggering Groq failover.", e)

    # 2. Automatic Failover: Groq (openai/gpt-oss-120b / openai/gpt-oss-20b)
    try:
        return await _run_groq(message, tool_trace)
    except (ValueError, TypeError, KeyError, RuntimeError, AttributeError, httpx.HTTPError) as e:
        logger.info("Groq failover failed or unavailable (%s), triggering deterministic fallback.", e)

    # 3. Ultimate Safe Fallback: Deterministic offline execution citing exact numbers
    return await _run_deterministic_fallback(message, city_or_coords, persona, tool_trace)
