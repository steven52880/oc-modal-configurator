from __future__ import annotations

import copy
import shutil
from pathlib import Path

from backend.errors import ServiceError
from backend.fields import (
    CAPABILITY_KEYS,
    COST_KEYS,
    DROPPED_META_KEYS,
    LIMIT_KEYS,
    META_KEYS,
    PROVIDER_OPTION_KEYS,
    TIMEOUT_KEYS,
    coerce_headers,
    denormalize_cache,
    denormalize_interleaved,
    empty_cache,
    normalize_cache,
    normalize_interleaved,
    validate_cache,
    optional_bool,
    optional_number,
    optional_str,
    optional_timeout,
    string_list,
)
from backend.jsonio import read_json, write_json
from backend.paths import default_opencode_path
from backend.version import opencode_runtime


def raw_format(document: dict) -> str:
    fmt = document.get("format", "v1")
    return fmt if fmt in ("v1", "v2") else "v1"


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
            "format": raw_format(document),
        }


def detect_format(raw: dict, runtime: dict) -> tuple[str, str]:
    if isinstance(raw.get("providers"), dict):
        return "v2", "file"
    if isinstance(raw.get("provider"), dict):
        return "v1", "file"
    major = (runtime or {}).get("major")
    if isinstance(major, int) and not isinstance(major, bool):
        if major >= 2:
            return "v2", "runtime"
        if major == 1:
            return "v1", "runtime"
    return "v1", "default"


def _container_key(fmt: str) -> str:
    return "providers" if fmt == "v2" else "provider"


def document_from_raw(
    raw: dict,
    path: Path,
    exists: bool,
    mtime_ns: int | None,
    runtime: dict | None = None,
) -> dict:
    if runtime is None:
        runtime = opencode_runtime()
    runtime = dict(runtime)
    fmt, fmt_source = detect_format(raw, runtime)
    container = _container_key(fmt)
    providers_raw = raw.get(container, {})
    if providers_raw is None:
        providers_raw = {}
    if not isinstance(providers_raw, dict):
        raise ServiceError("invalid_json", f"{container} 必须是对象")
    preserved = {key: value for key, value in raw.items() if key != container}
    return {
        "source": "opencode",
        "path": str(path),
        "exists": exists,
        "mtimeNs": None if mtime_ns is None else str(mtime_ns),
        "format": fmt,
        "formatSource": fmt_source,
        "opencode": runtime,
        "preserved": preserved,
        "providers": [_normalize_provider(str(key), value, fmt) for key, value in providers_raw.items()],
    }


def to_raw(document: dict) -> dict:
    preserved = document.get("preserved")
    if not isinstance(preserved, dict):
        raise ServiceError("invalid_document", "preserved 必须是对象")
    providers = document.get("providers")
    if not isinstance(providers, list):
        raise ServiceError("invalid_document", "providers 必须是数组")
    fmt = document.get("format", "v1")
    if fmt not in ("v1", "v2"):
        raise ServiceError("invalid_document", "format 必须是 v1 或 v2")
    container = _container_key(fmt)
    raw = dict(preserved)
    raw.pop(container, None)
    body: dict = {}
    for provider in providers:
        if not isinstance(provider, dict):
            raise ServiceError("invalid_document", "提供商必须是对象")
        key = _required_key(provider.get("key"), "提供商标识符")
        if key in body:
            raise ServiceError("validation_error", f"提供商标识符重复：{key}")
        body[key] = _provider_to_raw(provider, fmt)
    raw[container] = body
    return raw


