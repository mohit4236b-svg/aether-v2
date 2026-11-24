"""Unit test suite for atmospheric data fusion, caching, fallback, and OpenAQ calibration."""

import json
from typing import Any

import httpx
import pytest

from api.services.open_meteo import (
    DEMO_CITIES,
    clear_cache,
    fetch_atmospheric_bundle,
    geocode_city,
)
from api.services.openaq import calibrate_with_openaq


@pytest.fixture(autouse=True)
def _reset_cache() -> None:
    """Ensure in-memory cache is clean for every test run."""
    clear_cache()


def test_demo_cities_presence() -> None:
    """Verify all 5 required demo cities and coordinates exist."""
    assert "Delhi" in DEMO_CITIES
    assert "Baddi" in DEMO_CITIES
    assert "London" in DEMO_CITIES
    assert "Beijing" in DEMO_CITIES
    assert "San Francisco" in DEMO_CITIES

    for coords in DEMO_CITIES.values():
        assert -90.0 <= coords["lat"] <= 90.0
        assert -180.0 <= coords["lon"] <= 180.0


@pytest.mark.asyncio
async def test_parallel_fetch_and_ttl_cache_hit() -> None:
    """Verify parallel API execution and zero HTTP requests on subsequent TTL cache hit."""
    request_count = 0

    mock_aq_data = {
        "hourly": {
            "time": ["2026-11-24T12:00:00"],
            "pm2_5": [45.0],
            "nitrogen_dioxide": [22.0],
            "ozone": [60.0],
        }
    }
    mock_ecmwf_data = {
        "hourly": {
            "time": ["2026-11-24T12:00:00"],
            "temperature_2m": [25.0],
            "wind_speed_10m": [12.0],
            "boundary_layer_height": [1400.0],
        }
    }

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal request_count
        request_count += 1
        url_str = str(request.url)
        if "air-quality" in url_str:
            return httpx.Response(200, json=mock_aq_data)
        elif "ecmwf" in url_str:
            return httpx.Response(200, json=mock_ecmwf_data)
        return httpx.Response(404)

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        # First call: makes 2 parallel HTTP calls
        res1 = await fetch_atmospheric_bundle(28.61, 77.20, client=client)
        assert res1["cached"] is False
        assert res1["blh_source"] == "ecmwf_ifs_hres"
        assert request_count == 2

        # Second call: identical coordinates (within 2 decimal places) must hit TTL cache
        res2 = await fetch_atmospheric_bundle(28.614, 77.203, client=client)
        assert res2["cached"] is True
        assert res2["blh_source"] == "ecmwf_ifs_hres"
        # Crucial check: request_count did not increase!
        assert request_count == 2


@pytest.mark.asyncio
async def test_ecmwf_missing_blh_fallback() -> None:
    """Verify fallback to standard forecast and estimated BLH when ECMWF omits BLH."""
    mock_aq_data = {
        "hourly": {
            "time": ["2026-11-24T14:00:00"],
            "pm2_5": [30.0],
        }
    }
    mock_ecmwf_no_blh = {
        "hourly": {
            "time": ["2026-11-24T14:00:00"],
            "temperature_2m": [20.0],
            "boundary_layer_height": [None],
        }
    }
    mock_forecast_fallback = {
        "hourly": {
            "time": ["2026-11-24T14:00:00"],
            "temperature_2m": [20.0],
            "wind_speed_10m": [10.0],
        }
    }

    def handler(request: httpx.Request) -> httpx.Response:
        url_str = str(request.url)
        if "air-quality" in url_str:
            return httpx.Response(200, json=mock_aq_data)
        elif "ecmwf" in url_str:
            return httpx.Response(200, json=mock_ecmwf_no_blh)
        elif "forecast" in url_str:
            return httpx.Response(200, json=mock_forecast_fallback)
        return httpx.Response(404)

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        res = await fetch_atmospheric_bundle(51.50, -0.12, client=client)
        assert res["blh_source"] == "estimated"
        blh_series = res["weather"]["hourly"]["boundary_layer_height"]
        assert len(blh_series) == 1
        assert blh_series[0] is not None
        assert blh_series[0] > 0


@pytest.mark.asyncio
async def test_ecmwf_timeout_or_error_fallback() -> None:
    """Verify fallback when ECMWF endpoint returns HTTP 500 or network error."""
    mock_aq_data = {"hourly": {"time": ["2026-11-24T10:00:00"], "pm2_5": [25.0]}}
    mock_forecast = {
        "hourly": {
            "time": ["2026-11-24T10:00:00"],
            "temperature_2m": [18.0],
            "wind_speed_10m": [6.0],
        }
    }

    def handler(request: httpx.Request) -> httpx.Response:
        url_str = str(request.url)
        if "air-quality" in url_str:
            return httpx.Response(200, json=mock_aq_data)
        elif "ecmwf" in url_str:
            return httpx.Response(500, text="Internal Server Error")
        elif "forecast" in url_str:
            return httpx.Response(200, json=mock_forecast)
        return httpx.Response(404)

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        res = await fetch_atmospheric_bundle(30.95, 76.79, client=client)
        assert res["blh_source"] == "estimated"
        assert "boundary_layer_height" in res["weather"]["hourly"]


