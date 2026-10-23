from __future__ import annotations

import json
import threading
import urllib.error
import urllib.request
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from pathlib import Path

from backend.errors import ServiceError
from backend.fields import (
    CAPABILITY_KEYS,
    COST_KEYS,
    LIMIT_KEYS,
    META_KEYS,
    OFFICIAL_PROVIDER_IDS,
    model_prefix,
    normalize_interleaved,
    optional_number,
    variants_from_reasoning,
)
from backend.jsonio import read_json, write_json
from backend.paths import MODELS_DEV_URL, catalog_cache_path, catalog_meta_path


class MetadataSource(ABC):
    source_id: str

    @abstractmethod
    def load(self) -> dict:
        """Return the catalog document, or an empty object when nothing is cached."""

    @abstractmethod
    def refresh(self) -> None:
        """Download a new snapshot and replace the cache."""

    @abstractmethod
    def clear(self) -> None:
        """Delete the local snapshot."""

    @abstractmethod
    def describe(self) -> dict:
        """Return cache location and fetch time without parsing the catalog."""


class ModelsDevSource(MetadataSource):
    source_id = "models.dev"

    def __init__(self, cache_path: Path, meta_path: Path, url: str = MODELS_DEV_URL):
        self.cache_path = Path(cache_path)
        self.meta_path = Path(meta_path)
        self.url = url
        self._lock = threading.Lock()

    def load(self) -> dict:
        with self._lock:
            if not self.cache_path.is_file():
                return {}
            data = read_json(self.cache_path)
        if not isinstance(data, dict):
            raise ServiceError("invalid_catalog", "模型库缓存不是 JSON 对象")
        return data

    def refresh(self) -> None:
        payload = _download(self.url)
        try:
            data = json.loads(payload.decode("utf-8-sig"))
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise ServiceError("invalid_catalog", "远程模型库不是合法 JSON") from exc
        _validate_catalog(data)
        stamp = _now()
        meta = {
            "updatedAt": stamp,
            "sourceUrl": self.url,
            "bytes": len(payload),
        }
        with self._lock:
            write_json(self.cache_path, data)
            write_json(self.meta_path, meta)

    def clear(self) -> None:
        with self._lock:
            for path in (self.cache_path, self.meta_path):
                try:
                    if path.exists():
                        path.unlink()
                except OSError as exc:
                    raise ServiceError("io_error", f"无法删除 {path.name}") from exc

    def describe(self) -> dict:
        info = {
            "sourceId": self.source_id,
            "sourceUrl": self.url,
            "path": str(self.cache_path),
            "origin": "empty",
            "updatedAt": None,
            "bytes": 0,
            "message": None,
        }
        if not self.cache_path.is_file():
            return info
        info["bytes"] = self.cache_path.stat().st_size
        info["origin"] = "cache"
        info["updatedAt"] = self._updated_at()
        return info

    def _updated_at(self) -> str:
        if self.meta_path.is_file():
            try:
                meta = read_json(self.meta_path)
            except ServiceError:
                meta = None
            if isinstance(meta, dict) and isinstance(meta.get("updatedAt"), str):
                return meta["updatedAt"]
        stamp = datetime.fromtimestamp(self.cache_path.stat().st_mtime, timezone.utc).replace(microsecond=0)
        return stamp.isoformat().replace("+00:00", "Z")


class CatalogEntry:
    def __init__(self, source_id: str, provider_id: str, model_id: str, raw: dict, provider: dict):
        self.source_id = source_id
        self.provider_id = provider_id
        self.model_id = model_id
        self.raw = raw
        self.provider = provider


class CatalogIndex:
    def __init__(self):
        self.entries: list[CatalogEntry] = []
        self.by_exact: dict[tuple[str, str], CatalogEntry] = {}
        self.by_model: dict[str, list[CatalogEntry]] = {}
        self.by_model_fold: dict[str, list[CatalogEntry]] = {}
        self.providers: list[dict] = []