def _normalize_provider(key: str, value: object, fmt: str = "v1") -> dict:
    if not isinstance(value, dict):
        raise ServiceError("invalid_json", f"提供商 {key} 必须是对象")
    v2 = fmt == "v2"
    options_key = "settings" if v2 else "options"
    options = value.get(options_key)
    if options is None:
        options = {}
    if not isinstance(options, dict):
        raise ServiceError("invalid_json", f"提供商 {key} 的 {options_key} 必须是对象")
    models = value.get("models", {})
    if models is None:
        models = {}
    if not isinstance(models, dict):
        raise ServiceError("invalid_json", f"提供商 {key} 的 models 必须是对象")
    if v2 and "headers" in value:
        options = {**options, "headers": value.get("headers")}
    known, extra = _split_provider_options(options)
    npm_key = "package" if v2 else "npm"
    consumed = {"name", npm_key, options_key, "models"}
    if v2:
        consumed.add("headers")
    normalize_model = _normalize_model_v2 if v2 else _normalize_model
    return {
        "key": key,
        "name": optional_str(value.get("name")) if "name" in value else None,
        "npm": optional_str(value.get(npm_key)) if npm_key in value else None,
        "options": known,
        "optionsExtra": extra,
        "extra": {item_key: item for item_key, item in value.items() if item_key not in consumed},
        "models": [normalize_model(str(model_key), model) for model_key, model in models.items()],
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
        *DROPPED_META_KEYS,
    }
    modalities = value.get("modalities") if "modalities" in value else None
    if modalities is not None and not isinstance(modalities, dict):
        raise ServiceError("invalid_json", f"模型 {key} 的 modalities 必须是对象")
    options = _object(value.get("options"), "options") if "options" in value else {}
    options, cache = _split_cache(options)
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
        "variantExtras": {},
        "cost": _normalize_cost(value.get("cost")) if "cost" in value else _empty_cost(),
        "options": options,
        "cache": cache,
        "headers": coerce_headers(value.get("headers")) if "headers" in value else {},
        "provider": _normalize_model_provider(value.get("provider")) if "provider" in value else _empty_model_provider(),
        "meta": {item: value.get(item) if item in value else None for item in META_KEYS},
        "extra": {item_key: item for item_key, item in value.items() if item_key not in consumed},
    }


def _split_cache(options: dict) -> tuple[dict, dict]:
    """Move a well-formed `cache` out of options; leave anything odd untouched."""
    if "cache" not in options:
        return options, empty_cache()
    cache, fits = normalize_cache(options["cache"])
    if not fits:
        return options, empty_cache()
    return {key: item for key, item in options.items() if key != "cache"}, cache


def _options_to_raw(model: dict) -> dict:
    options = model.get("options") or {}
    if not isinstance(options, dict):
        raise ServiceError("invalid_document", "模型 options 必须是对象")
    options = dict(options)
    cache = model.get("cache")
    validate_cache(cache)
    encoded = denormalize_cache(cache)
    if encoded is not None:
        options["cache"] = encoded
    return options


_V2_MODEL_CONSUMED = {
    "name",
    "modelID",
    "capabilities",
    "compatibility",
    "variants",
    "cost",
    "settings",
    "headers",
    "package",
    "family",
    "releaseDate",
}


