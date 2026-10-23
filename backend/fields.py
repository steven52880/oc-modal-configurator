from __future__ import annotations

from backend.errors import ServiceError

PROVIDER_OPTION_KEYS = (
    "baseURL",
    "apiKey",
    "setCacheKey",
    "timeout",
    "headerTimeout",
    "chunkTimeout",
    "headers",
)
TIMEOUT_KEYS = ("timeout", "headerTimeout", "chunkTimeout")
CAPABILITY_KEYS = ("attachment", "tool_call", "reasoning", "temperature")
LIMIT_KEYS = ("context", "output", "input")
COST_KEYS = ("input", "output", "cache_read", "cache_write")
META_KEYS = (
    "family",
    "release_date",
    "status",
)
# models.dev 元数据中不属于 opencode schema 的字段：读取时丢弃，不再写回
DROPPED_META_KEYS = (
    "last_updated",
    "knowledge",
    "open_weights",
    "canonical_model_id",
    "description",
)
VARIANT_ORDER = ("none", "minimal", "low", "medium", "high", "xhigh", "max")
OFFICIAL_PROVIDER_IDS = frozenset({"openai", "deepseek", "anthropic", "google"})


def optional_str(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    raise ServiceError("invalid_document", "文本字段的类型不正确")


def optional_bool(value: object) -> bool | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    raise ServiceError("invalid_document", "布尔字段的类型不正确")


def optional_number(value: object) -> int | float | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise ServiceError("invalid_document", "数字字段不能是布尔值")
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value) if value.is_integer() else value
    if isinstance(value, str):
        text = value.strip().replace(",", "").replace("_", "")
        if not text:
            return None
        try:
            if any(mark in text.lower() for mark in (".", "e")):
                number = float(text)
                return int(number) if number.is_integer() else number
            return int(text)
        except ValueError as exc:
            raise ServiceError("invalid_document", f"无法解析数字：{value}") from exc
    raise ServiceError("invalid_document", "数字字段的类型不正确")


def optional_timeout(value: object) -> int | float | bool | None:
    if value is None:
        return None
    if value is False:
        return False
    if value is True:
        raise ServiceError("invalid_document", "超时只能是毫秒数或 false")
    number = optional_number(value)
    if number is None:
        return None
    if number < 0:
        raise ServiceError("invalid_document", "超时必须是非负毫秒数或 false")
    return number


def string_list(value: object) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [part.strip() for part in value.split(",") if part.strip()]
    if isinstance(value, list):
        return [str(item) for item in value if item not in (None, "")]
    raise ServiceError("invalid_document", "列表字段必须是数组")


def coerce_headers(value: object) -> dict:
    if value is None:
        return {}
    if isinstance(value, dict):
        return {str(key): "" if item is None else item for key, item in value.items() if str(key)}
    if isinstance(value, list):
        headers: dict = {}
        for item in value:
            if isinstance(item, dict):
                name = item.get("name", item.get("key"))
                if name:
                    headers[str(name)] = "" if item.get("value") is None else item.get("value")
            elif isinstance(item, (list, tuple)) and len(item) >= 2 and item[0]:
                headers[str(item[0])] = item[1]
        return headers
    raise ServiceError("invalid_document", "headers 必须是对象或键值列表")


def normalize_interleaved(value: object) -> bool | str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        text = value.strip()
        if text == "true":
            return True
        if text == "false":
            return False
        return text or None
    if isinstance(value, dict):
        field = value.get("field")
        if isinstance(field, str) and field.strip():
            return field.strip()
        return None
    raise ServiceError("invalid_document", "interleaved 的值无法识别")


def denormalize_interleaved(value: object) -> bool | dict | None:
    normalized = normalize_interleaved(value)
    if normalized is None:
        return None
    if isinstance(normalized, bool):
        return normalized
    return {"field": normalized}


def variants_from_reasoning(options: object) -> dict[str, dict]:
    keys: list[str] = []
    if isinstance(options, list):
        for item in options:
            if not isinstance(item, dict) or item.get("type") != "effort":
                continue
            for value in item.get("values") or []:
                if isinstance(value, str) and value not in keys:
                    keys.append(value)
    order = {name: index for index, name in enumerate(VARIANT_ORDER)}
    keys.sort(key=lambda item: (order.get(item, len(order)), item))
    return {key: {} for key in keys}


def model_prefix(model_id: str) -> str:
    name = model_id.split("/")[-1].lstrip("~").strip()
    prefix = name.split("-", 1)[0].strip()
    return (prefix or name or model_id).lower()


def group_by_prefix(models: list[dict], id_key: str = "id") -> list[dict]:
    groups: dict[str, list] = {}
    for model in models:
        prefix = model_prefix(str(model.get(id_key, "")))
        groups.setdefault(prefix, []).append(model)
    ordered = []
    for prefix in sorted(groups):
        items = sorted(groups[prefix], key=lambda item: str(item.get(id_key, "")))
        ordered.append({"prefix": prefix, "models": items})
    return ordered