class MetadataService:
    def __init__(
        self,
        cache_path: Path | None = None,
        meta_path: Path | None = None,
        url: str = MODELS_DEV_URL,
    ):
        self.sources: list[MetadataSource] = [
            ModelsDevSource(
                cache_path or catalog_cache_path(),
                meta_path or catalog_meta_path(),
                url,
            )
        ]
        self._lock = threading.Lock()
        self._index: CatalogIndex | None = None
        self._error: str | None = None

    def register(self, source: MetadataSource) -> None:
        with self._lock:
            self.sources.append(source)
            self._index = None

    def status(self) -> dict:
        index = self._ensure_index()
        primary = self.sources[0].describe()
        primary["providerCount"] = len(index.providers)
        primary["modelCount"] = len(index.entries)
        primary["available"] = bool(index.entries) and primary.get("origin") == "cache"
        if self._error:
            primary["origin"] = "invalid"
            primary["available"] = False
            primary["message"] = self._error
        elif not primary["available"] and primary["origin"] == "empty":
            primary["message"] = "模型库尚未下载"
        primary["sources"] = [
            {
                "id": source.source_id,
                "sourceUrl": getattr(source, "url", None),
                "active": source is self.sources[0],
            }
            for source in self.sources
        ]
        primary["activeSourceId"] = self.sources[0].source_id
        return primary

    def refresh(self, source_id: str | None = None) -> dict:
        source = self._source(source_id)
        source.refresh()
        with self._lock:
            self._index = None
            self._error = None
        return self.status()

    def clear(self, source_id: str | None = None) -> dict:
        source = self._source(source_id)
        source.clear()
        with self._lock:
            self._index = None
            self._error = None
        return self.status()

    def reload_local(self, source_id: str | None = None) -> dict:
        """Re-read the cache file from disk without downloading."""
        self._source(source_id)
        with self._lock:
            self._index = None
            self._error = None
        return self.status()

    def match(self, model_key: str, provider_hint: str | None = None) -> dict:
        key = (model_key or "").strip()
        hint = provider_hint.strip() if isinstance(provider_hint, str) and provider_hint.strip() else None
        if not key:
            return _not_found("", hint)
        index = self._ensure_index()
        if not index.entries:
            return _not_found(key, hint)
        if hint:
            direct = _lookup(index, hint, key)
            if direct is not None and _useful(direct):
                return _defaults(direct, key, hint, "provider")
        exacts = _exacts(index, key)
        official = [entry for entry in exacts if entry.provider_id in OFFICIAL_PROVIDER_IDS and _useful(entry)]
        if official:
            return _defaults(_best(official), key, hint, "exact")
        targets = _canonical_targets(index, exacts)
        useful_targets = [entry for entry in targets if _useful(entry)]
        if useful_targets:
            return _defaults(_best(useful_targets), key, hint, "canonical")
        useful_exacts = [entry for entry in exacts if _useful(entry)]
        if useful_exacts:
            return _defaults(_best(useful_exacts), key, hint, "exact")
        if exacts:
            return _defaults(_best(exacts), key, hint, "exact")
        return _not_found(key, hint)

    def match_many(self, items: list) -> list[dict]:
        if not isinstance(items, list):
            raise ServiceError("invalid_document", "批量匹配的参数必须是数组")
        results = []
        for item in items:
            if not isinstance(item, dict):
                raise ServiceError("invalid_document", "批量匹配的每一项必须是对象")
            results.append(self.match(str(item.get("modelKey") or ""), item.get("providerHint")))
        return results

    def search(self, provider_id: str | None = None, query: str | None = None, include_all: bool = False) -> dict:
        index = self._ensure_index()
        available = bool(index.entries) and not self._error
        if not available:
            return {
                "available": False,
                "groups": [],
                "providers": index.providers,
                "total": 0,
                "truncated": False,
                "hint": "catalog_empty",
            }
        provider_text = provider_id.strip() if isinstance(provider_id, str) else ""
        query_text = query.strip().casefold() if isinstance(query, str) else ""
        if not provider_text and not query_text and not include_all:
            return {
                "available": True,
                "groups": [],
                "providers": index.providers,
                "total": len(index.entries),
                "truncated": False,
                "hint": "need_query",
            }
        matched = [
            entry
            for entry in index.entries
            if _matches(entry, provider_text, query_text)
        ]
        matched.sort(key=lambda entry: (model_prefix(entry.model_id), entry.model_id, entry.provider_id))
        limit = len(matched) if include_all or provider_text else 800
        shown = matched[:limit]
        compact = [_compact(entry) for entry in shown]
        grouped: dict[str, list] = {}
        for item in compact:
            grouped.setdefault(model_prefix(item["id"]), []).append(item)
        groups = [{"prefix": prefix, "models": grouped[prefix]} for prefix in sorted(grouped)]
        return {
            "available": True,
            "groups": groups,
            "providers": index.providers,
            "total": len(matched),
            "truncated": len(matched) > len(shown),
            "hint": None,
        }

    def _source(self, source_id: str | None) -> MetadataSource:
        if source_id is None:
            return self.sources[0]
        for source in self.sources:
            if source.source_id == source_id:
                return source
        raise ServiceError("not_found", f"未知模型库来源：{source_id}")

    def _ensure_index(self) -> CatalogIndex:
        with self._lock:
            if self._index is not None:
                return self._index
            index = CatalogIndex()
            error = None
            for source in self.sources:
                try:
                    catalog = source.load()
                except ServiceError as exc:
                    error = exc.message
                    continue
                _ingest(index, source.source_id, catalog)
            self._error = error
            self._index = index
            return index


