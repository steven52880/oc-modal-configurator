"""Where the tool keeps its own data.

``opencode.json`` is the document being edited and is never used as app storage.
The tool itself keeps one settings file, plus a catalog cache that is downloaded
on demand:

- ``~/.config/oc-modal-configurator/settings.json``
  Window geometry, split ratio, column widths, last and recent config paths.
- ``~/.config/oc-modal-configurator/cache/api.json``
  A models.dev snapshot, replaced as a whole when the user refreshes.
- ``~/.config/oc-modal-configurator/cache/api.meta.json``
  Fetch time and size for that snapshot, so the UI can show the date without
  parsing the catalog.

The ``api.json`` in the repository root is a development sample. Runtime code
does not read it, and it must not be packaged.

SQLite is not used. Settings are one small document, and the catalog is an
upstream JSON blob that is loaded once and replaced wholesale.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEV_DIR = PROJECT_ROOT / ".dev"
DEV_CONFIG = DEV_DIR / "opencode.json"
DEFAULT_OPENCODE_CONFIG = Path.home() / ".config" / "opencode" / "opencode.json"
MODELS_DEV_URL = "https://models.dev/api.json"


def app_config_dir() -> Path:
    override = os.environ.get("OC_APP_CONFIG_DIR")
    if override:
        return Path(override).expanduser()
    return Path.home() / ".config" / "oc-modal-configurator"


def settings_path() -> Path:
    return app_config_dir() / "settings.json"


def catalog_cache_path() -> Path:
    return app_config_dir() / "cache" / "api.json"


def catalog_meta_path() -> Path:
    return app_config_dir() / "cache" / "api.meta.json"


def default_opencode_path() -> Path:
    override = os.environ.get("OC_CONFIG_PATH")
    if override:
        return Path(override).expanduser()
    return DEFAULT_OPENCODE_CONFIG


def frontend_dist() -> Path:
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS")) / "frontend" / "dist"
    return PROJECT_ROOT / "frontend" / "dist"