def _normalize_model_v2(key: str, value: object) -> dict:
    if not isinstance(value, dict):
        raise ServiceError("invalid_json", f"模型 {key} 必须是对象")
    extra = {k: v for k, v in value.items() if k not in _V2_MODEL_CONSUMED}
    caps = value.get("capabilities") if "capabilities" in value else None
    if caps is not None and not isinstance(caps, dict):
        raise ServiceError("invalid_json", f"模型 {key} 的 capabilities 必须是对象")
    caps_extra = copy.deepcopy(caps) if caps else {}
    tools = optional_bool(caps_extra.pop("tools")) if "tools" in caps_extra else None
    temperature = optional_bool(caps_extra.pop("temperature")) if "temperature" in caps_extra else None
    cap_in = caps_extra.pop("input") if "input" in caps_extra else None
    cap_out = caps_extra.pop("output") if "output" in caps_extra else None
    reasoning = None
    reasoning_raw = caps_extra.get("reasoning")
    if isinstance(reasoning_raw, dict):
        if "supported" in reasoning_raw:
            reasoning = optional_bool(reasoning_raw.pop("supported"))
        if not reasoning_raw:
            caps_extra.pop("reasoning")
    modalities = None
    attachment = None
    if cap_in is not None or cap_out is not None:
        modalities = {"input": string_list(cap_in), "output": string_list(cap_out)}
        if cap_in is not None:
            attachment = any(item in ("image", "pdf", "audio", "video") for item in modalities["input"])
    if caps_extra:
        extra["capabilities"] = caps_extra
    interleaved = None
    compat = copy.deepcopy(value.get("compatibility")) if "compatibility" in value else None
    if isinstance(compat, dict):
        field = compat.get("reasoningField")
        if isinstance(field, str) and field.strip():
            interleaved = field.strip()
            compat.pop("reasoningField")
        if compat:
            extra["compatibility"] = compat
    elif "compatibility" in value:
        extra["compatibility"] = compat
    variants: dict = {}
    variant_extras: dict = {}
    if "variants" in value:
        parsed = _variants_from_array(value.get("variants"))
        if parsed is None:
            extra["variants"] = value.get("variants")
        else:
            variants, variant_extras = parsed
    cost = _empty_cost()
    if "cost" in value:
        raw_cost = value.get("cost")
        if isinstance(raw_cost, dict):
            cost = _normalize_cost_v2(raw_cost)
        else:
            extra["cost"] = raw_cost
    settings = _object(value.get("settings"), "settings") if "settings" in value else {}
    settings, cache = _split_cache(settings)
    package = optional_str(value.get("package")) if "package" in value else None
    meta = {item: None for item in META_KEYS}
    if "family" in value:
        meta["family"] = value["family"]
    if "releaseDate" in value:
        meta["release_date"] = value["releaseDate"]
    return {
        "key": key,
        "name": optional_str(value.get("name")) if "name" in value else None,
        "id": optional_str(value.get("modelID")) if "modelID" in value else None,
        "attachment": attachment,
        "tool_call": tools,
        "reasoning": reasoning,
        "temperature": temperature,
        "interleaved": interleaved,
        "limit": _normalize_limit(value.get("limit")) if "limit" in value else _empty_limit(),
        "modalities": modalities,
        "variants": variants,
        "variantExtras": variant_extras,
        "cost": cost,
        "options": settings,
        "cache": cache,
        "headers": coerce_headers(value.get("headers")) if "headers" in value else {},
        "provider": {"npm": package, "api": None, "extra": {}},
        "meta": meta,
        "extra": extra,
    }


def _normalize_cost_v2(value: dict) -> dict:
    extra = {k: v for k, v in value.items() if k not in ("input", "output", "cache")}
    cache = value.get("cache") if "cache" in value else None
    read = write = None
    if isinstance(cache, dict):
        read = optional_number(cache.get("read")) if "read" in cache else None
        write = optional_number(cache.get("write")) if "write" in cache else None
        rest = {k: v for k, v in cache.items() if k not in ("read", "write")}
        if rest:
            extra["cache"] = rest
    elif "cache" in value:
        extra["cache"] = cache
    return {
        "input": optional_number(value.get("input")) if "input" in value else None,
        "output": optional_number(value.get("output")) if "output" in value else None,
        "cache_read": read,
        "cache_write": write,
        "extra": extra,
    }


def _variants_from_array(value: object) -> tuple[dict, dict] | None:
    if not isinstance(value, list):
        return None
    variants: dict = {}
    extras: dict = {}
    for item in value:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str) or not item["id"].strip():
            return None
        name = item["id"].strip()
        settings = item.get("settings", {})
        if name in variants or not isinstance(settings, dict):
            return None
        variants[name] = settings
        rest = {k: v for k, v in item.items() if k not in ("id", "settings")}
        if rest:
            extras[name] = rest
    return variants, extras


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


