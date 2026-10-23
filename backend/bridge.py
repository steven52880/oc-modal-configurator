from __future__ import annotations

import sys
import threading
from pathlib import Path

from backend import __version__
from backend.ccswitch_service import CcSwitchService
from backend.config_service import ConfigService
from backend.errors import ServiceError
from backend.metadata_service import MetadataService
from backend.param_templates import generate_many
from backend.provider_probe import probe_provider_models
from backend.secrets import describe_api_key
from backend.settings_store import SettingsStore


class Bridge:
    """JSON API shared by the pywebview window and the local dev server."""

    def __init__(
        self,
        config: ConfigService,
        metadata: MetadataService,
        settings: SettingsStore,
        ccswitch: CcSwitchService | None = None,
    ):
        self._config = config
        self._metadata = metadata
        self._settings = settings
        self._ccswitch = ccswitch if ccswitch is not None else CcSwitchService()
        self._window = None
        self._lock = threading.Lock()
        self._pending_window = None
        self._window_timer: threading.Timer | None = None

    def _attach_window(self, window) -> None:
        self._window = window

    def get_app_info(self) -> dict:
        return self._call(self._app_info)

    def load_config(self, path: str | None = None) -> dict:
        return self._call(lambda: self._load_config(path))

    def save_config(self, document: dict, force: bool = False) -> dict:
        return self._call(lambda: self._save_config(document, bool(force)))

    def load_ccswitch(self) -> dict:
        return self._call(self._ccswitch.load)

    def pick_config_file(self) -> dict:
        return self._call(self._pick_config_file)

    def get_metadata_status(self) -> dict:
        return self._call(self._metadata.status)

    def refresh_metadata(self, source_id: str | None = None) -> dict:
        return self._call(lambda: self._metadata.refresh(source_id))

    def clear_metadata_cache(self) -> dict:
        return self._call(self._metadata.clear)

    def reload_metadata_cache(self) -> dict:
        return self._call(self._metadata.reload_local)

    def match_model_defaults(self, model_key: str, provider_hint: str | None = None) -> dict:
        return self._call(lambda: self._metadata.match(model_key, provider_hint))

    def match_models_defaults(self, items: list) -> dict:
        return self._call(lambda: self._metadata.match_many(items))

    def generate_model_params(self, items: list) -> dict:
        return self._call(lambda: generate_many(self._metadata, items))

    def probe_provider_models(
        self,
        base_url: str,
        api_key: str | None = None,
        provider_hint: str | None = None,
    ) -> dict:
        return self._call(lambda: self._probe(base_url, api_key, provider_hint))

    def search_catalog(
        self,
        provider_id: str | None = None,
        query: str | None = None,
        include_all: bool = False,
    ) -> dict:
        return self._call(lambda: self._metadata.search(provider_id, query, bool(include_all)))

    def describe_api_key(self, api_key: str | None = None) -> dict:
        return self._call(lambda: describe_api_key(api_key))

    def get_settings(self) -> dict:
        return self._call(self._read_settings)

    def update_settings(self, patch: dict) -> dict:
        return self._call(lambda: self._write_settings(patch))

    def _call(self, action):
        try:
            return {"ok": True, "data": action()}
        except ServiceError as exc:
            return {"ok": False, "error": {"code": exc.code, "message": exc.message}}
        except Exception as exc:
            return {"ok": False, "error": {"code": "internal", "message": str(exc)}}

    def _read_settings(self) -> dict:
        with self._lock:
            return self._settings.load()

    def _write_settings(self, patch: dict) -> dict:
        with self._lock:
            return self._settings.update(patch)

    def _load_config(self, path: str | None) -> dict:
        document = self._config.load(self._resolve_path(path))
        if document["exists"]:
            with self._lock:
                self._settings.remember_config_path(document["path"])
        return document

    def _save_config(self, document: dict, force: bool) -> dict:
        if isinstance(document, dict) and document.get("source") == "ccswitch":
            return self._ccswitch.save(document, force)
        saved = self._config.save(document, force)
        with self._lock:
            self._settings.remember_config_path(saved["path"])
        return saved

    def _resolve_path(self, path: str | None) -> Path | None:
        if isinstance(path, str) and path.strip():
            return Path(path.strip()).expanduser()
        with self._lock:
            last = self._settings.load().get("lastConfigPath")
        if isinstance(last, str) and Path(last).is_file():
            return Path(last)
        return None

    def _pick_config_file(self) -> dict | None:
        window = self._window
        if window is None:
            raise ServiceError("dialog_unavailable", "当前环境没有原生文件对话框")
        import webview

        directory = ""
        with self._lock:
            last = self._settings.load().get("lastConfigPath")
        if isinstance(last, str):
            parent = Path(last).expanduser().parent
            if parent.is_dir():
                directory = str(parent)
        selected = window.create_file_dialog(
            webview.FileDialog.OPEN,
            directory=directory,
            allow_multiple=False,
            file_types=("OpenCode 配置 (*.json)", "所有文件 (*.*)"),
        )
        if not selected:
            return None
        return {"path": selected[0]}

    def _probe(self, base_url: str, api_key: str | None, provider_hint: str | None) -> dict:
        result = probe_provider_models(base_url, api_key)
        groups = []
        for group in result["groups"]:
            models = []
            for model in group["models"]:
                item = dict(model)
                defaults = self._metadata.match(item["id"], provider_hint)
                item["defaults"] = defaults if defaults.get("found") else None
                models.append(item)
            groups.append({"prefix": group["prefix"], "models": models})
        result["groups"] = groups
        return result

    def _remember_window(self, width: int, height: int, x: int | None, y: int | None) -> None:
        if not width or not height:
            return
        with self._lock:
            self._pending_window = (int(width), int(height), x, y)
            if self._window_timer is not None:
                self._window_timer.cancel()
            timer = threading.Timer(0.3, self._flush_window)
            timer.daemon = True
            self._window_timer = timer
            timer.start()

    def _flush_window(self) -> None:
        with self._lock:
            if self._window_timer is not None:
                self._window_timer.cancel()
                self._window_timer = None
            pending = self._pending_window
            self._pending_window = None
            if pending is None:
                return
            width, height, x, y = pending
            self._settings.update({"window": {"width": width, "height": height, "x": x, "y": y}})

    def _app_info(self) -> dict:
        import platform

        source = self._metadata.sources[0]
        cache = getattr(source, "cache_path", None)
        return {
            "name": "OpenCode 配置编辑器",
            "version": __version__,
            "platform": sys.platform,
            "python": platform.python_version(),
            "storage": "settings-file",
            "settingsPath": str(self._settings.path),
            "catalogCachePath": None if cache is None else str(cache),
            "defaultConfigPath": str(self._config.default_path),
            "ccswitchDbPath": str(self._ccswitch.db_path),
        }
