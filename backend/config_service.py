from __future__ import annotations

import shutil
from pathlib import Path

from backend.errors import ServiceError
from backend.fields import (
    CAPABILITY_KEYS,
    COST_KEYS,
    LIMIT_KEYS,
    META_KEYS,
    PROVIDER_OPTION_KEYS,
    TIMEOUT_KEYS,
    coerce_headers,
    denormalize_interleaved,
    normalize_interleaved,
    optional_bool,
    optional_number,
    optional_str,
    optional_timeout,
    string_list,
)
from backend.jsonio import read_json, write_json
from backend.paths import default_opencode_path


class ConfigService:
    def __init__(self, default_path: Path | None = None):
        self.default_path = Path(default_path) if default_path is not None else default_opencode_path()

    def load(self, path: str | Path | None = None) -> dict:
        target = Path(path).expanduser() if path else self.default_path
        if not target.exists():
            return document_from_raw({}, target, False, None)
        if not target.is_file():
            raise ServiceError("io_error", f"路径不是文件：{target}")
        raw = read_json(target)
        if not isinstance(raw, dict):
            raise ServiceError("invalid_json", "配置文件的顶层必须是 JSON 对象")
        return document_from_raw(raw, target, True, target.stat().st_mtime_ns)

    def save(self, document: dict, force: bool = False) -> dict:
        if not isinstance(document, dict):
            raise ServiceError("invalid_document", "保存内容必须是对象")
        if "preserved" not in document:
            raise ServiceError("invalid_document", "缺少 preserved，已拒绝保存以免丢失其它字段")
        path_value = document.get("path")
        if not isinstance(path_value, str) or not path_value.strip():
            raise ServiceError("invalid_document", "缺少配置文件路径")
        target = Path(path_value).expanduser()
        _check_mtime(target, document.get("mtimeNs"), bool(force))
        raw = to_raw(document)
        target.parent.mkdir(parents=True, exist_ok=True)
        backup = None
        if target.exists():
            backup = target.with_name(target.name + ".bak")
            shutil.copy2(target, backup)
        write_json(target, raw)
        return {
            "path": str(target),
            "backupPath": None if backup is None else str(backup),
            "mtimeNs": str(target.stat().st_mtime_ns),
        }


def document_from_raw(raw: dict, path: Path, exists: bool, mtime_ns: int | None) -> dict:
    providers_raw = raw.get("provider", {}) if exists or "provider" in raw else {}
    if providers_raw is None:
        providers_raw = {}
    if not isinstance(providers_raw, dict):
        raise ServiceError("invalid_json", "provider 必须是对象")
    preserved = {key: value for key, value in raw.items() if key != "provider"}
    return {
        "path": str(path),
        "exists": exists,
        "mtimeNs": None if mtime_ns is None else str(mtime_ns),
        "preserved": preserved,
        "providers": [_normalize_provider(str(key), value) for key, value in providers_raw.items()],
    }


def to_raw(document: dict) -> dict:
    preserved = document.get("preserved")
    if not isinstance(preserved, dict):
        raise ServiceError("invalid_document", "preserved 必须是对象")
    providers = document.get("providers")
    if not isinstance(providers, list):
        raise ServiceError("invalid_document", "providers 必须是数组")
    raw = dict(preserved)
    raw.pop("provider", None)
    body: dict = {}
    for provider in providers:
        if not isinstance(provider, dict):
            raise ServiceError("invalid_document", "提供商必须是对象")
        key = _required_key(provider.get("key"), "提供商标识符")
        if key in body:
            raise ServiceError("validation_error", f"提供商标识符重复：{key}")
        body[key] = _provider_to_raw(provider)
    raw["provider"] = body
    return raw


def _normalize_provider(key: str, value: object) -> dict:
    if not isinstance(value, dict):
        raise ServiceError("invalid_json", f"提供商 {key} 必须是对象")
    options = value.get("options")
    if options is None:
        options = {}
    if not isinstance(options, dict):
        raise ServiceError("invalid_json", f"提供商 {key} 的 options 必须是对象")
    models = value.get("models", {})
    if models is None:
        models = {}
    if not isinstance(models, dict):
        raise ServiceError("invalid_json", f"提供商 {key} 的 models 必须是对象")
    known, extra = _split_provider_options(options)
    return {
        "key": key,
        "name": optional_str(value.get("name")) if "name" in value else None,
        "npm": optional_str(value.get("npm")) if "npm" in value else None,
        "options": known,
        "optionsExtra": extra,
        "extra": {item_key: item for item_key, item in value.items() if item_key not in {"name", "npm", "options", "models"}},
        "models": [_normalize_model(str(model_key), model) for model_key, model in models.items()],
    }


