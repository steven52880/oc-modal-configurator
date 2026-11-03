"""OpenCode providers stored in cc-switch's SQLite database.

cc-switch keeps one row per provider in ``providers`` (PK ``id, app_type``).
``settings_config`` holds the JSON of the ``opencode.json`` ``provider.<id>``
block. On every startup cc-switch imports ``provider.*`` from the live
``opencode.json`` and overwrites rows whose content differs, so every save here
updates the database and the live file together.

Only rows with ``app_type='opencode'`` that this tool understands are changed.
The schema is never altered.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import time
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from backend.config_service import _normalize_provider, document_from_raw, to_raw
from backend.errors import ServiceError
from backend.jsonio import write_json
from backend.paths import ccswitch_live_path_override, default_ccswitch_db_path

SUPPORTED_SCHEMA_VERSIONS = frozenset({19, 20, 21, 22, 23, 24})
LATEST_VERIFIED_SCHEMA = max(SUPPORTED_SCHEMA_VERSIONS)
VERIFIED_RANGE = f"v{min(SUPPORTED_SCHEMA_VERSIONS)}–v{LATEST_VERIFIED_SCHEMA}"
REQUIRED_COLUMNS = frozenset(
    {"id", "app_type", "name", "settings_config", "category", "created_at", "sort_index", "meta"}
)
LOCKED_CATEGORIES = frozenset({"omo", "omo-slim"})
NATIVE_ONLY_KEYS = frozenset({"package", "settings", "headers", "body", "canonical"})
LEGACY_ONLY_KEYS = frozenset({"npm", "options", "api"})

SELECT_ROWS = (
    "SELECT id, name, settings_config, category, meta FROM providers "
    "WHERE app_type='opencode' ORDER BY COALESCE(sort_index, 999999), created_at, id"
)
RUNNING_MESSAGE = "CC Switch 正在运行，请先完全退出 CC Switch（包括托盘）再保存"
LIVE_UNREADABLE_NOTICE = "opencode.json 无法按纯 JSON 解析（可能含注释），未做一致性检查，保存将被拒绝"
NEW_ROW_META = '{"liveConfigManaged":true}'


@dataclass
class _Row:
    id: str
    name: str
    settings_text: str
    category: str | None
    meta_text: str
    settings: dict | None
    meta: dict
    reason: str | None = None

    @property
    def live_managed(self) -> bool:
        return self.meta.get("liveConfigManaged") is not False


class CcSwitchService:
    def __init__(
        self,
        db_path: Path | None = None,
        live_path: Path | None = None,
        running_check: Callable[[], bool] | None = None,
    ):
        self.db_path = Path(db_path) if db_path is not None else default_ccswitch_db_path()
        self._live_override = Path(live_path) if live_path is not None else None
        self._running_check = running_check if running_check is not None else _default_running_check

    def load(self, accepted_schema: int | None = None) -> dict:
        db = self._require_db()
        with closing(_connect_readonly(db)) as conn:
            version = _check_schema(conn, accepted_schema)
            rows = _read_rows(conn)
        live_path = self._live_path()
        live, notices = _read_live(live_path)
        _classify(rows, live)
        live_providers = live.get("provider") if isinstance(live, dict) else None
        provider: dict = {}
        drifted: list[str] = []
        for row in rows:
            if row.reason is not None:
                continue
            content = row.settings
            if row.live_managed and isinstance(live_providers, dict) and row.id in live_providers:
                candidate = live_providers[row.id]
                if candidate != row.settings:
                    if _normalizes(row.id, candidate):
                        content = candidate
                        drifted.append(row.id)
                    else:
                        notices.append(f"opencode.json 中的 {row.id} 无法识别，已显示数据库中的内容")
            provider[row.id] = content
        document = document_from_raw({"provider": provider}, db, True, None)
        document.update(
            {
                "source": "ccswitch",
                "mtimeNs": _fingerprint(rows, live_path),
                "preserved": {},
                "livePath": str(live_path),
                "lockedProviders": [
                    {"key": row.id, "name": row.name, "reason": row.reason} for row in rows if row.reason is not None
                ],
                "driftedProviders": drifted,
                "notices": notices,
                "running": self._is_running(),
                "schemaVersion": version,
                "verifiedSchema": LATEST_VERIFIED_SCHEMA,
                "schemaUnverified": version not in SUPPORTED_SCHEMA_VERSIONS,
            }
        )
        return document

    def save(self, document: dict, force: bool = False, accepted_schema: int | None = None) -> dict:
        if not isinstance(document, dict) or document.get("source") != "ccswitch":
            raise ServiceError("invalid_document", "保存内容不是 CC Switch 文档")
        if self._is_running():
            raise ServiceError("ccswitch_running", RUNNING_MESSAGE)
        incoming: dict = to_raw({**document, "preserved": {}})["provider"]
        db = self._require_db()
        live_path = self._live_path()
        live, original_bytes = _read_live_for_save(live_path)
        with closing(_connect_readonly(db)) as probe:
            _check_schema(probe, accepted_schema)
        backup = _backup_db(db)
        conn = sqlite3.connect(str(db), isolation_level=None, timeout=1)
        try:
            conn.execute("PRAGMA foreign_keys=ON")
            _begin(conn)
            try:
                _check_schema(conn, accepted_schema)
                rows = _read_rows(conn)
                if not force and _fingerprint(rows, live_path) != str(document.get("mtimeNs")):
                    raise ServiceError("conflict", "CC Switch 数据库或 opencode.json 已在外部被修改，请重新加载后再保存")
                _classify(rows, live)
                deleted = _apply_rows(conn, rows, incoming)
                _merge_live(live, incoming, deleted, {row.id: row for row in rows})
                live_backup = _write_live(live_path, live)
            except BaseException:
                conn.execute("ROLLBACK")
                raise
            try:
                conn.execute("COMMIT")
            except sqlite3.Error as exc:
                _restore_live(live_path, original_bytes)
                raise ServiceError("io_error", f"写入 CC Switch 数据库失败，opencode.json 已还原：{exc}") from exc
        finally:
            conn.close()
        with closing(_connect_readonly(db)) as fresh:
            fingerprint = _fingerprint(_read_rows(fresh), live_path)
        return {
            "path": str(db),
            "backupPath": str(backup),
            "mtimeNs": fingerprint,
            "livePath": str(live_path),
            "liveBackupPath": None if live_backup is None else str(live_backup),
        }

    def schema_version(self) -> int:
        db = self._require_db()
        with closing(_connect_readonly(db)) as conn:
            return _user_version(conn)

    def _require_db(self) -> Path:
        if not self.db_path.is_file():
            raise ServiceError("ccswitch_missing", f"未找到 CC Switch 数据库：{self.db_path}")
        return self.db_path

    def _live_path(self) -> Path:
        directory = self._live_dir()
        # An override may point straight at the file (dev mode, tests).
        if directory.suffix.lower() in {".json", ".jsonc"}:
            return directory
        jsonc = directory / "opencode.jsonc"
        return jsonc if jsonc.exists() else directory / "opencode.json"

    def _live_dir(self) -> Path:
        if self._live_override is not None:
            return self._live_override
        override = ccswitch_live_path_override()
        if override is not None:
            return override
        configured = _settings_config_dir(self.db_path.parent / "settings.json")
        if configured is not None:
            return configured
        return Path.home() / ".config" / "opencode"

    def _is_running(self) -> bool:
        if os.environ.get("OC_CCSWITCH_SKIP_RUNNING_CHECK") == "1":
            return False
        return bool(self._running_check())


def _connect_readonly(db: Path) -> sqlite3.Connection:
    return sqlite3.connect(db.resolve().as_uri() + "?mode=ro", uri=True)


def _user_version(conn: sqlite3.Connection) -> int:
    return int(conn.execute("PRAGMA user_version").fetchone()[0])


def _check_schema(conn: sqlite3.Connection, accepted_schema: int | None = None) -> int:
    """``accepted_schema``: newest version the user chose to use without verification."""
    version = _user_version(conn)
    if version > LATEST_VERIFIED_SCHEMA:
        if not (isinstance(accepted_schema, int) and version <= accepted_schema):
            raise ServiceError(
                "ccswitch_newer",
                f"CC Switch 数据库版本 v{version} 高于本工具已验证的 v{LATEST_VERIFIED_SCHEMA}"
                f"（已验证 {VERIFIED_RANGE}），可能存在不兼容的改动，已禁止读写。"
                "可更新本工具，或在确认风险后跳过版本检查继续使用。",
            )
    elif version not in SUPPORTED_SCHEMA_VERSIONS:
        raise ServiceError(
            "ccswitch_unsupported",
            f"CC Switch 数据库版本 v{version} 尚未适配（已验证 {VERIFIED_RANGE}），为避免损坏已禁止读写。请更新本工具。",
        )
    # Runs even when the version check was skipped: this is the real safety net.
    columns = {str(item[1]) for item in conn.execute("PRAGMA table_info(providers)").fetchall()}
    if not columns:
        raise ServiceError("ccswitch_unsupported", "CC Switch 数据库中没有 providers 表，为避免损坏已禁止读写。")
    missing = sorted(REQUIRED_COLUMNS - columns)
    if missing:
        raise ServiceError(
            "ccswitch_unsupported",
            f"CC Switch 数据库 providers 表缺少字段 {', '.join(missing)}（v{version}），为避免损坏已禁止读写。请更新本工具。",
        )
    return version


def _read_rows(conn: sqlite3.Connection) -> list[_Row]:
    rows = []
    for row_id, name, settings_text, category, meta_text in conn.execute(SELECT_ROWS).fetchall():
        settings = _json_object(settings_text)
        meta = _json_object(meta_text)
        rows.append(
            _Row(
                id=str(row_id),
                name=str(name),
                settings_text=settings_text,
                category=category,
                meta_text=meta_text,
                settings=settings,
                meta=meta if meta is not None else {},
            )
        )
    return rows


def _json_object(text: object) -> dict | None:
    if not isinstance(text, str):
        return None
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, dict) else None


def _classify(rows: list[_Row], live: dict | None) -> None:
    live_v2 = live.get("providers") if isinstance(live, dict) else None
    for row in rows:
        row.reason = _lock_reason(row, live_v2 if isinstance(live_v2, dict) else {})


def _lock_reason(row: _Row, live_v2: dict) -> str | None:
    if row.category in LOCKED_CATEGORIES:
        return "OMO 配置，由 CC Switch 单独管理"
    settings = row.settings
    if settings is None:
        return "settings_config 不是 JSON 对象"
    keys = set(settings)
    if row.meta.get("opencodeConfigFormat") == "v2" or (keys & NATIVE_ONLY_KEYS and not keys & LEGACY_ONLY_KEYS):
        return "OpenCode V2 原生格式，暂不支持编辑"
    if keys & {"$schema", "provider", "providers"}:
        return "存放的是完整配置，暂不支持编辑"
    if row.id in live_v2:
        return "opencode.json 中存在同名 V2 提供商"
    try:
        _normalize_provider(row.id, settings)
    except ServiceError as exc:
        return f"格式无法识别：{exc.message}"
    return None


def _normalizes(key: str, value: object) -> bool:
    try:
        _normalize_provider(key, value)
    except ServiceError:
        return False
    return True


def _fingerprint(rows: list[_Row], live_path: Path) -> str:
    payload = json.dumps(
        [[row.id, row.name, row.settings_text, row.category, row.meta_text] for row in rows],
        ensure_ascii=False,
    )
    try:
        stamp = str(live_path.stat().st_mtime_ns)
    except FileNotFoundError:
        stamp = "none"
    return hashlib.sha256(f"{payload}|{stamp}".encode("utf-8")).hexdigest()


def _settings_config_dir(path: Path) -> Path | None:
    """cc-switch's own settings.json may relocate the OpenCode config dir."""
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        # Missing or unreadable: cc-switch then uses the default directory too.
        return None
    value = data.get("opencodeConfigDir") if isinstance(data, dict) else None
    if isinstance(value, str) and value.strip():
        return Path(value.strip()).expanduser()
    return None


