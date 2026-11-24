"""Unit tests for clean air route scoring (ORS & OSRM) and 24h schedule solver."""

import json
from typing import Any

import httpx
import pytest

from api.models.schemas import MaskFit, MaskType, PersonaType
from api.services.route_scorer import (
    compare_clean_air_routes,
    get_osrm_step_lur_multiplier,
    get_steepness_multiplier,
    get_waytype_lur_multiplier,
)
from api.services.schedule_solver import TaskItem, solve_schedule


def test_waytype_and_steepness_multipliers() -> None:
    """Verify exact Land-Use Regression and steepness multipliers per specification."""
    # State / Primary / Arterial road (1, 2) -> 1.40
    assert get_waytype_lur_multiplier(1) == 1.40
    assert get_waytype_lur_multiplier(2) == 1.40

    # Secondary / Street (3) -> 1.10
    assert get_waytype_lur_multiplier(3) == 1.10

    # Residential / Unpaved / Track (4, 5) -> 0.82
    assert get_waytype_lur_multiplier(4) == 0.82
    assert get_waytype_lur_multiplier(5) == 0.82

    # Cycleway / Footway / Path (6, 7, 8) -> 0.65
    assert get_waytype_lur_multiplier(6) == 0.65
    assert get_waytype_lur_multiplier(7) == 0.65
    assert get_waytype_lur_multiplier(8) == 0.65

    # Default / Unknown -> 1.00
    assert get_waytype_lur_multiplier(0) == 1.00
    assert get_waytype_lur_multiplier(99) == 1.00
    assert get_waytype_lur_multiplier(None) == 1.00

    # Steepness multipliers for walking & cycling
    assert get_steepness_multiplier(0, "walking") == 1.00
    assert get_steepness_multiplier(-1, "walking") == 1.00
    assert get_steepness_multiplier(1, "walking") == 1.15
    assert get_steepness_multiplier(2, "cycling") == 1.15
    assert get_steepness_multiplier(3, "walking") == 1.35
    assert get_steepness_multiplier(4, "cycling") == 1.35
    assert get_steepness_multiplier(5, "cycling") == 1.35

    # Driving ignores steepness ventilation penalty
    assert get_steepness_multiplier(3, "driving") == 1.00
    assert get_steepness_multiplier(5, "driving-car") == 1.00


@pytest.mark.asyncio
async def test_lur_route_scoring_park_beats_arterial(monkeypatch: pytest.MonkeyPatch) -> None:
    """Test that a 20-min park/residential route beats a 16-min primary arterial route

    at 120 µg/m³ background PM2.5, yielding savings > 30%.
    """
    monkeypatch.setenv("OPENROUTESERVICE_API_KEY", "test_mock_ors_key")

    # Mock ORS GeoJSON with 2 alternative routes:
    # Route 1: 16-min primary arterial road (code 1, LUR 1.40)
    # Route 2: 20-min cycleway/park path (code 6, LUR 0.65)
    mock_ors_geojson = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "name": "Arterial Highway Route",
                    "summary": {"distance": 4000.0, "duration": 960.0},  # 16 mins
                    "extras": {
                        "waytype": {
                            "summary": [{"value": 1, "distance": 4000.0, "amount": 100.0}]
                        },
                        "steepness": {
                            "summary": [{"value": 0, "distance": 4000.0, "amount": 100.0}]
                        },
                    },
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[77.20, 28.61], [77.25, 28.65]],
                },
            },
            {
                "type": "Feature",
                "properties": {
                    "name": "Park Green Path Route",
                    "summary": {"distance": 4500.0, "duration": 1200.0},  # 20 mins
                    "extras": {
                        "waytype": {
                            "summary": [{"value": 6, "distance": 4500.0, "amount": 100.0}]
                        },
                        "steepness": {
                            "summary": [{"value": 0, "distance": 4500.0, "amount": 100.0}]
                        },
                    },
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[77.20, 28.61], [77.22, 28.63], [77.25, 28.65]],
                },
            },
        ],
    }

    def mock_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=mock_ors_geojson)

    transport = httpx.MockTransport(mock_handler)
    async with httpx.AsyncClient(transport=transport) as client:
        res = await compare_clean_air_routes(
            origin=(28.61, 77.20),
            destination=(28.65, 77.25),
            mode="walking",
            background_pm25=120.0,
            persona=PersonaType.healthy_adult,
            mask=MaskType.none,
            mask_fit=MaskFit.sealed,
            client=client,
        )

    assert res.routing_engine == "openrouteservice"
    assert len(res.routes) == 2

    # Cleanest route must be ranked #1
    cleanest = res.routes[0]
    arterial = res.routes[1]

    assert cleanest.name == "Park Green Path Route"
    assert cleanest.duration_minutes == 20.0
    assert cleanest.effective_pm25 == pytest.approx(120.0 * 0.65, rel=1e-2)  # 78.0 µg/m³
    assert cleanest.is_cleanest is True

    assert arterial.name == "Arterial Highway Route"
    assert arterial.duration_minutes == 16.0
    assert arterial.effective_pm25 == pytest.approx(120.0 * 1.40, rel=1e-2)  # 168.0 µg/m³
    assert arterial.is_fastest is True

    # Inhaled dose comparison
    # Route 1 (16 min = 0.2667 hr): 168.0 * 1.20 * 0.2667 ≈ 53.76 µg
    # Route 2 (20 min = 0.3333 hr): 78.0 * 1.20 * 0.3333 ≈ 31.20 µg
    # Savings: (53.76 - 31.20) / 53.76 ≈ 41.96% > 30%
    assert cleanest.inhaled_dose_ug < arterial.inhaled_dose_ug
    assert cleanest.savings_pct > 30.0
    assert res.max_savings_pct > 30.0