def _split_provider_options(options: dict) -> tuple[dict, dict]:
    known = {
        "baseURL": optional_str(options.get("baseURL")) if "baseURL" in options else None,
        "apiKey": optional_str(options.get("apiKey")) if "apiKey" in options else None,
        "setCacheKey": optional_bool(options.get("setCacheKey")) if "setCacheKey" in options else None,
        "timeout": optional_timeout(options.get("timeout")) if "timeout" in options else None,
        "headerTimeout": optional_timeout(options.get("headerTimeout")) if "headerTimeout" in options else None,
        "chunkTimeout": optional_timeout(options.get("chunkTimeout")) if "chunkTimeout" in options else None,
        "headers": coerce_headers(options.get("headers")) if "headers" in options else {},
    }
    extra = {key: value for key, value in options.items() if key not in PROVIDER_OPTION_KEYS}
    return known, extra


def _normalize_model(key: str, value: object) -> dict:
    if not isinstance(value, dict):
        raise ServiceError("invalid_json", f"模型 {key} 必须是对象")
    consumed = {
        "name",
        "id",
        "attachment",
        "tool_call",
        "reasoning",
        "temperature",
        "interleaved",
        "limit",
        "modalities",
        "variants",
        "cost",
        "options",
        "headers",
        "provider",
        *META_KEYS,
    }
    modalities = value.get("modalities") if "modalities" in value else None
    if modalities is not None and not isinstance(modalities, dict):
        raise ServiceError("invalid_json", f"模型 {key} 的 modalities 必须是对象")
    return {
        "key": key,
        "name": optional_str(value.get("name")) if "name" in value else None,
        "id": optional_str(value.get("id")) if "id" in value else None,
        "attachment": optional_bool(value.get("attachment")) if "attachment" in value else None,
        "tool_call": optional_bool(value.get("tool_call")) if "tool_call" in value else None,
        "reasoning": optional_bool(value.get("reasoning")) if "reasoning" in value else None,
        "temperature": optional_bool(value.get("temperature")) if "temperature" in value else None,
        "interleaved": normalize_interleaved(value.get("interleaved")) if "interleaved" in value else None,
        "limit": _normalize_limit(value.get("limit")) if "limit" in value else _empty_limit(),
        "modalities": None
        if modalities is None
        else {
            "input": string_list(modalities.get("input")),
            "output": string_list(modalities.get("output")),
        },
        "variants": _normalize_variants(value.get("variants")) if "variants" in value else {},
        "cost": _normalize_cost(value.get("cost")) if "cost" in value else _empty_cost(),
        "options": _object(value.get("options"), "options") if "options" in value else {},
        "headers": coerce_headers(value.get("headers")) if "headers" in value else {},
        "provider": _normalize_model_provider(value.get("provider")) if "provider" in value else _empty_model_provider(),
        "meta": {item: value.get(item) if item in value else None for item in META_KEYS},
        "extra": {item_key: item for item_key, item in value.items() if item_key not in consumed},
    }


def _empty_limit() -> dict:
    return {"context": None, "output": None, "input": None, "extra": {}}


def _empty_cost() -> dict:
    return {"input": None, "output": None, "cache_read": None, "cache_write": None, "extra": {}}


def _empty_model_provider() -> dict:
    return {"npm": None, "api": None, "extra": {}}


def _normalize_limit(value: object) -> dict:
    if not isinstance(value, dict):
        raise ServiceError("invalid_json", "limit 必须是对象")
    return {
        "context": optional_number(value.get("context")) if "context" in value else None,
        "output": optional_number(value.get("output")) if "output" in value else None,
        "input": optional_number(value.get("input")) if "input" in value else None,
        "extra": {key: item for key, item in value.items() if key not in LIMIT_KEYS},
    }


def _normalize_cost(value: object) -> dict:
    if not isinstance(value, dict):
        raise ServiceError("invalid_json", "cost 必须是对象")
    return {
        "input": optional_number(value.get("input")) if "input" in value else None,
        "output": optional_number(value.get("output")) if "output" in value else None,
        "cache_read": optional_number(value.get("cache_read")) if "cache_read" in value else None,
        "cache_write": optional_number(value.get("cache_write")) if "cache_write" in value else None,
        "extra": {key: item for key, item in value.items() if key not in COST_KEYS},
    }


def _normalize_variants(value: object) -> dict:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ServiceError("invalid_json", "variants 必须是对象")
    variants = {}
    for key, item in value.items():
        name = str(key).strip()
        if not name or item is False or item is None:
            continue
        if item is True:
            variants[name] = {}
        elif isinstance(item, dict):
            variants[name] = item
        else:
            raise ServiceError("invalid_document", f"变体 {name} 必须是对象")
    return variants


def _normalize_model_provider(value: object) -> dict:
    if not isinstance(value, dict):
        raise ServiceError("invalid_json", "模型 provider 必须是对象")
    return {
        "npm": optional_str(value.get("npm")) if "npm" in value else None,
        "api": optional_str(value.get("api")) if "api" in value else None,
        "extra": {key: item for key, item in value.items() if key not in {"npm", "api"}},
    }


