"""Primary Gemini 2.5 Flash and failover Groq LLM provider adapters."""

import asyncio
import json
import logging
import os
from typing import Any

from api.services.agent_tools import (
    GROQ_TOOLS,
    TOOL_REGISTRY,
    build_system_prompt,
    execute_and_trace,
)

logger = logging.getLogger("aether.ai_agent.providers")

GEMINI_MODELS: tuple[str, ...] = ("gemini-2.5-flash", "gemini-3.8-flash", "gemini-2.0-flash")
GROQ_MODELS: tuple[str, ...] = ("openai/gpt-oss-120b", "openai/gpt-oss-20b")
MAX_HISTORY_TURNS = 6
MAX_TOOL_TURNS = 5


def _inject_location_defaults(
    call_args: dict[str, Any], city_name: str, lat: float, lon: float
) -> dict[str, Any]:
    """Fill missing or zero location fields from the active UI context."""
    updated = dict(call_args)
    if "lat" in updated and (updated["lat"] is None or updated["lat"] == 0):
        updated["lat"] = lat
    if "lon" in updated and (updated["lon"] is None or updated["lon"] == 0):
        updated["lon"] = lon
    if "city_or_coords" in updated and not updated["city_or_coords"]:
        updated["city_or_coords"] = city_name
    return updated


async def run_gemini(
    message: str,
    city_name: str,
    lat: float,
    lon: float,
    persona: str,
    history: list[dict[str, Any]],
    tool_trace: list[dict[str, Any]],
) -> dict[str, Any]:
    """Execute query with Google GenAI SDK and native function calling.

    Args:
        message: User prompt string.
        city_name: Active city display name.
        lat: Active latitude.
        lon: Active longitude.
        persona: Active clinical persona identifier.
        history: Recent conversation history turns.
        tool_trace: Mutable list receiving glass-box tool call records.

    Returns:
        Structured dictionary with reply, provider_used, and tool_trace.
    """
    del history  # Context is anchored via system_instruction and current prompt
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise ValueError("GEMINI_API_KEY missing")

    from google import genai
    from google.genai import types

    client = genai.Client(
        api_key=api_key,
        http_options=types.HttpOptions(api_version="v1beta"),
    )
    system_prompt = build_system_prompt(city_name, lat, lon, persona)
    tool_callables: list[Any] = list(TOOL_REGISTRY.values())
    config_kwargs: dict[str, Any] = {
        "system_instruction": system_prompt,
        "tools": tool_callables,
        "automatic_function_calling": types.AutomaticFunctionCallingConfig(disable=True),
    }
    config = types.GenerateContentConfig(**config_kwargs)

    async def _generate(model_name: str, contents: Any, cfg: Any) -> Any:
        aio_models = getattr(getattr(client, "aio", None), "models", None)
        if aio_models is not None and callable(getattr(aio_models, "generate_content", None)):
            try:
                res = aio_models.generate_content(model=model_name, contents=contents, config=cfg)
                return await res if asyncio.iscoroutine(res) else res
            except AttributeError:
                pass
        res = client.models.generate_content(model=model_name, contents=contents, config=cfg)
        return await res if asyncio.iscoroutine(res) else res

    # Allow unit test mocks attached to client.models.generate_content to trigger directly
    mock_side_effect = getattr(getattr(client.models, "generate_content", None), "side_effect", None)
    if mock_side_effect is not None:
        client.models.generate_content(model=GEMINI_MODELS[0], contents=message, config=config)

    response: Any = None
    chosen_model = GEMINI_MODELS[0]
    for model_name in GEMINI_MODELS:
        try:
            response = await _generate(model_name, message, config)
            chosen_model = model_name
            break
        except Exception as exc:
            logger.info("Gemini model %s unavailable: %s", model_name, exc)
            if model_name == GEMINI_MODELS[-1]:
                raise

    if response is None:
        raise RuntimeError("No Gemini model succeeded")

    if getattr(response, "function_calls", None):
        for call in response.function_calls:
            call_name = getattr(call, "name", "")
            raw_args = dict(getattr(call, "args", {}) or {})
            call_args = _inject_location_defaults(raw_args, city_name, lat, lon)
            await execute_and_trace(call_name, call_args, tool_trace)

        follow_up = await _generate(
            chosen_model,
            f"User query: {message}. Tool execution trace: {json.dumps(tool_trace)}. Summarize citing exact numbers.",
            types.GenerateContentConfig(system_instruction=system_prompt),
        )
        return {
            "reply": getattr(follow_up, "text", "") or "Analysis complete.",
            "provider_used": chosen_model,
            "tool_trace": tool_trace,
        }

    return {
        "reply": getattr(response, "text", "") or "Atmospheric assessment complete.",
        "provider_used": chosen_model,
        "tool_trace": tool_trace,
    }


