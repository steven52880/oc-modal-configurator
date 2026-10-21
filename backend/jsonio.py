from __future__ import annotations

import json
from pathlib import Path

from backend.errors import ServiceError


def read_json(path: Path) -> object:
    try:
        text = path.read_text(encoding="utf-8-sig")
    except OSError as exc:
        raise ServiceError("io_error", f"无法读取 {path.name}：{exc.strerror or exc}") from exc
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise ServiceError("invalid_json", f"{path.name} 不是合法 JSON：{exc.msg}") from exc


def write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    temporary = path.with_name(path.name + ".tmp")
    try:
        temporary.write_text(payload, encoding="utf-8")
        temporary.replace(path)
    except OSError as exc:
        raise ServiceError("io_error", f"无法写入 {path.name}：{exc.strerror or exc}") from exc
    finally:
        if temporary.exists():
            try:
                temporary.unlink()
            except OSError:
                pass
