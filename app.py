"""Desktop entry point.

The repository ``api.json`` is a development sample. This program does not read
it and it must not be packaged. The model catalog is downloaded into the user
cache directory only after a manual refresh.
"""

from __future__ import annotations

import argparse
import os
import shutil
import sqlite3
import sys
import threading
from contextlib import closing
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from backend.bridge import Bridge
from backend.ccswitch_service import CcSwitchService
from backend.config_service import ConfigService
from backend.jsonio import write_json
from backend.metadata_service import MetadataService
from backend.paths import DEFAULT_OPENCODE_CONFIG, DEV_CONFIG, DEV_DIR, frontend_dist
from backend.settings_store import SettingsStore
from backend.dev_server import serve_api


def main() -> None:
    parser = argparse.ArgumentParser(description="OpenCode 配置编辑器")
    parser.add_argument("--dev", action="store_true", help="打开指向 Vite 的原生窗口")
    parser.add_argument("--dev-server", action="store_true", help="只启动本地 API，供浏览器调试")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--config", default=None, help="要编辑的 opencode.json 路径")
    args = parser.parse_args()

    if args.dev or args.dev_server:
        os.environ["OC_APP_CONFIG_DIR"] = str(DEV_DIR / "appdata")
        if args.config is None:
            os.environ["OC_CONFIG_PATH"] = str(ensure_dev_config())
        isolate_dev_ccswitch(args.config)

    config_path = Path(args.config).expanduser() if args.config else None
    bridge = Bridge(
        ConfigService(config_path),
        MetadataService(),
        SettingsStore(),
        CcSwitchService(),
    )

    if args.dev or args.dev_server:
        server = serve_api(bridge, port=args.port)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        print(f"API http://127.0.0.1:{args.port}/api/health")

    if args.dev_server:
        try:
            thread.join()
        except KeyboardInterrupt:
            return
        return

    if args.dev:
        open_window(bridge, "http://127.0.0.1:5173")
        return

    dist = frontend_dist()
    index = dist / "index.html"
    if not index.is_file():
        raise SystemExit("前端尚未构建。开发时请运行 python app.py --dev，并另开 npm run dev。")
    if sys.platform == "win32":
        ensure_windows_runtime()
    url = serve_dist(dist)
    open_window(bridge, url)


def open_window(bridge: Bridge, url: str) -> None:
    try:
        import webview
    except ImportError as exc:
        raise SystemExit("未安装 pywebview。请使用项目内的 venv 运行。") from exc

    settings = bridge._read_settings()
    window_state = settings["window"]
    window = webview.create_window(
        "OpenCode 配置编辑器",
        url,
        js_api=bridge,
        width=int(window_state["width"]),
        height=int(window_state["height"]),
        x=window_state.get("x"),
        y=window_state.get("y"),
        min_size=(1024, 680),
        text_select=True,
    )
    bridge._attach_window(window)

    def persist() -> None:
        bridge._remember_window(window.width, window.height, window.x, window.y)

    def persist_now() -> None:
        bridge._remember_window(window.width, window.height, window.x, window.y)
        bridge._flush_window()

    window.events.resized += persist
    window.events.moved += persist
    window.events.closing += persist_now
    webview.start()


def serve_dist(directory: Path) -> str:
    handler = partial(SimpleHTTPRequestHandler, directory=str(directory))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return f"http://127.0.0.1:{server.server_address[1]}/"


def ensure_windows_runtime() -> None:
    """WebView2 and .NET Framework stay on the machine; they are not bundled."""
    import winreg

    net_ok = False
    try:
        with winreg.OpenKey(
            winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full"
        ) as key:
            release, _ = winreg.QueryValueEx(key, "Release")
            net_ok = int(release) >= 394802
    except OSError:
        net_ok = False
    webview_ok = _windows_webview2_installed()
    if net_ok and webview_ok:
        return
    missing = []
    if not net_ok:
        missing.append(".NET Framework 4.6.2 或更高版本")
    if not webview_ok:
        missing.append("Microsoft Edge WebView2 Runtime（Windows 10/11 上通常已随 Edge 安装）")
    message = (
        "这台电脑还缺少运行所需的系统组件：\n\n"
        + "\n".join(f"- {item}" for item in missing)
        + "\n\n安装后重新打开本程序。WebView2 下载页：\n"
        "https://developer.microsoft.com/microsoft-edge/webview2/"
    )
    ctypes_message(message)
    raise SystemExit(message)


def _windows_webview2_installed() -> bool:
    import winreg

    clients = (
        "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        "{2CD8A007-E189-409D-A2C8-9AF4EF3C72AA}",
        "{0D50BFEC-CD6A-4F9A-964C-C7416E3ACB10}",
        "{65C35B14-6C1D-4122-AC46-7148CC9D6497}",
    )
    roots = (
        (winreg.HKEY_CURRENT_USER, r"Software\Microsoft\EdgeUpdate\Clients"),
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\EdgeUpdate\Clients"),
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients"),
    )
    for hive, base in roots:
        for client in clients:
            try:
                with winreg.OpenKey(hive, base + "\\" + client) as key:
                    version, _ = winreg.QueryValueEx(key, "pv")
            except OSError:
                continue
            if str(version) and str(version) != "0.0.0.0":
                return True
    return False


def ctypes_message(message: str) -> None:
    import ctypes

    ctypes.windll.user32.MessageBoxW(None, message, "OpenCode 配置编辑器", 0x10)


def ensure_dev_config() -> Path:
    DEV_DIR.mkdir(parents=True, exist_ok=True)
    if not DEV_CONFIG.exists() and DEFAULT_OPENCODE_CONFIG.is_file():
        shutil.copy2(DEFAULT_OPENCODE_CONFIG, DEV_CONFIG)
    if not DEV_CONFIG.exists():
        write_json(DEV_CONFIG, {"provider": {}})
    return DEV_CONFIG


def isolate_dev_ccswitch(config: str | None) -> None:
    """Point the cc-switch source at project-local copies so dev never writes real files."""
    if "OC_CCSWITCH_DB" not in os.environ:
        DEV_DIR.mkdir(parents=True, exist_ok=True)
        dev_db = DEV_DIR / "cc-switch.db"
        real_db = Path.home() / ".cc-switch" / "cc-switch.db"
        if not dev_db.exists() and real_db.is_file():
            with closing(sqlite3.connect(f"{real_db.resolve().as_uri()}?mode=ro", uri=True)) as src:
                with closing(sqlite3.connect(str(dev_db))) as dst:
                    src.backup(dst)
        os.environ["OC_CCSWITCH_DB"] = str(dev_db)
    live = Path(config).expanduser() if config else DEV_CONFIG
    os.environ["OC_CCSWITCH_LIVE_PATH"] = str(live)
    os.environ["OC_CCSWITCH_SKIP_RUNNING_CHECK"] = "1"


if __name__ == "__main__":
    main()
