from __future__ import annotations

from pathlib import Path

from backend.errors import ServiceError
from backend.jsonio import read_json, write_json
from backend.paths import settings_path

SETTINGS_VERSION = 1

DEFAULT_SETTINGS = {
    "version": SETTINGS_VERSION,
    "window": {"width": 1440, "height": 900, "x": None, "y": None},
    "splitRatio": 0.4,
    "activePage": "providers",
    "providerColumns": {},
    "modelColumns": {},
    "lastConfigPath": None,
    "recentConfigPaths": [],
    "configSource": "opencode",
    "ccswitchAcceptedSchema": None,
}

CONFIG_SOURCES = ("opencode", "ccswitch")


def _defaults() -> dict:
    return {
        "version": SETTINGS_VERSION,
        "window": dict(DEFAULT_SETTINGS["window"]),
        "splitRatio": DEFAULT_SETTINGS["splitRatio"],
        "activePage": DEFAULT_SETTINGS["activePage"],
        "providerColumns": {},
        "modelColumns": {},
        "lastConfigPath": None,
        "recentConfigPaths": [],
        "configSource": DEFAULT_SETTINGS["configSource"],
        "ccswitchAcceptedSchema": DEFAULT_SETTINGS["ccswitchAcceptedSchema"],
    }


class SettingsStore:
    """The tool's only configuration file."""

    def __init__(self, path: Path | None = None):
        self.path = Path(path) if path is not None else settings_path()

    def load(self) -> dict:
        if not self.path.exists():
            return _defaults()
        try:
            data = read_json(self.path)
        except ServiceError:
            self._quarantine()
            return _defaults()
        if not isinstance(data, dict):
            self._quarantine()
            return _defaults()
        return _merge(data)

    def save(self, settings: dict) -> dict:
        merged = _merge(settings)
        write_json(self.path, merged)
        return merged

    def update(self, patch: dict) -> dict:
        if not isinstance(patch, dict):
            raise ServiceError("invalid_document", "设置必须是对象")
        current = self.load()
        if isinstance(patch.get("window"), dict):
            window = dict(current["window"])
            window.update(patch["window"])
            current["window"] = _window(window)
        if isinstance(patch.get("providerColumns"), dict):
            columns = dict(current["providerColumns"])
            columns.update(_column_widths(patch["providerColumns"]))
            current["providerColumns"] = columns
        if isinstance(patch.get("modelColumns"), dict):
            columns = dict(current["modelColumns"])
            columns.update(_column_widths(patch["modelColumns"]))
            current["modelColumns"] = columns
        if "splitRatio" in patch and patch["splitRatio"] is not None:
            current["splitRatio"] = _ratio(patch["splitRatio"])
        if isinstance(patch.get("activePage"), str) and patch["activePage"].strip():
            current["activePage"] = patch["activePage"].strip()
        if "lastConfigPath" in patch:
            current["lastConfigPath"] = _path_or_none(patch.get("lastConfigPath"))
        if isinstance(patch.get("recentConfigPaths"), list):
            current["recentConfigPaths"] = _recent(patch["recentConfigPaths"])
        if patch.get("configSource") in CONFIG_SOURCES:
            current["configSource"] = patch["configSource"]
        if "ccswitchAcceptedSchema" in patch:
            value = patch["ccswitchAcceptedSchema"]
            if value is None or _schema_or_none(value) is not None:
                current["ccswitchAcceptedSchema"] = value
        return self.save(current)

    def remember_config_path(self, path: str) -> dict:
        current = self.load()
        text = str(path)
        recent = [item for item in current["recentConfigPaths"] if item != text]
        recent.insert(0, text)
        current["recentConfigPaths"] = recent[:8]
        current["lastConfigPath"] = text
        return self.save(current)

    def _quarantine(self) -> None:
        if not self.path.exists():
            return
        target = self.path.with_name(self.path.name + ".bad")
        index = 1
        while target.exists():
            target = self.path.with_name(f"{self.path.name}.bad.{index}")
            index += 1
        try:
            self.path.replace(target)
        except OSError:
            return


def _merge(data: dict) -> dict:
    settings = _defaults()
    window = data.get("window")
    if isinstance(window, dict):
        settings["window"] = _window({**settings["window"], **window})
    if data.get("splitRatio") is not None:
        try:
            settings["splitRatio"] = _ratio(data["splitRatio"])
        except ServiceError:
            pass
    if isinstance(data.get("activePage"), str) and data["activePage"].strip():
        settings["activePage"] = data["activePage"].strip()
    if isinstance(data.get("providerColumns"), dict):
        settings["providerColumns"] = _column_widths(data["providerColumns"])
    if isinstance(data.get("modelColumns"), dict):
        settings["modelColumns"] = _column_widths(data["modelColumns"])
    settings["lastConfigPath"] = _path_or_none(data.get("lastConfigPath"))
    if isinstance(data.get("recentConfigPaths"), list):
        settings["recentConfigPaths"] = _recent(data["recentConfigPaths"])
    if data.get("configSource") in CONFIG_SOURCES:
        settings["configSource"] = data["configSource"]
    settings["ccswitchAcceptedSchema"] = _schema_or_none(data.get("ccswitchAcceptedSchema"))
    settings["version"] = SETTINGS_VERSION
    return settings


# Windows 最小化窗口的坐标是 -32000（按 DPI 缩放后如 150% 为 -21333），
# 在最小化状态下记下的位置会让下次启动的窗口开在屏幕外，这类坐标一律丢弃
MINIMIZED_COORD_LIMIT = -10000


def _window(value: dict) -> dict:
    width = _positive_int(value.get("width"), 1440)
    height = _positive_int(value.get("height"), 900)
    x = _optional_int(value.get("x"))
    y = _optional_int(value.get("y"))
    if x is None or y is None or x <= MINIMIZED_COORD_LIMIT or y <= MINIMIZED_COORD_LIMIT:
        x = y = None
    return {
        "width": width,
        "height": height,
        "x": x,
        "y": y,
    }


def _positive_int(value: object, fallback: int) -> int:
    number = _optional_int(value)
    if number is None or number < 640:
        return fallback
    return number


def _optional_int(value: object) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str):
        text = value.strip()
        if text.lstrip("-").isdigit():
            return int(text)
    return None


def _ratio(value: object) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ServiceError("invalid_document", "分栏比例必须是数字") from exc
    if number != number:
        raise ServiceError("invalid_document", "分栏比例必须是数字")
    return min(0.8, max(0.2, number))


def _column_widths(value: dict) -> dict:
    widths = {}
    for key, item in value.items():
        number = _optional_int(item)
        if number is not None and number >= 40:
            widths[str(key)] = number
    return widths


def _path_or_none(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    return text or None


def _recent(values: list) -> list[str]:
    recent: list[str] = []
    for item in values:
        text = _path_or_none(item)
        if text and text not in recent:
            recent.append(text)
        if len(recent) == 8:
            break
    return recent


def _schema_or_none(value: object) -> int | None:
    if isinstance(value, int) and not isinstance(value, bool) and value > 0:
        return value
    return None