def _provider_to_raw(provider: dict) -> dict:
    raw = _object(provider.get("extra"), "提供商 extra")
    _put_text(raw, "name", provider.get("name"))
    _put_text(raw, "npm", provider.get("npm"))
    options = _provider_options_to_raw(provider)
    if options:
        raw["options"] = options
    models = provider.get("models")
    if not isinstance(models, list):
        raise ServiceError("invalid_document", "models 必须是数组")
    body: dict = {}
    for model in models:
        if not isinstance(model, dict):
            raise ServiceError("invalid_document", "模型必须是对象")
        key = _required_key(model.get("key"), "模型标识符")
        if key in body:
            raise ServiceError("validation_error", f"模型标识符重复：{key}")
        body[key] = _model_to_raw(model)
    raw["models"] = body
    return raw


def _provider_options_to_raw(provider: dict) -> dict:
    options = provider.get("options") or {}
    if not isinstance(options, dict):
        raise ServiceError("invalid_document", "options 必须是对象")
    raw = _object(provider.get("optionsExtra"), "optionsExtra")
    for key in PROVIDER_OPTION_KEYS:
        raw.pop(key, None)
    _put_text(raw, "baseURL", options.get("baseURL"))
    _put_text(raw, "apiKey", options.get("apiKey"))
    if options.get("setCacheKey") is not None:
        raw["setCacheKey"] = bool(options["setCacheKey"])
    for key in TIMEOUT_KEYS:
        if options.get(key) is not None:
            raw[key] = optional_timeout(options.get(key))
    headers = coerce_headers(options.get("headers"))
    if headers:
        raw["headers"] = headers
    return raw


def _model_to_raw(model: dict) -> dict:
    raw = _object(model.get("extra"), "模型 extra")
    _put_text(raw, "name", model.get("name"))
    _put_text(raw, "id", model.get("id"))
    for key in CAPABILITY_KEYS:
        if model.get(key) is not None:
            raw[key] = bool(model[key])
    interleaved = denormalize_interleaved(model.get("interleaved"))
    if interleaved is not None:
        raw["interleaved"] = interleaved
    limit = _limit_to_raw(model.get("limit"))
    if limit:
        raw["limit"] = limit
    modalities = model.get("modalities")
    if isinstance(modalities, dict):
        incoming = string_list(modalities.get("input"))
        outgoing = string_list(modalities.get("output"))
        if incoming or outgoing:
            raw["modalities"] = {"input": incoming, "output": outgoing}
    variants = _normalize_variants(model.get("variants"))
    if variants:
        raw["variants"] = variants
    cost = _cost_to_raw(model.get("cost"))
    if cost:
        raw["cost"] = cost
    options = model.get("options") or {}
    if options:
        if not isinstance(options, dict):
            raise ServiceError("invalid_document", "模型 options 必须是对象")
        raw["options"] = options
    headers = coerce_headers(model.get("headers"))
    if headers:
        raw["headers"] = headers
    provider = _model_provider_to_raw(model.get("provider"))
    if provider:
        raw["provider"] = provider
    meta = model.get("meta") or {}
    if not isinstance(meta, dict):
        raise ServiceError("invalid_document", "meta 必须是对象")
    for key in META_KEYS:
        if meta.get(key) is not None:
            raw[key] = meta[key]
    return raw


def _limit_to_raw(value: object) -> dict | None:
    if not isinstance(value, dict):
        return None
    raw = _object(value.get("extra"), "limit.extra")
    for key in LIMIT_KEYS:
        number = optional_number(value.get(key))
        if number is not None:
            raw[key] = number
    return raw or None


def _cost_to_raw(value: object) -> dict | None:
    if not isinstance(value, dict):
        return None
    raw = _object(value.get("extra"), "cost.extra")
    for key in COST_KEYS:
        number = optional_number(value.get(key))
        if number is not None:
            raw[key] = number
    return raw or None


def _model_provider_to_raw(value: object) -> dict | None:
    if not isinstance(value, dict):
        return None
    raw = _object(value.get("extra"), "模型 provider.extra")
    _put_text(raw, "npm", value.get("npm"))
    _put_text(raw, "api", value.get("api"))
    return raw or None


def _object(value: object, label: str) -> dict:
    if value is None:
        return {}
    if isinstance(value, dict):
        return dict(value)
    raise ServiceError("invalid_document", f"{label} 必须是对象")


def _put_text(raw: dict, key: str, value: object) -> None:
    if isinstance(value, str) and value != "":
        raw[key] = value


def _required_key(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ServiceError("validation_error", f"{label}不能为空")
    return value.strip()


def _check_mtime(path: Path, expected: object, force: bool) -> None:
    if force:
        return
    if not path.exists():
        if expected not in (None, ""):
            raise ServiceError("conflict", "配置文件已被删除，请重新加载")
        return
    actual = str(path.stat().st_mtime_ns)
    if expected is None or str(expected) != actual:
        raise ServiceError("conflict", "配置文件在外部被修改，请重新加载后再保存")
