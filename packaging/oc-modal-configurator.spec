# -*- mode: python ; coding: utf-8 -*-
"""Windows folder build.

The folder can be copied to another PC. It contains the Python runtime, the
built interface, and the WebView2 loader libraries. It does not contain the
repository sample api.json. The target PC still needs the system WebView2
Runtime and .NET Framework 4.6.2, which current Windows 10/11 installs already
include.
"""

import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_all

project = Path(SPECPATH).resolve().parent
frontend = project / "frontend" / "dist"
if not (frontend / "index.html").is_file():
    raise SystemExit("frontend/dist is missing. Run npm run build in frontend first.")

datas = [(str(frontend), "frontend/dist")]
binaries = []
hiddenimports = []
for package in ("webview", "clr_loader", "pythonnet"):
    package_datas, package_binaries, package_hidden = collect_all(package)
    datas += package_datas
    binaries += package_binaries
    hiddenimports += package_hidden

# Copy HTTPS runtime libraries from either a standard Python installation or
# a conda-based Python so the folder works without the build environment.
python_home = Path(sys.base_prefix)
runtime_dirs = [python_home / "DLLs", python_home / "Library" / "bin"]
pyvenv = Path(sys.prefix) / "pyvenv.cfg"
if pyvenv.is_file():
    for line in pyvenv.read_text(encoding="utf-8").splitlines():
        if line.lower().startswith("home"):
            runtime_dirs.append(Path(line.split("=", 1)[1].strip()) / "Library" / "bin")
            break
runtime_dlls = [
    "libcrypto-3-x64.dll",
    "libssl-3-x64.dll",
    "libcrypto-3.dll",
    "libssl-3.dll",
    "libexpat.dll",
    "liblzma.dll",
    "LIBBZ2.dll",
    "ffi.dll",
    # _sqlite3.pyd links against it; the CC Switch source reads cc-switch.db.
    "sqlite3.dll",
]
for runtime_dir in runtime_dirs:
    if not runtime_dir.is_dir():
        continue
    names = runtime_dlls + [path.name for path in runtime_dir.glob("zlib*.dll")]
    for name in names:
        source = runtime_dir / name
        if source.is_file() and not any(Path(existing).name.lower() == name.lower() for existing, _dest in binaries):
            binaries.append((str(source), "."))
hiddenimports += [
    "bottle",
    "proxy_tools",
    "backend",
    "backend.bridge",
    "backend.ccswitch_service",
    "backend.config_service",
    "backend.dev_server",
    "backend.errors",
    "backend.fields",
    "backend.jsonio",
    "backend.metadata_service",
    "backend.param_templates",
    "backend.paths",
    "backend.provider_probe",
    "backend.secrets",
    "backend.settings_store",
]

a = Analysis(
    [str(project / "app.py")],
    pathex=[str(project)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter"],
    noarchive=False,
)
if not any(name.lower().startswith("libssl") for name, _source, _kind in a.binaries):
    raise SystemExit("OpenSSL was not found. The packaged program would be unable to download the model catalog.")
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="oc-modal-configurator",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="oc-modal-configurator",
)
