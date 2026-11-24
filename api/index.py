"""FastAPI application for Aether v2 API.

Exposes atmospheric data fusion, clinical dose simulation, Land-Use Regression
clean air routing, deterministic schedule optimization, and Glass-Box Agentic Co-Pilot.
"""

import os
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from api.models.schemas import (
    DoseRequest,
    DoseResponse,
    MaskFit,
    MaskType,
    PersonaType,
)
from api.services.ai_agent import run_copilot
from api.services.dose_engine import calculate_dose
from api.services.iaq_engine import find_optimal_ventilation_window
from api.services.inversion_detector import analyze_inversion_series
from api.services.open_meteo import DEMO_CITIES, fetch_atmospheric_bundle, geocode_city
from api.services.openaq import calibrate_with_openaq
from api.services.route_scorer import compare_clean_air_routes
from api.services.schedule_solver import solve_schedule

app = FastAPI(
    title="Aether v2 API",
    version="2.0.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)

# CORS configuration for local Vite development and same-origin Vercel deployments
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "*",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RouteCompareRequest(BaseModel):
    """Payload for comparing alternative transit routes."""

    origin: tuple[float, float] = Field(description="Origin coordinates (lat, lon)")
    destination: tuple[float, float] = Field(description="Destination coordinates (lat, lon)")
    mode: str = Field(default="walking", description="Travel mode: walking, cycling, or driving")
    background_pm25: float = Field(default=100.0, ge=0, description="Ambient background PM2.5 in µg/m³")
    persona: PersonaType = Field(default=PersonaType.healthy_adult)
    mask: MaskType = Field(default=MaskType.none)
    mask_fit: MaskFit = Field(default=MaskFit.sealed)


class ScheduleOptimizeRequest(BaseModel):
    """Payload for optimizing daily routine schedules."""

    tasks: list[dict[str, Any]] = Field(description="List of daily tasks to optimize")
    forecast: dict[str, Any] | None = Field(default=None, description="Hourly forecast data")
    lat: float | None = Field(default=None, description="Latitude for atmospheric forecast lookup")
    lon: float | None = Field(default=None, description="Longitude for atmospheric forecast lookup")
    persona: PersonaType = Field(default=PersonaType.healthy_adult)


class ChatRequest(BaseModel):
    """Payload for conversational Glass-Box Agent interaction."""

    message: str = Field(description="User prompt or question")
    city_or_coords: str = Field(default="Delhi", description="Active geographic context")
    persona: str = Field(default="healthy_adult", description="Clinical persona profile")
    history: list[dict[str, str]] = Field(default_factory=list, description="Conversation history")


@app.get("/api/health")
def health_check() -> dict[str, Any]:
    """Return health status, current ISO timestamp, and available providers without exposing keys."""
    return {
        "status": "healthy",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "providers": {
            "gemini": bool(os.environ.get("GEMINI_API_KEY", "").strip()),
            "groq": bool(os.environ.get("GROQ_API_KEY", "").strip()),
            "openrouteservice": bool(os.environ.get("OPENROUTESERVICE_API_KEY", "").strip()),
            "openaq": bool(os.environ.get("OPENAQ_API_KEY", "").strip()),
        },
    }


@app.get("/api/presets")
def get_presets() -> dict[str, Any]:
    """Return the 5 built-in instant demo cities and coordinates."""
    return {"presets": DEMO_CITIES}


@app.get("/api/geocode")
async def geocode_endpoint(q: str = Query(..., description="City or location query")) -> dict[str, Any]:
    """Geocode city or location name to coordinates."""
    results = await geocode_city(q)
    return {"query": q, "results": results}


@app.get("/api/atmosphere")
async def get_atmosphere(
    lat: float = Query(..., ge=-90.0, le=90.0),
    lon: float = Query(..., ge=-180.0, le=180.0),
    persona: str = Query(default="healthy_adult"),
    has_hepa: bool = Query(default=False),
) -> dict[str, Any]:
    """Return live CAMS forecast, ECMWF BLH inversion analysis, OpenAQ calibration, and IAQ window."""
    bundle = await fetch_atmospheric_bundle(lat, lon)
    openaq_cal = await calibrate_with_openaq(lat, lon)

    weather_hourly = bundle.get("weather", {}).get("hourly", {})
    w_times = weather_hourly.get("time", [])
    blh = weather_hourly.get("boundary_layer_height", [])
    wind = weather_hourly.get("wind_speed_10m", [])
    inversion_res = analyze_inversion_series(w_times, blh, wind)

    aq_hourly = bundle.get("air_quality", {}).get("hourly", {})
    aq_times = aq_hourly.get("time", [])
    pm25_series = aq_hourly.get("pm2_5", [])
    vent_window = find_optimal_ventilation_window(aq_times, pm25_series, has_hepa=has_hepa)

    return {
        "latitude": lat,
        "longitude": lon,
        "persona": persona,
        "forecast": bundle,
        "inversion": inversion_res.model_dump(),
        "openaq_calibration": openaq_cal,
        "ventilation_window": vent_window.model_dump(),
    }


@app.post("/api/dose/simulate", response_model=DoseResponse)
def simulate_dose(req: DoseRequest) -> DoseResponse:
    """Calculate respiratory inhaled and deposited PM2.5 dose via dose_engine."""
    return calculate_dose(req)


@app.post("/api/routes/compare")
async def compare_routes_endpoint(req: RouteCompareRequest) -> dict[str, Any]:
    """Compare alternative routes with Land-Use Regression and steepness multipliers."""
    res = await compare_clean_air_routes(
        origin=req.origin,
        destination=req.destination,
        mode=req.mode,
        background_pm25=req.background_pm25,
        persona=req.persona,
        mask=req.mask,
        mask_fit=req.mask_fit,
    )
    return res.model_dump()


@app.post("/api/schedule/optimize")
async def optimize_schedule_endpoint(req: ScheduleOptimizeRequest) -> dict[str, Any]:
    """Optimize 24h daily schedule minimizing cumulative PM2.5 exposure."""
    forecast_data = req.forecast
    if forecast_data is None and req.lat is not None and req.lon is not None:
        forecast_data = await fetch_atmospheric_bundle(req.lat, req.lon)

    res = solve_schedule(tasks=req.tasks, forecast=forecast_data, persona=req.persona)
    return res.model_dump()


@app.post("/api/agent/chat")
async def agent_chat_endpoint(req: ChatRequest) -> dict[str, Any]:
    """Glass-Box Agentic Co-Pilot with Dual-LLM Failover and populated tool traces."""
    return await run_copilot(
        message=req.message,
        city_or_coords=req.city_or_coords,
        persona=req.persona,
        history=req.history,
    )