def _read_live(path: Path) -> tuple[dict | None, list[str]]:
    """Live opencode.json for load; ``None`` means it could not be checked."""
    if not path.exists():
        return {}, []
    if path.suffix.lower() == ".jsonc":
        return None, [LIVE_UNREADABLE_NOTICE]
    try:
        value = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return None, [LIVE_UNREADABLE_NOTICE]
    if not isinstance(value, dict):
        return None, [LIVE_UNREADABLE_NOTICE]
    return value, []


def _read_live_for_save(path: Path) -> tuple[dict, bytes | None]:
    if path.suffix.lower() == ".jsonc":
        raise ServiceError("ccswitch_live_unsupported", f"{path.name} 含注释格式，本工具无法无损写回，已拒绝保存")
    if not path.exists():
        return {}, None
    try:
        original = path.read_bytes()
    except OSError as exc:
        raise ServiceError("io_error", f"无法读取 {path.name}：{exc.strerror or exc}") from exc
    try:
        value = json.loads(original.decode("utf-8-sig"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ServiceError(
            "ccswitch_live_unsupported", f"{path.name} 无法按纯 JSON 解析（可能含注释），已拒绝保存"
        ) from exc
    if not isinstance(value, dict):
        raise ServiceError("ccswitch_live_unsupported", f"{path.name} 的顶层不是 JSON 对象，已拒绝保存")
    if "provider" in value and not isinstance(value["provider"], dict):
        raise ServiceError("ccswitch_live_unsupported", f"{path.name} 中的 provider 不是对象，已拒绝保存")
    return value, original


def _backup_db(db: Path) -> Path:
    target = db.with_name(db.name + ".oc-modal.bak")
    try:
        with closing(sqlite3.connect(str(db))) as src, closing(sqlite3.connect(str(target))) as dst:
            src.backup(dst)
    except sqlite3.Error as exc:
        raise ServiceError("io_error", f"备份 CC Switch 数据库失败，已取消保存：{exc}") from exc
    return target


def _begin(conn: sqlite3.Connection) -> None:
    try:
        conn.execute("BEGIN IMMEDIATE")
    except sqlite3.OperationalError as exc:
        text = str(exc).lower()
        if "locked" in text or "busy" in text:
            raise ServiceError("ccswitch_running", RUNNING_MESSAGE) from exc
        raise


def _apply_rows(conn: sqlite3.Connection, rows: list[_Row], incoming: dict) -> list[str]:
    by_id = {row.id: row for row in rows}
    for key in incoming:
        existing = by_id.get(key)
        if existing is not None and existing.reason is not None:
            raise ServiceError("validation_error", f"提供商标识符 {key} 已被 CC Switch 中的只读项占用")
    top = conn.execute("SELECT MAX(sort_index) FROM providers WHERE app_type='opencode'").fetchone()[0]
    next_index = 0 if top is None else int(top) + 1
    for key, block in incoming.items():
        settings_text = json.dumps(block, ensure_ascii=False)
        name = block.get("name")
        existing = by_id.get(key)
        if existing is not None:
            label = name if isinstance(name, str) and name.strip() else existing.name
            conn.execute(
                "UPDATE providers SET settings_config=?, name=? WHERE id=? AND app_type='opencode'",
                (settings_text, label, key),
            )
            continue
        label = name if isinstance(name, str) and name.strip() else key
        conn.execute(
            "INSERT INTO providers (id, app_type, name, settings_config, category, created_at, sort_index, meta) "
            "VALUES (?, 'opencode', ?, ?, NULL, ?, ?, ?)",
            (key, label, settings_text, int(time.time() * 1000), next_index, NEW_ROW_META),
        )
        next_index += 1
    deleted = [row.id for row in rows if row.reason is None and row.id not in incoming]
    for row_id in deleted:
        conn.execute("DELETE FROM providers WHERE id=? AND app_type='opencode'", (row_id,))
    return deleted


def _merge_live(live: dict, incoming: dict, deleted: list[str], by_id: dict[str, _Row]) -> None:
    providers = live.setdefault("provider", {})
    for key, block in incoming.items():
        row = by_id.get(key)
        if row is None or row.live_managed:
            providers[key] = block
    for row_id in deleted:
        row = by_id.get(row_id)
        if row is not None and row.live_managed:
            providers.pop(row_id, None)


def _write_live(path: Path, live: dict) -> Path | None:
    backup = None
    if path.exists():
        backup = path.with_name(path.name + ".bak")
        try:
            shutil.copy2(path, backup)
        except OSError as exc:
            raise ServiceError("io_error", f"无法备份 {path.name}：{exc.strerror or exc}") from exc
    write_json(path, live)
    return backup


def _restore_live(path: Path, original: bytes | None) -> None:
    try:
        if original is None:
            path.unlink(missing_ok=True)
        else:
            path.write_bytes(original)
    except OSError as exc:
        raise ServiceError("io_error", f"写入数据库失败，且无法还原 {path.name}：{exc.strerror or exc}") from exc


def _default_running_check() -> bool:
    try:
        if sys.platform == "win32":
            result = subprocess.run(
                ["tasklist", "/FI", "IMAGENAME eq cc-switch.exe", "/NH"],
                capture_output=True,
                text=True,
                timeout=5,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            return "cc-switch.exe" in (result.stdout or "").lower()
        result = subprocess.run(["pgrep", "-x", "cc-switch"], capture_output=True, timeout=5)
        return result.returncode == 0
    except Exception:
        # Detection is best effort; BEGIN IMMEDIATE still catches a live writer.
        return False
