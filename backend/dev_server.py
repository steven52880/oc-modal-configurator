from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from backend.bridge import Bridge

PUBLIC_METHODS = (
    "get_app_info",
    "load_config",
    "save_config",
    "pick_config_file",
    "get_metadata_status",
    "refresh_metadata",
    "clear_metadata_cache",
    "reload_metadata_cache",
    "match_model_defaults",
    "match_models_defaults",
    "probe_provider_models",
    "search_catalog",
    "describe_api_key",
    "get_settings",
    "update_settings",
)


def serve_api(bridge: Bridge, host: str = "127.0.0.1", port: int = 8765) -> ThreadingHTTPServer:
    handler = _handler(bridge)
    server = ThreadingHTTPServer((host, port), handler)
    return server


def _handler(bridge: Bridge):
    class Handler(BaseHTTPRequestHandler):
        def do_OPTIONS(self):
            self.send_response(204)
            self._cors()
            self.end_headers()

        def do_GET(self):
            if self.path.rstrip("/") == "/api/health":
                self._send({"ok": True, "data": {"status": "up"}})
                return
            self._send({"ok": False, "error": {"code": "not_found", "message": "未知接口"}}, 404)

        def do_POST(self):
            name = self.path.rstrip("/").rsplit("/", 1)[-1]
            if not self.path.startswith("/api/") or name not in PUBLIC_METHODS:
                self._send({"ok": False, "error": {"code": "not_found", "message": "未知接口"}}, 404)
                return
            length = int(self.headers.get("Content-Length") or "0")
            raw = self.rfile.read(length) if length else b"{}"
            try:
                payload = json.loads(raw.decode("utf-8") or "{}")
            except json.JSONDecodeError:
                self._send({"ok": False, "error": {"code": "invalid_json", "message": "请求体不是 JSON"}}, 400)
                return
            args = payload.get("args") if isinstance(payload, dict) else None
            if args is None:
                args = []
            if not isinstance(args, list):
                self._send({"ok": False, "error": {"code": "invalid_document", "message": "args 必须是数组"}}, 400)
                return
            method = getattr(bridge, name)
            self._send(method(*args))

        def log_message(self, fmt: str, *args) -> None:
            return

        def _send(self, payload: dict, status: int = 200) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self._cors()
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _cors(self) -> None:
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")

    return Handler