def _provider_to_raw(provider: dict, fmt: str = "v1") -> dict:
    v2 = fmt == "v2"
    raw = _object(provider.get("extra"), "提供商 extra")
    _put_text(raw, "name", provider.get("name"))
    _put_text(raw, "package" if v2 else "npm", provider.get("npm"))
    options = _provider_options_to_raw(provider)
    if v2 and "headers" in options:
        raw["headers"] = options.pop("headers")
    if options:
        raw["settings" if v2 else "options"] = options
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
        body[key] = _model_to_raw_v2(model) if v2 else _model_to_raw(model)
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
    for key in DROPPED_META_KEYS:
        raw.pop(key, None)
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
    options = _options_to_raw(model)
    if options:
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


def _model_to_raw_v2(model: dict) -> dict:
    raw = copy.deepcopy(_object(model.get("extra"), "模型 extra"))
    _put_text(raw, "name", model.get("name"))
    _put_text(raw, "modelID", model.get("id"))
    caps = raw.get("capabilities")
    caps = caps if isinstance(caps, dict) else {}
    for src, dst in (("tool_call", "tools"), ("temperature", "temperature")):
        if model.get(src) is not None:
            caps[dst] = bool(model[src])
    if model.get("reasoning") is not None:
        reasoning = caps.get("reasoning")
        reasoning = reasoning if isinstance(reasoning, dict) else {}
        reasoning["supported"] = bool(model["reasoning"])
        caps["reasoning"] = reasoning
    modalities = model.get("modalities")
    if isinstance(modalities, dict):
        incoming = string_list(modalities.get("input"))
        outgoing = string_list(modalities.get("output"))
        if incoming:
            caps["input"] = incoming
        if outgoing:
            caps["output"] = outgoing
    if caps:
        raw["capabilities"] = caps
    field = normalize_interleaved(model.get("interleaved"))
    if isinstance(field, str):
        compat = raw.get("compatibility")
        compat = compat if isinstance(compat, dict) else {}
        compat["reasoningField"] = field
        raw["compatibility"] = compat
    limit = _limit_to_raw(model.get("limit"))
    if limit:
        raw["limit"] = limit
    variants = _normalize_variants(model.get("variants"))
    if variants:
        extras = model.get("variantExtras") or {}
        if not isinstance(extras, dict):
            raise ServiceError("invalid_document", "variantExtras 必须是对象")
        items = []
        for name, settings in variants.items():
            item: dict = {"id": name}
            if settings:
                item["settings"] = settings
            extra = extras.get(name)
            if isinstance(extra, dict):
                for key, value in extra.items():
                    if key not in ("id", "settings"):
                        item[key] = value
            items.append(item)
        raw["variants"] = items
    if not isinstance(raw.get("cost"), list):
        cost = _cost_to_raw_v2(model.get("cost"))
        if cost:
            raw["cost"] = cost
    settings = _options_to_raw(model)
    if settings:
        raw["settings"] = settings
    headers = coerce_headers(model.get("headers"))
    if headers:
        raw["headers"] = headers
    provider = model.get("provider")
    if isinstance(provider, dict):
        _put_text(raw, "package", provider.get("npm"))
    meta = model.get("meta") or {}
    if not isinstance(meta, dict):
        raise ServiceError("invalid_document", "meta 必须是对象")
    if meta.get("family") is not None:
        raw["family"] = meta["family"]
    if meta.get("release_date") is not None:
        raw["releaseDate"] = meta["release_date"]
    return raw


def _cost_to_raw_v2(value: object) -> dict | None:
    if not isinstance(value, dict):
        return None
    raw = _object(value.get("extra"), "cost.extra")
    for key in ("input", "output"):
        number = optional_number(value.get(key))
        if number is not None:
            raw[key] = number
    cache = raw.get("cache")
    cache = dict(cache) if isinstance(cache, dict) else ({} if "cache" not in raw else None)
    if cache is not None:
        for src, dst in (("cache_read", "read"), ("cache_write", "write")):
            number = optional_number(value.get(src))
            if number is not None:
                cache[dst] = number
        if cache:
            raw["cache"] = cache
    return raw or None


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