def _ingest(index: CatalogIndex, source_id: str, catalog: dict) -> None:
    for provider_id, provider in catalog.items():
        if not isinstance(provider, dict):
            continue
        models = provider.get("models")
        if not isinstance(models, dict):
            continue
        count = 0
        slim = {
            "id": provider.get("id") or provider_id,
            "name": provider.get("name") or provider_id,
            "npm": provider.get("npm"),
            "api": provider.get("api"),
        }
        for model_id, raw in models.items():
            if not isinstance(raw, dict):
                continue
            entry = CatalogEntry(source_id, str(provider_id), str(model_id), raw, slim)
            index.entries.append(entry)
            index.by_exact[(entry.provider_id, entry.model_id)] = entry
            index.by_model.setdefault(entry.model_id, []).append(entry)
            index.by_model_fold.setdefault(entry.model_id.casefold(), []).append(entry)
            count += 1
        if count:
            index.providers.append(
                {
                    "id": str(provider_id),
                    "name": slim["name"],
                    "npm": slim["npm"],
                    "modelCount": count,
                    "sourceId": source_id,
                }
            )
    index.providers.sort(key=lambda item: str(item["id"]))


def _lookup(index: CatalogIndex, provider_id: str, model_id: str) -> CatalogEntry | None:
    found = index.by_exact.get((provider_id, model_id))
    if found is not None:
        return found
    folded = provider_id.casefold()
    for entry in index.by_model_fold.get(model_id.casefold(), []):
        if entry.provider_id.casefold() == folded:
            return entry
    return None


def _exacts(index: CatalogIndex, model_id: str) -> list[CatalogEntry]:
    found = index.by_model.get(model_id)
    if found:
        return list(found)
    return list(index.by_model_fold.get(model_id.casefold(), []))


def _canonical_targets(index: CatalogIndex, exacts: list[CatalogEntry]) -> list[CatalogEntry]:
    targets = []
    seen = set()
    for entry in exacts:
        canonical = entry.raw.get("canonical_model_id")
        if not isinstance(canonical, str) or "/" not in canonical:
            continue
        provider_id, model_id = canonical.split("/", 1)
        target = index.by_exact.get((provider_id, model_id))
        if target is None:
            continue
        identity = (target.provider_id, target.model_id)
        if identity in seen:
            continue
        seen.add(identity)
        targets.append(target)
    return targets


def _useful(entry: CatalogEntry) -> bool:
    raw = entry.raw
    limit = raw.get("limit") if isinstance(raw.get("limit"), dict) else {}
    if any(_is_number(limit.get(key)) for key in LIMIT_KEYS):
        return True
    modalities = raw.get("modalities") if isinstance(raw.get("modalities"), dict) else {}
    if modalities.get("input") or modalities.get("output"):
        return True
    cost = raw.get("cost") if isinstance(raw.get("cost"), dict) else {}
    if any(_is_number(cost.get(key)) for key in COST_KEYS):
        return True
    options = raw.get("reasoning_options")
    if isinstance(options, list) and any(isinstance(item, dict) and item for item in options):
        return True
    return any(isinstance(raw.get(key), bool) for key in CAPABILITY_KEYS)


def _best(entries: list[CatalogEntry]) -> CatalogEntry:
    return max(entries, key=lambda entry: (_completeness(entry), entry.provider_id, entry.model_id))


def _completeness(entry: CatalogEntry) -> int:
    raw = entry.raw
    score = 0
    limit = raw.get("limit") if isinstance(raw.get("limit"), dict) else {}
    if _is_number(limit.get("context")):
        score += 10
    if _is_number(limit.get("output")):
        score += 8
    modalities = raw.get("modalities") if isinstance(raw.get("modalities"), dict) else {}
    if modalities.get("input"):
        score += 6
    if modalities.get("output"):
        score += 6
    cost = raw.get("cost") if isinstance(raw.get("cost"), dict) else {}
    if _is_number(cost.get("input")):
        score += 4
    options = raw.get("reasoning_options")
    if isinstance(options, list) and options:
        score += 4
    if isinstance(raw.get("name"), str):
        score += 2
    if isinstance(raw.get("family"), str):
        score += 2
    score += sum(1 for key in CAPABILITY_KEYS if isinstance(raw.get(key), bool))
    return score


