from __future__ import annotations

import re
import shutil
import subprocess
from functools import lru_cache


def _unavailable() -> dict:
    return {"available": False, "version": None, "major": None}


@lru_cache(maxsize=1)
def opencode_runtime() -> dict:
    """Probe the installed opencode CLI once per process. Never raises."""
    try:
        exe = None
        for name in ("opencode", "opencode.cmd", "opencode.exe"):
            exe = shutil.which(name)
            if exe:
                break
        if not exe:
            return _unavailable()
        proc = subprocess.run([exe, "--version"], capture_output=True, text=True, timeout=5)
        text = f"{proc.stdout or ''}\n{proc.stderr or ''}"
        match = re.search(r"(\d+)\.(\d+)\.(\d+)", text)
        if not match:
            return _unavailable()
        return {"available": True, "version": match.group(0), "major": int(match.group(1))}
    except Exception:
        return _unavailable()
