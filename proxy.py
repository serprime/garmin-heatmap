#!/usr/bin/env python3
"""Mini-Proxy fuer die Garmin Personal API.

Die Garmin-API sendet keine CORS-Header, deshalb kann der Browser sie nicht direkt
aufrufen. Dieser Proxy leitet Requests unter /garmin/... 1:1 an
https://personal.connectapi.garmin.com weiter und haengt CORS-Header an.
Er speichert nichts und kennt den API-Key nicht (der kommt im Authorization-Header
vom Browser). Zusaetzlich liefert er die App-Dateien unter http://127.0.0.1:8787/ aus.

Start:  python3 proxy.py          (oder Doppelklick auf start.command)
"""
import http.server
import mimetypes
import os
import sys
import urllib.error
import urllib.request

GARMIN_BASE = "https://personal.connectapi.garmin.com"
HOST = "127.0.0.1"
PORT = int(os.environ.get("GARMIN_PROXY_PORT", "8787"))
APP_DIR = os.path.dirname(os.path.abspath(__file__))
FORWARD_HEADERS = ("authorization", "accept", "content-type")


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        sys.stdout.write("%s %s\n" % (self.command, self.path.split("?")[0]))
        sys.stdout.flush()

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Accept, Content-Type")
        self.send_header("Access-Control-Expose-Headers", "Content-Type, Content-Disposition")
        self.send_header("Access-Control-Max-Age", "86400")

    def _reply(self, status, body=b"", content_type="application/octet-stream"):
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def do_OPTIONS(self):
        self._reply(204)

    def do_GET(self):
        self._handle()

    def do_POST(self):
        self._handle()

    def _handle(self):
        if self.path == "/health":
            return self._reply(200, b'{"ok":true,"proxy":"garmin-heatmap"}', "application/json")
        if self.path.startswith("/garmin/"):
            return self._forward()
        return self._static()

    def _forward(self):
        url = GARMIN_BASE + self.path[len("/garmin"):]
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None
        headers = {k: v for k, v in self.headers.items() if k.lower() in FORWARD_HEADERS}
        headers.setdefault("Accept", "application/json")
        headers["User-Agent"] = "garmin-heatmap-proxy/1.0"
        req = urllib.request.Request(url, data=body, method=self.command, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                data = resp.read()
                ctype = resp.headers.get("Content-Type", "application/octet-stream")
                return self._reply(resp.status, data, ctype)
        except urllib.error.HTTPError as e:
            data = e.read()
            return self._reply(e.code, data, e.headers.get("Content-Type", "text/plain"))
        except Exception as e:  # noqa: BLE001
            return self._reply(502, ("proxy error: %s" % e).encode(), "text/plain")

    def _static(self):
        path = self.path.split("?")[0]
        if path in ("", "/"):
            path = "/index.html"
        full = os.path.normpath(os.path.join(APP_DIR, path.lstrip("/")))
        rel = os.path.relpath(full, APP_DIR)
        if rel.startswith(".git") or rel == "garmin-api-key.txt":
            return self._reply(404, b"not found", "text/plain")
        if not full.startswith(APP_DIR) or not os.path.isfile(full):
            return self._reply(404, b"not found", "text/plain")
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        with open(full, "rb") as f:
            return self._reply(200, f.read(), ctype)


def main():
    mimetypes.add_type("application/javascript", ".js")
    server = http.server.ThreadingHTTPServer((HOST, PORT), Handler)
    print("garmin-heatmap Proxy laeuft auf http://%s:%d/  (Strg+C zum Beenden)" % (HOST, PORT))
    print("Leitet /garmin/* an %s weiter" % GARMIN_BASE)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