def _defaults(entry: CatalogEntry, model_key: str, provider_hint: str | None, kind: str) -> dict:
    raw = entry.raw
    limit = raw.get("limit") if isinstance(raw.get("limit"), dict) else {}
    modalities = raw.get("modalities") if isinstance(raw.get("modalities"), dict) else {}
    cost = raw.get("cost") if isinstance(raw.get("cost"), dict) else {}
    variants = variants_from_reasoning(raw.get("reasoning_options"))
    meta = {key: raw.get(key) for key in META_KEYS if key in raw and raw.get(key) is not None}
    return {
        "found": True,
        "modelKey": model_key,
        "providerHint": provider_hint,
        "sourceId": entry.source_id,
        "matchedProviderId": entry.provider_id,
        "matchedModelId": entry.model_id,
        "matchKind": kind,
        "name": raw.get("name") if isinstance(raw.get("name"), str) else None,
        "limit": {
            "context": optional_number(limit.get("context")),
            "output": optional_number(limit.get("output")),
            "input": optional_number(limit.get("input")),
        },
        "modalities": {
            "input": [str(item) for item in modalities.get("input") or []],
            "output": [str(item) for item in modalities.get("output") or []],
        },
        "variants": variants,
        "capabilities": {
            key: raw.get(key) if isinstance(raw.get(key), bool) else None for key in CAPABILITY_KEYS
        },
        "cost": {key: cost.get(key) if _is_number(cost.get(key)) else None for key in COST_KEYS},
        "meta": meta,
        "interleaved": normalize_interleaved(raw.get("interleaved")) if "interleaved" in raw else None,
        "reasoningEffortValues": list(variants.keys()),
        "reasoningTypes": _reasoning_types(raw.get("reasoning_options")),
        "catalogNpm": entry.provider.get("npm"),
    }


def _reasoning_types(options: object) -> list[str]:
    """models.dev reasoning_options 中出现的类型，例如 effort / toggle / budget_tokens。"""
    if not isinstance(options, list):
        return []
    found = {item.get("type") for item in options if isinstance(item, dict)}
    return sorted(item for item in found if isinstance(item, str))


def _compact(entry: CatalogEntry) -> dict:
    defaults = _defaults(entry, entry.model_id, None, "exact")
    defaults["id"] = entry.model_id
    defaults["providerId"] = entry.provider_id
    return defaults


def _not_found(model_key: str, provider_hint: str | None) -> dict:
    return {
        "found": False,
        "modelKey": model_key,
        "providerHint": provider_hint,
        "sourceId": None,
        "matchedProviderId": None,
        "matchedModelId": None,
        "matchKind": "none",
        "name": None,
        "limit": {"context": None, "output": None, "input": None},
        "modalities": {"input": [], "output": []},
        "variants": {},
        "capabilities": {key: None for key in CAPABILITY_KEYS},
        "cost": {key: None for key in COST_KEYS},
        "meta": {},
        "interleaved": None,
        "reasoningEffortValues": [],
        "reasoningTypes": [],
        "catalogNpm": None,
    }


def _matches(entry: CatalogEntry, provider_id: str, query: str) -> bool:
    if provider_id and entry.provider_id.casefold() != provider_id.casefold():
        return False
    if not query:
        return True
    name = entry.raw.get("name")
    haystack = " ".join(
        part
        for part in (entry.model_id, entry.provider_id, name if isinstance(name, str) else "")
        if part
    ).casefold()
    return query in haystack


def _is_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _validate_catalog(data: object) -> None:
    if not isinstance(data, dict) or not data:
        raise ServiceError("invalid_catalog", "远程模型库格式无法识别")
    sample = next(iter(data.values()))
    if not isinstance(sample, dict) or not isinstance(sample.get("models"), dict):
        raise ServiceError("invalid_catalog", "远程模型库格式无法识别")


def _download(url: str, timeout: int = 60, limit: int = 80_000_000) -> bytes:
    request = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "User-Agent": "oc-modal-configurator"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            chunks = []
            total = 0
            while True:
                block = response.read(256 * 1024)
                if not block:
                    break
                total += len(block)
                if total > limit:
                    raise ServiceError("invalid_catalog", "远程模型库过大，已中止下载")
                chunks.append(block)
            return b"".join(chunks)
    except ServiceError:
        raise
    except urllib.error.HTTPError as exc:
        raise ServiceError("network_error", f"下载模型库失败（HTTP {exc.code}）") from exc
    except urllib.error.URLError as exc:
        raise ServiceError("network_error", "无法连接模型库") from exc
    except TimeoutError as exc:
        raise ServiceError("network_error", "下载模型库超时") from exc


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
