"""Open-Meteo atmospheric data fusion service with parallel fetching and TTL caching."""

import asyncio
import re
import time
from typing import Any

import httpx

# In-memory TTL cache: (rounded_lat, rounded_lon) -> (timestamp, bundle_data)
CACHE_TTL_SECONDS: float = 600.0  # 10 minutes
_ATMOSPHERIC_CACHE: dict[tuple[float, float], tuple[float, dict[str, Any]]] = {}

# 5 built-in instant presets
DEMO_CITIES: dict[str, dict[str, float]] = {
    "Delhi": {"lat": 28.6139, "lon": 77.2090},
    "Baddi": {"lat": 30.9578, "lon": 76.7914},
    "London": {"lat": 51.5072, "lon": -0.1276},
    "Beijing": {"lat": 39.9042, "lon": 116.4074},
    "San Francisco": {"lat": 37.7749, "lon": -122.4194},
}


def get_cache_key(lat: float, lon: float) -> tuple[float, float]:
    """Round latitude and longitude to 2 decimal places for spatial cache grouping."""
    return (round(lat, 2), round(lon, 2))


def clear_cache() -> None:
    """Clear all in-memory cached atmospheric responses (used for testing)."""
    _ATMOSPHERIC_CACHE.clear()


def estimate_blh(
    hourly_times: list[str],
    wind_speeds: list[float | None],
) -> list[float]:
    """Estimate boundary layer height (m) conservatively from solar hour and 10m wind speed."""
    blh_list: list[float] = []
    for i, t_str in enumerate(hourly_times):
        hour = 12
        try:
            if "T" in t_str:
                hour = int(t_str.split("T")[1].split(":")[0])
            elif ":" in t_str:
                hour = int(t_str.split(":")[0])
        except (ValueError, IndexError):
            hour = 12

        ws_kmh = wind_speeds[i] if i < len(wind_speeds) and wind_speeds[i] is not None else 8.0

        # Solar diurnal convective mixing vs nocturnal thermal inversion
        if 11 <= hour <= 16:
            base_blh = 1000.0
        elif 8 <= hour <= 10 or 17 <= hour <= 19:
            base_blh = 550.0
        else:
            base_blh = 250.0

        # Mechanical wind shear contribution (~25 m per km/h)
        wind_contrib = ws_kmh * 25.0
        blh_list.append(round(base_blh + wind_contrib, 1))
    return blh_list


async def geocode_city(
    query: str,
    client: httpx.AsyncClient | None = None,
) -> list[dict[str, Any]]:
    """Geocode a city, town, village, or direct coordinates.

    1. Direct coordinates support: 'lat, lon'.
    2. Primary lookup: Open-Meteo Geocoding API.
    3. Automatic Nominatim fallback: OpenStreetMap Nominatim for small towns/villages.
    """
    clean_query = query.strip()
    if not clean_query:
        return []

    # 1. Direct coordinates support: 'lat, lon' (e.g., 31.69, 76.73)
    coord_match = re.match(
        r"^([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)$",
        clean_query,
    )
    if coord_match:
        try:
            lat = float(coord_match.group(1))
            lon = float(coord_match.group(2))
            if -90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0:
                return [
                    {
                        "name": f"{lat:.4f}, {lon:.4f}",
                        "country": "Custom",
                        "admin1": "",
                        "lat": lat,
                        "lon": lon,
                        "latitude": lat,
                        "longitude": lon,
                    }
                ]
        except ValueError:
            pass

    async def _do_open_meteo(c: httpx.AsyncClient) -> list[dict[str, Any]]:
        url = f"https://geocoding-api.open-meteo.com/v1/search?name={clean_query}&count=5&language=en&format=json"
        resp = await c.get(url)
        resp.raise_for_status()
        data = resp.json()
        raw_results = data.get("results", []) or []
        normalized: list[dict[str, Any]] = []
        for item in raw_results:
            lat_val = float(item.get("latitude", item.get("lat", 0.0)))
            lon_val = float(item.get("longitude", item.get("lon", 0.0)))
            normalized.append({
                "name": str(item.get("name", "")),
                "country": str(item.get("country", "")),
                "admin1": str(item.get("admin1", "")),
                "lat": lat_val,
                "lon": lon_val,
                "latitude": lat_val,
                "longitude": lon_val,
            })
        return normalized

    async def _do_nominatim(c: httpx.AsyncClient) -> list[dict[str, Any]]:
        url = "https://nominatim.openstreetmap.org/search"
        params = {
            "q": clean_query,
            "format": "json",
            "limit": 5,
            "addressdetails": 1,
        }
        headers = {
            "User-Agent": "AetherUrbanAirQuality/2.0 (hackathon-project)",
        }
        resp = await c.get(url, params=params, headers=headers)
        resp.raise_for_status()
        data = resp.json()
        if not isinstance(data, list):
            return []
        normalized: list[dict[str, Any]] = []
        for item in data:
            address = item.get("address", {}) or {}
            name = (
                address.get("town")
                or address.get("village")
                or address.get("city")
                or address.get("municipality")
                or address.get("hamlet")
                or address.get("suburb")
                or (str(item.get("display_name", "")).split(",")[0].strip() if item.get("display_name") else clean_query)
            )
            country = str(address.get("country", ""))
            admin1 = str(address.get("state") or address.get("province") or address.get("region", ""))
            try:
                lat_val = float(item.get("lat", 0.0))
                lon_val = float(item.get("lon", 0.0))
            except (ValueError, TypeError):
                continue
            normalized.append({
                "name": str(name),
                "country": country,
                "admin1": admin1,
                "lat": lat_val,
                "lon": lon_val,
                "latitude": lat_val,
                "longitude": lon_val,
            })
        return normalized

    async def _execute(c: httpx.AsyncClient) -> list[dict[str, Any]]:
        # 2. Primary lookup: Open-Meteo
        try:
            results = await _do_open_meteo(c)
            if results:
                return results
        except (httpx.HTTPError, httpx.TimeoutException, ValueError, KeyError):
            pass

        # 3. Fallback lookup: Nominatim
        try:
            return await _do_nominatim(c)
        except (httpx.HTTPError, httpx.TimeoutException, ValueError, KeyError):
            return []

    try:
        if client is not None:
            return await _execute(client)
        async with httpx.AsyncClient(timeout=10.0) as c:
            return await _execute(c)
    except (httpx.HTTPError, httpx.TimeoutException, ValueError, KeyError):
        return []