@pytest.mark.asyncio
async def test_geocode_city_success() -> None:
    """Test geocoding query returns parsed city locations."""
    mock_geo_resp = {
        "results": [
            {
                "id": 1,
                "name": "Delhi",
                "latitude": 28.6139,
                "longitude": 77.2090,
                "country": "India",
            }
        ]
    }

    def handler(request: httpx.Request) -> httpx.Response:
        if "geocoding-api" in str(request.url):
            return httpx.Response(200, json=mock_geo_resp)
        return httpx.Response(404)

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        results = await geocode_city("Delhi", client=client)
        assert len(results) == 1
        assert results[0]["name"] == "Delhi"
        assert results[0]["latitude"] == 28.6139


@pytest.mark.asyncio
async def test_geocode_city_direct_coordinates() -> None:
    """Verify coordinate input 'lat, lon' returns normalized result immediately without network calls."""
    # Using client that raises if any HTTP request is attempted
    def fail_handler(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"Unexpected HTTP request made: {request.url}")

    transport = httpx.MockTransport(fail_handler)
    async with httpx.AsyncClient(transport=transport) as client:
        results = await geocode_city("31.69, 76.73", client=client)
        assert len(results) == 1
        assert results[0]["name"] == "31.6900, 76.7300"
        assert results[0]["country"] == "Custom"
        assert results[0]["admin1"] == ""
        assert results[0]["lat"] == 31.69
        assert results[0]["lon"] == 76.73


@pytest.mark.asyncio
async def test_geocode_city_nominatim_fallback() -> None:
    """Verify fallback to OpenStreetMap Nominatim when Open-Meteo returns zero results."""
    mock_open_meteo_empty = {"results": []}
    mock_nominatim_resp = [
        {
            "place_id": 99999,
            "lat": "31.7013",
            "lon": "76.7383",
            "display_name": "Sarkaghat, Mandi, Himachal Pradesh, 175024, India",
            "address": {
                "town": "Sarkaghat",
                "county": "Mandi",
                "state": "Himachal Pradesh",
                "country": "India",
            },
        }
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        url_str = str(request.url)
        if "geocoding-api.open-meteo.com" in url_str:
            return httpx.Response(200, json=mock_open_meteo_empty)
        elif "nominatim.openstreetmap.org" in url_str:
            assert request.headers.get("user-agent") == "AetherUrbanAirQuality/2.0 (hackathon-project)"
            return httpx.Response(200, json=mock_nominatim_resp)
        return httpx.Response(404)

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        results = await geocode_city("sarkaghat", client=client)
        assert len(results) == 1
        assert results[0]["name"] == "Sarkaghat"
        assert results[0]["country"] == "India"
        assert results[0]["admin1"] == "Himachal Pradesh"
        assert results[0]["lat"] == 31.7013
        assert results[0]["lon"] == 76.7383
        assert results[0]["latitude"] == 31.7013
        assert results[0]["longitude"] == 76.7383


@pytest.mark.asyncio
async def test_openaq_missing_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify missing API key returns model-only response without error."""
    monkeypatch.delenv("OPENAQ_API_KEY", raising=False)
    res = await calibrate_with_openaq(28.61, 77.20, cams_pm25=120.0)
    assert res["available"] is False
    assert res["reason"] == "Model-only (CAMS 45km)"


@pytest.mark.asyncio
async def test_openaq_calibration_delta_math(monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify calibration delta calculation when ground PM2.5 measurement is present."""
    monkeypatch.setenv("OPENAQ_API_KEY", "mock_valid_key")

    mock_openaq_resp: dict[str, Any] = {
        "results": [
            {
                "name": "Anand Vihar Monitor",
                "distance": 4200.0,
                "sensors": [
                    {
                        "parameter": {"name": "pm25"},
                        "latest": {"value": 145.4},
                    }
                ],
            }
        ]
    }

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers.get("x-api-key") == "mock_valid_key"
        return httpx.Response(200, text=json.dumps(mock_openaq_resp))

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        res = await calibrate_with_openaq(28.61, 77.20, cams_pm25=120.0, client=client)
        assert res["available"] is True
        assert res["station_name"] == "Anand Vihar Monitor"
        assert res["ground_pm25"] == 145.4
        assert res["cams_pm25"] == 120.0
        # 145.4 - 120.0 = 25.4
        assert res["calibration_delta_ug"] == 25.4


@pytest.mark.asyncio
async def test_openaq_error_and_timeout_resilience(monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify HTTP error or timeout returns clean unavailable response without throwing exception."""
    monkeypatch.setenv("OPENAQ_API_KEY", "mock_key")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="Internal Server Error")

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        res = await calibrate_with_openaq(28.61, 77.20, cams_pm25=120.0, client=client)
        assert res["available"] is False
        assert res["reason"] == "Model-only (CAMS 45km)"
