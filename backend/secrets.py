"""Resolve OpenCode secret references without ever returning the secret itself."""

from __future__ import annotations

import os
import re
from pathlib import Path

from backend.errors import ServiceError

_ENV = re.compile(r"^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$")
_FILE = re.compile(r"^\{file:(.+)\}$")


def describe_api_key(value: str | None) -> dict:
    text = "" if value is None else str(value).strip()
    if not text:
        return {"kind": "empty", "name": "", "resolvable": False}
    env_match = _ENV.match(text)
    if env_match:
        name = env_match.group(1)
        return {"kind": "env", "name": name, "resolvable": name in os.environ}
    file_match = _FILE.match(text)
    if file_match:
        path = Path(file_match.group(1)).expanduser()
        return {"kind": "file", "name": str(path), "resolvable": path.is_file()}
    return {"kind": "literal", "name": "", "resolvable": True}


def resolve_secret(value: str | None) -> str:
    """Return the concrete secret for an outbound request. Callers must not log it."""
    info = describe_api_key(value)
    text = "" if value is None else str(value).strip()
    if info["kind"] == "empty":
        raise ServiceError("secret_missing", "未配置 API 密钥")
    if info["kind"] == "env":
        if not info["resolvable"]:
            raise ServiceError("secret_unresolved", f"环境变量 {info['name']} 未设置")
        return os.environ[info["name"]]
    if info["kind"] == "file":
        path = Path(info["name"])
        if not info["resolvable"]:
            raise ServiceError("secret_unresolved", f"密钥文件不存在：{path}")
        data = path.read_text(encoding="utf-8").strip()
        if not data:
            raise ServiceError("secret_unresolved", f"密钥文件是空的：{path}")
        return data
    return text