async def _fetch_air_quality(
    lat: float,
    lon: float,
    client: httpx.AsyncClient,
) -> dict[str, Any]:
    """Fetch CAMS air quality forecast."""
    url = "https://air-quality-api.open-meteo.com/v1/air-quality"
    params = {
        "latitude": lat,
        "longitude": lon,
        "hourly": (
            "us_aqi,european_aqi,pm2_5,pm10,nitrogen_dioxide,"
            "ozone,sulphur_dioxide,carbon_monoxide"
        ),
        "forecast_days": 2,
        "timezone": "auto",
    }
    resp = await client.get(url, params=params)
    resp.raise_for_status()
    return resp.json()


async def _fetch_ecmwf_weather(
    lat: float,
    lon: float,
    client: httpx.AsyncClient,
) -> dict[str, Any]:
    """Fetch ECMWF IFS HRES 9km weather with boundary layer height."""
    url = "https://api.open-meteo.com/v1/ecmwf"
    params = {
        "latitude": lat,
        "longitude": lon,
        "hourly": "temperature_2m,wind_speed_10m,wind_direction_10m,boundary_layer_height",
        "forecast_days": 2,
        "timezone": "auto",
    }
    resp = await client.get(url, params=params)
    resp.raise_for_status()
    return resp.json()


async def _fetch_standard_forecast_weather(
    lat: float,
    lon: float,
    client: httpx.AsyncClient,
) -> dict[str, Any]:
    """Fallback weather endpoint if ECMWF fails or omits boundary_layer_height."""
    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": lat,
        "longitude": lon,
        "hourly": "temperature_2m,wind_speed_10m,wind_direction_10m",
        "forecast_days": 2,
        "timezone": "auto",
    }
    resp = await client.get(url, params=params)
    resp.raise_for_status()
    return resp.json()


async def fetch_atmospheric_bundle(
    lat: float,
    lon: float,
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """Fetch parallel air quality and weather data with BLH fallback and TTL caching."""
    cache_key = get_cache_key(lat, lon)
    now = time.time()

    # Check 10-minute in-memory cache
    if cache_key in _ATMOSPHERIC_CACHE:
        cached_ts, cached_payload = _ATMOSPHERIC_CACHE[cache_key]
        if now - cached_ts < CACHE_TTL_SECONDS:
            result = dict(cached_payload)
            result["cached"] = True
            return result

    async def _execute(c: httpx.AsyncClient) -> dict[str, Any]:
        # Launch Air Quality and ECMWF in parallel
        aq_task = _fetch_air_quality(lat, lon, c)
        ecmwf_task = _fetch_ecmwf_weather(lat, lon, c)

        aq_res, ecmwf_res = await asyncio.gather(
            aq_task,
            ecmwf_task,
            return_exceptions=True,
        )

        # Process Air Quality result
        if isinstance(aq_res, Exception):
            raise aq_res
        aq_data: dict[str, Any] = aq_res

        # Process ECMWF weather result with graceful fallback
        weather_data: dict[str, Any]
        blh_source: str = "ecmwf_ifs_hres"

        has_valid_blh = False
        if not isinstance(ecmwf_res, Exception):
            weather_data = ecmwf_res
            blh_series = weather_data.get("hourly", {}).get("boundary_layer_height")
            if blh_series and any(b is not None for b in blh_series):
                has_valid_blh = True

        if not has_valid_blh:
            # Fallback to standard forecast weather + estimated BLH
            blh_source = "estimated"
            fallback_res = await _fetch_standard_forecast_weather(lat, lon, c)
            weather_data = fallback_res

            hourly = weather_data.setdefault("hourly", {})
            times = hourly.get("time", [])
            winds = hourly.get("wind_speed_10m", [])
            hourly["boundary_layer_height"] = estimate_blh(times, winds)

        payload = {
            "latitude": lat,
            "longitude": lon,
            "air_quality": aq_data,
            "weather": weather_data,
            "blh_source": blh_source,
            "cached": False,
        }

        # Save to in-memory TTL cache
        _ATMOSPHERIC_CACHE[cache_key] = (now, payload)
        return payload

    if client is not None:
        return await _execute(client)
    async with httpx.AsyncClient(timeout=10.0) as c:
        return await _execute(c)