@pytest.mark.asyncio
async def test_uphill_steepness_penalty_increases_cycling_dose(monkeypatch: pytest.MonkeyPatch) -> None:
    """Test that uphill steepness (code 3 -> 1.35 multiplier) increases cycling inhaled dose."""
    monkeypatch.setenv("OPENROUTESERVICE_API_KEY", "test_mock_ors_key")

    mock_geojson = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "name": "Flat Cycling Route",
                    "summary": {"distance": 5000.0, "duration": 900.0},  # 15 min
                    "extras": {
                        "waytype": {
                            "summary": [{"value": 3, "distance": 5000.0, "amount": 100.0}]
                        },
                        "steepness": {
                            "summary": [{"value": 0, "distance": 5000.0, "amount": 100.0}]
                        },
                    },
                },
                "geometry": {"type": "LineString", "coordinates": [[77.20, 28.61], [77.25, 28.65]]},
            },
            {
                "type": "Feature",
                "properties": {
                    "name": "Steep Uphill Cycling Route",
                    "summary": {"distance": 5000.0, "duration": 900.0},  # 15 min
                    "extras": {
                        "waytype": {
                            "summary": [{"value": 3, "distance": 5000.0, "amount": 100.0}]
                        },
                        "steepness": {
                            "summary": [{"value": 3, "distance": 5000.0, "amount": 100.0}]
                        },
                    },
                },
                "geometry": {"type": "LineString", "coordinates": [[77.20, 28.61], [77.25, 28.65]]},
            },
        ],
    }

    def mock_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=mock_geojson)

    transport = httpx.MockTransport(mock_handler)
    async with httpx.AsyncClient(transport=transport) as client:
        res = await compare_clean_air_routes(
            origin=(28.61, 77.20),
            destination=(28.65, 77.25),
            mode="cycling",
            background_pm25=80.0,
            persona=PersonaType.healthy_adult,
            mask=MaskType.none,
            mask_fit=MaskFit.sealed,
            client=client,
        )

    # Routes ranked by lowest dose: flat route is cleanest
    flat_route = next(r for r in res.routes if r.name == "Flat Cycling Route")
    uphill_route = next(r for r in res.routes if r.name == "Steep Uphill Cycling Route")

    assert flat_route.steepness_multiplier == 1.00
    assert uphill_route.steepness_multiplier == 1.35

    assert uphill_route.inhaled_dose_ug > flat_route.inhaled_dose_ug
    # Uphill ventilation multiplier is 1.35x
    assert uphill_route.inhaled_dose_ug == pytest.approx(flat_route.inhaled_dose_ug * 1.35, rel=1e-2)


@pytest.mark.asyncio
async def test_osrm_fallback_when_ors_key_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    """Test graceful fallback to OSRM when OPENROUTESERVICE_API_KEY is not set."""
    monkeypatch.delenv("OPENROUTESERVICE_API_KEY", raising=False)

    mock_osrm_payload: dict[str, Any] = {
        "code": "Ok",
        "routes": [
            {
                "distance": 4200.0,
                "duration": 900.0,
                "weight_name": "Ring Road Arterial",
                "legs": [
                    {
                        "steps": [
                            {"name": "Inner Ring Road Highway", "ref": "NH44", "distance": 4200.0}
                        ]
                    }
                ],
            },
            {
                "distance": 4600.0,
                "duration": 1050.0,
                "weight_name": "Sector Park Lane",
                "legs": [
                    {
                        "steps": [
                            {"name": "Sector 14 Residential Lane", "ref": "", "distance": 4600.0}
                        ]
                    }
                ],
            },
        ],
    }

    def mock_handler(request: httpx.Request) -> httpx.Response:
        assert "router.project-osrm.org" in str(request.url)
        return httpx.Response(200, text=json.dumps(mock_osrm_payload))

    transport = httpx.MockTransport(mock_handler)
    async with httpx.AsyncClient(transport=transport) as client:
        res = await compare_clean_air_routes(
            origin=(28.61, 77.20),
            destination=(28.65, 77.25),
            mode="driving",
            background_pm25=100.0,
            persona=PersonaType.healthy_adult,
            mask=MaskType.none,
            client=client,
        )

    assert res.routing_engine == "osrm_fallback"
    assert len(res.routes) == 2

    # LUR inference verification
    highway_step = {"name": "National Highway 44", "ref": "NH44"}
    park_step = {"name": "Central Park Lane Sector 12", "ref": ""}
    assert get_osrm_step_lur_multiplier(highway_step) == 1.38
    assert get_osrm_step_lur_multiplier(park_step) == 0.75