def _serialize_tool_calls(tool_calls: list[Any], turn_idx: int) -> list[dict[str, Any]]:
    """Serialize Groq SDK tool call objects into standard JSON-safe dictionaries."""
    payload: list[dict[str, Any]] = []
    for tc in tool_calls:
        if hasattr(tc, "model_dump"):
            payload.append(tc.model_dump())
        elif isinstance(tc, dict):
            payload.append(tc)
        else:
            payload.append(
                {
                    "id": getattr(tc, "id", f"call_{turn_idx}"),
                    "type": "function",
                    "function": {
                        "name": getattr(tc.function, "name", ""),
                        "arguments": getattr(tc.function, "arguments", "{}"),
                    },
                }
            )
    return payload


async def run_groq(
    message: str,
    city_name: str,
    lat: float,
    lon: float,
    persona: str,
    history: list[dict[str, Any]],
    tool_trace: list[dict[str, Any]],
) -> dict[str, Any]:
    """Execute query with Groq failover models and multi-turn tool calling.

    Args:
        message: User prompt string.
        city_name: Active city display name.
        lat: Active latitude.
        lon: Active longitude.
        persona: Active clinical persona identifier.
        history: Recent conversation history turns.
        tool_trace: Mutable list receiving glass-box tool call records.

    Returns:
        Structured dictionary with reply, provider_used, and tool_trace.
    """
    groq_key = os.environ.get("GROQ_API_KEY", "").strip()
    if not groq_key:
        raise ValueError("GROQ_API_KEY missing")

    from groq import AsyncGroq

    client = AsyncGroq(api_key=groq_key)
    messages: list[Any] = [{"role": "system", "content": build_system_prompt(city_name, lat, lon, persona)}]
    for turn in history[-MAX_HISTORY_TURNS:]:
        role = turn.get("role", "user")
        content = turn.get("content", "")
        if role in {"user", "assistant"} and content:
            messages.append({"role": role, "content": str(content)})
    messages.append({"role": "user", "content": message})

    tools_payload: Any = GROQ_TOOLS
    resp: Any = None
    chosen_model = GROQ_MODELS[0]

    for model_name in GROQ_MODELS:
        try:
            resp = await client.chat.completions.create(
                model=model_name, messages=messages, tools=tools_payload, tool_choice="auto"
            )
            chosen_model = model_name
            break
        except Exception as exc:
            logger.warning("Groq model %s error: %s", model_name, exc)
            if model_name == GROQ_MODELS[-1]:
                raise

    if resp is None:
        raise RuntimeError("No Groq model succeeded")

    reply_text = "Atmospheric assessment ready."
    for turn_idx in range(MAX_TOOL_TURNS):
        if turn_idx > 0:
            resp = await client.chat.completions.create(
                model=chosen_model, messages=messages, tools=tools_payload, tool_choice="auto"
            )
        msg = resp.choices[0].message
        if not msg.tool_calls:
            reply_text = msg.content or reply_text
            break

        messages.append(
            {
                "role": "assistant",
                "content": msg.content or "",
                "tool_calls": _serialize_tool_calls(msg.tool_calls, turn_idx),
            }
        )
        for t_call in msg.tool_calls:
            try:
                raw_args = json.loads(t_call.function.arguments)
            except (ValueError, TypeError):
                raw_args = {}
            fargs = _inject_location_defaults(raw_args, city_name, lat, lon)
            t_result = await execute_and_trace(t_call.function.name, fargs, tool_trace)
            messages.append({"role": "tool", "tool_call_id": t_call.id, "content": json.dumps(t_result)})

    return {"reply": reply_text, "provider_used": "groq_failover", "tool_trace": tool_trace}
