"""Critic role plugin: hy3-free @ zen as a dedicated QA-judge tool."""
from __future__ import annotations

import json
import os
import urllib.request

ZEN_URL = "https://opencode.ai/zen/v1/chat/completions"
MODEL = "hy3-free"
TIMEOUT_S = 180

SYSTEM = (
    "Ты — жёсткий QA-критик. Тебе передают ТЗ, артефакты и доказательства "
    "(stdout/exit code). Доёбывайся до качества по 4 фронтам: реальность "
    "(артефакты, а не слова), тест (есть запуск и вывод?), полнота (решено "
    "или на полшишечки), готовность (работает сейчас). Анти-анкоринг: "
    "самооценку исполнителя не принимать. Вердикт: [ПРИНЯТО] или "
    "[ОТКЛОНЕНО] + нумерованные дефекты с цитатами. Без инструментов, "
    "ответь текстом. По-русски, плотно."
)


def _headers() -> dict:
    return {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + os.environ.get("OPENCODE_API_KEY", "public"),
        "x-opencode-client": "cli",
        "x-opencode-session": "hermes-critic-static-ses",
        "x-opencode-project": "hermes-critic-static-proj",
        "x-opencode-request": "hermes-critic-static-req",
        "User-Agent": "opencode/latest/1.3.15/cli",
    }


def _critic(args: dict) -> str:
    request = (args.get("request") or "").strip()
    if not request:
        return json.dumps(
            {"success": False, "error": "пустой request: передай ТЗ + артефакты + DoD"},
            ensure_ascii=False,
        )
    body = json.dumps({
        "model": MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": request},
        ],
        "max_tokens": 4000,
    }).encode()
    req = urllib.request.Request(ZEN_URL, data=body, headers=_headers(), method="POST")
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
            data = json.load(resp)
        content = (data.get("choices") or [{}])[0].get("message", {}).get("content", "")
        return json.dumps(
            {"success": True, "model": MODEL, "verdict": content,
             "usage": data.get("usage", {})},
            ensure_ascii=False,
        )
    except Exception as exc:
        return json.dumps({"success": False, "error": repr(exc)}, ensure_ascii=False)


SCHEMA = {
    "name": "critic",
    "description": (
        "Жёсткий QA-критик (hy3-free). Вызывай ПОСЛЕ завершения задачи с любой "
        "мутацией: вложи дословное ТЗ пользователя, список артефактов, "
        "stdout/stderr/exit code и DoD. Возвращает [ПРИНЯТО]/[ОТКЛОНЕНО] + дефекты."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "request": {
                "type": "string",
                "description": "ТЗ дословно + артефакты + доказательства (stdout/exit code) + критерии готовности.",
            },
        },
        "required": ["request"],
    },
}


def register(ctx) -> None:
    ctx.register_tool(
        name="critic",
        toolset="critic",
        schema=SCHEMA,
        handler=lambda args, **kw: _critic(args),
        emoji="🔍",
    )