def test_schedule_solver_zero_overlaps_and_dose_savings() -> None:
    """Test schedule solver with 3 tasks (commute 40 min, jog 30 min, ventilate bedroom 60 min):

    asserts zero time overlaps and total_optimized_dose_ug <= baseline_naive_dose_ug.
    """
    # 24-hour diurnal atmospheric forecast:
    # Heavy morning inversion (06:00-09:00: 150-200 µg/m³)
    # Cleaner afternoon solar mixing (11:00-15:00: 20-35 µg/m³)
    pm25_hourly = [
        110.0, 120.0, 130.0, 135.0, 140.0, 150.0,  # 00:00 - 05:00
        170.0, 195.0, 180.0, 120.0, 80.0,          # 06:00 - 10:00
        40.0, 25.0, 20.0, 30.0, 45.0,              # 11:00 - 15:00
        65.0, 90.0, 115.0, 140.0, 135.0, 125.0, 115.0, 110.0,  # 16:00 - 23:00
    ]
    no2_hourly = [20.0] * 24
    o3_hourly = [40.0] * 24

    forecast_data = {
        "hourly": {
            "pm25": pm25_hourly,
            "no2": no2_hourly,
            "o3": o3_hourly,
        }
    }

    # 3 user tasks with overlapping windows:
    # 1. Commute 40 min (earliest 7, latest 10)
    # 2. Jog 30 min (earliest 6, latest 9)
    # 3. Ventilate bedroom 60 min (earliest 11, latest 15)
    tasks = [
        TaskItem(
            name="Morning Commute",
            activity="commute",
            duration_minutes=40,
            earliest_hour=7.0,
            latest_hour=10.0,
            mask=MaskType.none,
            mask_fit=MaskFit.sealed,
        ),
        TaskItem(
            name="Morning Jog",
            activity="jog",
            duration_minutes=30,
            earliest_hour=6.0,
            latest_hour=9.0,
            mask=MaskType.none,
            mask_fit=MaskFit.sealed,
        ),
        TaskItem(
            name="Ventilate Bedroom",
            activity="ventilate_room",
            duration_minutes=60,
            earliest_hour=11.0,
            latest_hour=15.0,
            mask=MaskType.none,
            mask_fit=MaskFit.sealed,
        ),
    ]

    result = solve_schedule(
        tasks=tasks,
        forecast=forecast_data,
        persona=PersonaType.healthy_adult,
        slot_granularity_minutes=5,
    )

    scheduled = result.scheduled_tasks
    assert len(scheduled) == 3

    # Assert zero time overlaps across all scheduled pairs
    for i in range(len(scheduled)):
        for j in range(i + 1, len(scheduled)):
            t1 = scheduled[i]
            t2 = scheduled[j]
            # Verify intervals [start1, end1] and [start2, end2] do not overlap
            overlap = max(0.0, min(t1.end_hour, t2.end_hour) - max(t1.start_hour, t2.start_hour))
            assert overlap < 1e-4, f"Conflict detected between {t1.name} and {t2.name}: overlap={overlap}"

    # Assert scheduled within allowable bounds
    for t in scheduled:
        orig = next(item for item in tasks if item.name == t.name)
        assert t.start_hour >= orig.earliest_hour - 1e-4
        assert t.end_hour <= orig.latest_hour + 1e-4

    # Assert dose optimization: total_optimized_dose_ug <= baseline_naive_dose_ug
    assert result.total_optimized_dose_ug <= result.baseline_naive_dose_ug
    assert result.total_savings_pct > 0.0

    # Specifically verify the bedroom ventilation picked the cleaner midday window
    vent_task = next(t for t in scheduled if t.name == "Ventilate Bedroom")
    assert 12.0 <= vent_task.start_hour <= 14.0  # Lowest outdoor PM2.5 between 12:00-14:00 (20-25 µg/m³)
