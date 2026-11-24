"""Unit test suite for FastAPI API endpoints and Dual-LLM Copilot Failover."""

import json
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from api.index import app
from api.services.ai_agent import run_copilot

client = TestClient(app)


def test_health_endpoint() -> None:
    """Verify GET /api/health returns valid status, timestamp, and boolean providers."""
    resp = client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()

    assert data["status"] == "healthy"
    assert "timestamp" in data
    assert "providers" in data

    providers = data["providers"]
    assert "gemini" in providers
    assert "groq" in providers
    assert "openrouteservice" in providers
    assert "openaq" in providers

    # Ensure provider values are booleans and never secrets
    for val in providers.values():
        assert isinstance(val, bool)


def test_presets_endpoint() -> None:
    """Verify GET /api/presets returns the 5 instant demo cities."""
    resp = client.get("/api/presets")
    assert resp.status_code == 200
    data = resp.json()
    assert "presets" in data

    presets = data["presets"]
    assert "Delhi" in presets
    assert "Baddi" in presets
    assert "London" in presets
    assert "Beijing" in presets
    assert "San Francisco" in presets


def test_dose_simulate_endpoint() -> None:
    """Verify POST /api/dose/simulate returns exact clinical dose metrics."""
    payload = {
        "pm25_ug_m3": 120.0,
        "duration_hours": 1.0,
        "activity": "walking",
        "persona": "healthy_adult",
        "mask": "none",
        "mask_fit": "sealed",
    }
    resp = client.post("/api/dose/simulate", json=payload)
    assert resp.status_code == 200
    data = resp.json()

    # walking = 1.2 m³/hr, persona healthy = 1.0, duration = 1.0 hr, mask = 0.0
    # inhaled_dose_ug = 120.0 * 1.2 * 1.0 * 1.0 = 144.0 µg
    assert data["inhaled_dose_ug"] == 144.0
    assert data["deposited_dose_ug"] == pytest.approx(144.0 * 0.45, rel=1e-2)
    assert data["who_daily_budget_pct"] > 0
    assert data["cigarette_equivalent"] > 0
    assert data["breathing_mode"] == "nasal"


@pytest.mark.asyncio
async def test_gemini_429_fails_over_to_groq(monkeypatch: pytest.MonkeyPatch) -> None:
    """Mock Gemini raising HTTP 429 quota error and assert seamless failover to Groq

    with populated tool_trace containing tool_name, arguments, latency_ms, and result_summary.
    """
    monkeypatch.setenv("GEMINI_API_KEY", "mock_gemini_key")
    monkeypatch.setenv("GROQ_API_KEY", "mock_groq_key")

    # 1. Mock Gemini to raise HTTP 429 Quota Exceeded error
    def mock_gemini_generate(*args: object, **kwargs: object) -> None:
        raise RuntimeError("Google API HTTP 429: Resource has been exhausted (quota exceeded).")

    mock_gemini_client = MagicMock()
    mock_gemini_client.models.generate_content.side_effect = mock_gemini_generate

    mock_genai = MagicMock()
    mock_genai.Client.return_value = mock_gemini_client
    monkeypatch.setattr("google.genai.Client", mock_genai.Client)

    # 2. Mock Groq client to handle tool call
    mock_tool_call = MagicMock()
    mock_tool_call.id = "call_sim_dose_123"
    mock_tool_call.function.name = "simulate_inhaled_dose"
    mock_tool_call.function.arguments = json.dumps(
        {
            "pm25": 150.0,
            "activity": "walking",
            "duration_minutes": 60.0,
            "persona": "healthy_adult",
        }
    )

    # First turn: returns tool_calls
    first_choice = MagicMock()
    first_choice.message.tool_calls = [mock_tool_call]
    first_resp = MagicMock()
    first_resp.choices = [first_choice]

    # Second turn: returns final text
    second_choice = MagicMock()
    second_choice.message.tool_calls = None
    second_choice.message.content = "At 150.0 µg/m³ PM2.5, a 60-min walk results in 180.0 µg inhaled dose."
    second_resp = MagicMock()
    second_resp.choices = [second_choice]

    mock_groq_client = AsyncMock()
    mock_groq_client.chat.completions.create = AsyncMock(side_effect=[first_resp, second_resp])

    mock_groq_pkg = MagicMock()
    mock_groq_pkg.AsyncGroq.return_value = mock_groq_client
    monkeypatch.setattr("groq.AsyncGroq", mock_groq_pkg.AsyncGroq)

    # Execute Copilot
    res = await run_copilot("What is my inhaled dose walking in 150 ug/m3 for 60 min?")

    assert res["provider_used"] == "groq_failover"
    assert "180.0" in res["reply"]

    # Verify tool trace
    assert len(res["tool_trace"]) >= 1
    trace_item = res["tool_trace"][0]
    assert trace_item["tool_name"] == "simulate_inhaled_dose"
    assert "arguments" in trace_item
    assert "latency_ms" in trace_item
    assert trace_item["latency_ms"] >= 0.0
    assert "result_summary" in trace_item


@pytest.mark.asyncio
async def test_deterministic_offline_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify that when both Gemini and Groq keys are absent, copilot executes real tools

    offline and returns grounded text with provider_used='deterministic_fallback'.
    """
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GROQ_API_KEY", raising=False)

    res = await run_copilot("Optimize my routine commute and jog schedule")

    assert res["provider_used"] == "deterministic_fallback"
    assert len(res["tool_trace"]) >= 1

    trace_item = res["tool_trace"][0]
    assert trace_item["tool_name"] == "optimize_daily_schedule"
    assert trace_item["arguments"]["lat"] == 28.6139
    assert trace_item["latency_ms"] >= 0.0

    assert "Optimized 24h Schedule" in res["reply"]
    assert "Total optimized dose is" in res["reply"]
    assert res["schedule"] is not None


def test_agent_chat_endpoint_via_testclient(monkeypatch: pytest.MonkeyPatch) -> None:
    """Verify POST /api/agent/chat executes and returns valid structure through FastAPI."""
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GROQ_API_KEY", raising=False)

    payload = {
        "message": "Is there a smog trap right now?",
        "city_or_coords": "Delhi",
        "persona": "healthy_adult",
    }
    resp = client.post("/api/agent/chat", json=payload)
    assert resp.status_code == 200
    data = resp.json()

    assert "reply" in data
    assert "provider_used" in data
    assert "tool_trace" in data
    assert isinstance(data["tool_trace"], list)
    assert len(data["tool_trace"]) >= 1
    assert data["tool_trace"][0]["tool_name"] == "analyze_smog_trap"
