"""OpenAQ v3 ground-truth sensor calibration client."""

import os
from typing import Any

import httpx

DEFAULT_UNAVAILABLE_RESPONSE: dict[str, Any] = {
    "available": False,
    "reason": "Model-only (CAMS 45km)",
}


def _extract_pm25_from_location(location: dict[str, Any]) -> float | None:
    """Extract latest PM2.5 measurement from OpenAQ v3 location payload."""
    # Check top-level latest dictionary/list
    latest_obj = location.get("latest")
    if isinstance(latest_obj, dict):
        if latest_obj.get("parameter") in ("pm25", "pm2.5"):
            val = latest_obj.get("value")
            if val is not None:
                return float(val)
    elif isinstance(latest_obj, list):
        for item in latest_obj:
            if isinstance(item, dict) and item.get("parameter") in ("pm25", "pm2.5"):
                val = item.get("value")
                if val is not None:
                    return float(val)

    # Check sensors list
    sensors = location.get("sensors", [])
    for sensor in sensors:
        param = sensor.get("parameter", {})
        param_name = param.get("name") if isinstance(param, dict) else str(param)
        if param_name in ("pm25", "pm2.5"):
            # Try sensor latest reading
            latest = sensor.get("latest")
            if isinstance(latest, dict):
                val = latest.get("value")
                if val is not None:
                    return float(val)
            val = sensor.get("value")
            if val is not None:
                return float(val)

    return None


async def calibrate_with_openaq(
    lat: float,
    lon: float,
    cams_pm25: float = 0.0,
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """Query nearest ground sensor within 25km and calculate calibration offset.

    Returns a clean fallback response if the API key is missing or any HTTP
    timeout/network error occurs without raising unhandled exceptions.
    """
    api_key = os.getenv("OPENAQ_API_KEY")
    if not api_key or not api_key.strip():
        return dict(DEFAULT_UNAVAILABLE_RESPONSE)

    url = "https://api.openaq.org/v3/locations"
    params = {
        "coordinates": f"{lat},{lon}",
        "radius": 25000,
        "limit": 5,
    }
    headers = {"X-API-Key": api_key.strip()}

    async def _fetch(c: httpx.AsyncClient) -> dict[str, Any]:
        resp = await c.get(url, params=params, headers=headers, timeout=5.0)
        if resp.status_code != 200:
            return dict(DEFAULT_UNAVAILABLE_RESPONSE)

        data = resp.json()
        results = data.get("results", [])
        if not results:
            return dict(DEFAULT_UNAVAILABLE_RESPONSE)

        for loc in results:
            pm25_val = _extract_pm25_from_location(loc)
            if pm25_val is not None and pm25_val >= 0:
                delta = round(pm25_val - cams_pm25, 1)
                return {
                    "available": True,
                    "station_name": loc.get("name", "Nearby Ground Monitor"),
                    "distance_m": loc.get("distance"),
                    "ground_pm25": round(pm25_val, 1),
                    "cams_pm25": round(cams_pm25, 1),
                    "calibration_delta_ug": delta,
                }

        return dict(DEFAULT_UNAVAILABLE_RESPONSE)

    try:
        if client is not None:
            return await _fetch(client)
        async with httpx.AsyncClient(timeout=5.0) as c:
            return await _fetch(c)
    except (httpx.HTTPError, httpx.TimeoutException, ValueError, KeyError):
        return dict(DEFAULT_UNAVAILABLE_RESPONSE)
