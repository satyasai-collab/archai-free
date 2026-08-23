"""Role-drift monitor plugin: mutations-without-Critic / steps-without-Expert."""
from __future__ import annotations

import json
import time
from pathlib import Path

from hermes_constants import get_hermes_home

STATE_FILE = "role_monitor.json"
LOG_FILE = "expert_drift.log"

MUTATING_TOOLS = {"write_file", "patch", "execute_code", "image_gen"}
EXPERT_TOOLS = {"delegate_task"}
CRITIC_TOOLS = {"critic"}

MAX_STEPS_WITHOUT_EXPERT = 8
MAX_MUTATIONS_WITHOUT_CRITIC = 1


def _state_path() -> Path:
    return get_hermes_home() / STATE_FILE


def _log_path() -> Path:
    return get_hermes_home() / LOG_FILE


def _load() -> dict:
    try:
        return json.loads(_state_path().read_text())
    except Exception:
        return {
            "steps_since_expert": 0,
            "mutations_since_critic": 0,
            "last_expert_ts": None,
            "last_critic_ts": None,
        }


def _save(state: dict) -> None:
    try:
        _state_path().write_text(json.dumps(state, ensure_ascii=False, indent=1))
    except Exception:
        pass


def _log(event: str, detail: str) -> None:
    try:
        with _log_path().open("a") as f:
            f.write(f"{time.strftime('%Y-%m-%dT%H:%M:%S')} {event} :: {detail}\n")
    except Exception:
        pass


def on_post_tool_call(
    tool_name: str = "",
    args: dict | None = None,
    result=None,
    **_,
) -> None:
    state = _load()
    state["steps_since_expert"] += 1

    if tool_name in EXPERT_TOOLS:
        state["steps_since_expert"] = 0
        state["last_expert_ts"] = time.time()

    if tool_name in CRITIC_TOOLS:
        state["mutations_since_critic"] = 0
        state["last_critic_ts"] = time.time()
        _save(state)
        return

    if tool_name in MUTATING_TOOLS:
        state["mutations_since_critic"] += 1
        if state["mutations_since_critic"] > MAX_MUTATIONS_WITHOUT_CRITIC:
            _log("DRIFT",
                 f"mut={state['mutations_since_critic']} without critic "
                 f"tool={tool_name} args={str(args)[:160]}")

    if state["steps_since_expert"] >= MAX_STEPS_WITHOUT_EXPERT:
        _log("DRIFT", f"steps={state['steps_since_expert']} without expert")

    _save(state)


SCHEMA = {
    "name": "monitor_status",
    "description": (
        "Статус ролевого монитора: шаги без Expert, мутации без Critic, "
        "время последних вызовов. Вызывай перед финальным ответом по задаче "
        "с мутациями."
    ),
    "parameters": {"type": "object", "properties": {}, "required": []},
}


def _status(args: dict) -> str:
    s = _load()
    fmt = lambda ts: time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(ts)) if ts else "никогда"
    drift = (
        s["steps_since_expert"] >= MAX_STEPS_WITHOUT_EXPERT
        or s["mutations_since_critic"] > MAX_MUTATIONS_WITHOUT_CRITIC
    )
    return json.dumps({
        "drift_detected": drift,
        "steps_since_expert": s["steps_since_expert"],
        "mutations_since_critic": s["mutations_since_critic"],
        "last_expert": fmt(s.get("last_expert_ts")),
        "last_critic": fmt(s.get("last_critic_ts")),
        "log": str(_log_path()),
    }, ensure_ascii=False)


def register(ctx) -> None:
    ctx.register_hook("post_tool_call", on_post_tool_call)
    ctx.register_tool(
        name="monitor_status",
        toolset="critic",
        schema=SCHEMA,
        handler=lambda args, **kw: _status(args),
        emoji="🛡",
    )
