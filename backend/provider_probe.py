from __future__ import annotations

import json
import urllib.error
import urllib.request

from backend.errors import ServiceError
from backend.fields import group_by_prefix
from backend.secrets import resolve_secret

_OPENAI_KEYS = ("data", "models")


def models_url(base_url: str) -> str:
    base = (base_url or "").strip().rstrip("/")
    if not base:
        raise ServiceError("invalid_document", "缺少 API 基础地址")
    if base.endswith("/models"):
        return base
    return base + "/models"


def parse_models_payload(payload: object) -> list[dict]:
    rows = _rows(payload)
    if rows is None:
        raise ServiceError("probe_failed", "提供商返回的模型列表格式无法识别")
    models = []
    seen = set()
    for row in rows:
        parsed = _parse_row(row)
        if parsed is None or parsed["id"] in seen:
            continue
        seen.add(parsed["id"])
        models.append(parsed)
    models.sort(key=lambda item: item["id"])
    return models


def probe_provider_models(base_url: str, api_key: str | None, timeout: int = 20) -> dict:
    secret = resolve_secret(api_key)
    url = models_url(base_url)
    request = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {secret}",
            "Accept": "application/json",
            "User-Agent": "oc-modal-configurator",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read(8_000_000)
    except urllib.error.HTTPError as exc:
        raise ServiceError("probe_failed", f"拉取模型失败（HTTP {exc.code}）") from exc
    except urllib.error.URLError as exc:
        raise ServiceError("network_error", "无法连接提供商") from exc
    except TimeoutError as exc:
        raise ServiceError("network_error", "连接提供商超时") from exc
    try:
        payload = json.loads(body.decode("utf-8-sig"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ServiceError("probe_failed", "提供商返回的内容不是 JSON") from exc
    models = parse_models_payload(payload)
    return {
        "source": "remote",
        "url": url,
        "models": models,
        "groups": group_by_prefix(models),
    }


def _rows(payload: object) -> list | None:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in _OPENAI_KEYS:
            if isinstance(payload.get(key), list):
                return payload[key]
    return None


def _parse_row(row: object) -> dict | None:
    if isinstance(row, str) and row.strip():
        return {"id": row.strip(), "name": None, "ownedBy": None}
    if not isinstance(row, dict):
        return None
    model_id = row.get("id") or row.get("model") or row.get("name")
    if not isinstance(model_id, str) or not model_id.strip():
        return None
    name = row.get("name") if isinstance(row.get("name"), str) and row.get("id") else None
    owned = row.get("owned_by") or row.get("ownedBy")
    return {
        "id": model_id.strip(),
        "name": name,
        "ownedBy": owned if isinstance(owned, str) else None,
    }

