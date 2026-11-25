"""Glass-Box Agentic Co-Pilot orchestrator with Dual-LLM Failover.

Primary: google-genai SDK (gemini-2.5-flash) with native function calling.
Automatic Failover: Groq (openai/gpt-oss-120b / openai/gpt-oss-20b) on missing key, 429, 5xx, or timeout.
Deterministic Fallback: Offline local execution citing exact figures from real tools.
"""

import asyncio
import logging
from typing import Any

from api.services.agent_fallback import (
    run_deterministic_fallback as _run_deterministic_fallback,
)
from api.services.agent_providers import run_gemini as _run_gemini
from api.services.agent_providers import run_groq as _run_groq
from api.services.agent_tools import (
    DEFAULT_LAT,
    DEFAULT_LON,
    GROQ_TOOLS,
    SYSTEM_PROMPT,
    TOOL_REGISTRY,
    analyze_smog_trap,
    build_system_prompt,
    compare_clean_air_routes,
    fetch_atmospheric_state,
    optimize_daily_schedule,
    optimize_window_ventilation,
    simulate_inhaled_dose,
)
from api.services.agent_tools import (
    execute_and_trace as _execute_and_trace,
)
from api.services.open_meteo import DEMO_CITIES

logger = logging.getLogger("aether.ai_agent")

__all__ = [
    "GROQ_TOOLS",
    "SYSTEM_PROMPT",
    "TOOL_REGISTRY",
    "_execute_and_trace",
    "_run_deterministic_fallback",
    "_run_gemini",
    "_run_groq",
    "analyze_smog_trap",
    "build_system_prompt",
    "compare_clean_air_routes",
    "fetch_atmospheric_state",
    "optimize_daily_schedule",
    "optimize_window_ventilation",
    "run_copilot",
    "simulate_inhaled_dose",
]


async def run_copilot(
    message: str,
    city_name: str = "Delhi",
    lat: float = DEFAULT_LAT,
    lon: float = DEFAULT_LON,
    persona: str = "healthy_adult",
    history: list[dict[str, Any]] | None = None,
    city_or_coords: str | None = None,
) -> dict[str, Any]:
    """Execute Glass-Box Copilot with Dual-LLM Failover and Deterministic Fallback.

    Args:
        message: User query string.
        city_name: Active city display name.
        lat: Active latitude.
        lon: Active longitude.
        persona: Active clinical persona identifier.
        history: Optional list of recent chat history turns.
        city_or_coords: Optional legacy city override parameter.

    Returns:
        Structured dictionary with reply, provider_used, tool_trace, and diagnostics.
    """
    tool_trace: list[dict[str, Any]] = []
    active_city = city_or_coords if (city_or_coords and (not city_name or city_name == "Delhi")) else city_name
    active_lat, active_lon = lat, lon

    if (
        active_city in DEMO_CITIES
        and active_lat == DEFAULT_LAT
        and active_lon == DEFAULT_LON
        and active_city != "Delhi"
    ):
        active_lat = DEMO_CITIES[active_city]["lat"]
        active_lon = DEMO_CITIES[active_city]["lon"]

    gemini_error: str | None = None
    try:
        return await asyncio.wait_for(
            _run_gemini(message, active_city, active_lat, active_lon, persona, history or [], tool_trace),
            timeout=10.0,
        )
    except Exception as exc:  # noqa: BLE001
        gemini_error = f"{type(exc).__name__}: {exc}"
        logger.warning("Primary Gemini failed (%s), triggering Groq failover.", gemini_error)

    groq_error: str | None = None
    try:
        return await asyncio.wait_for(
            _run_groq(message, active_city, active_lat, active_lon, persona, history or [], tool_trace),
            timeout=15.0,
        )
    except Exception as exc:  # noqa: BLE001
        groq_error = f"{type(exc).__name__}: {exc}"
        logger.warning("Groq failover failed (%s), triggering deterministic fallback.", groq_error)

    res = await _run_deterministic_fallback(message, active_city, active_lat, active_lon, persona, tool_trace)
    if gemini_error:
        res["gemini_error"] = gemini_error
    if groq_error:
        res["groq_error"] = groq_error
    return res
