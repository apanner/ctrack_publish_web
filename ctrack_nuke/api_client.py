from __future__ import print_function

import json
import socket
import time

try:
    from urllib.request import Request, urlopen
    from urllib.error import HTTPError, URLError
except ImportError:
    from urllib2 import Request, urlopen, HTTPError, URLError


DEFAULT_BASE_URL = "http://127.0.0.1:7777"
DEFAULT_TIMEOUT_SECONDS = 2.5


class EngineClient(object):
    def __init__(self, base_url=DEFAULT_BASE_URL, timeout=DEFAULT_TIMEOUT_SECONDS):
        self.base_url = (base_url or DEFAULT_BASE_URL).rstrip("/")
        self.timeout = timeout

    def health(self):
        return self._request("GET", "/health")

    def status(self):
        return self._request("GET", "/api/engine/status")

    def open_gui(self, panel="logs"):
        return self._request("POST", "/api/gui/open", payload={"panel": panel})

    def rescan(self):
        return self._request("POST", "/api/engine/rescan")

    def ensure_running(self, wait_seconds=8.0):
        health = self.health()
        if health.get("ok"):
            return True
        self.open_gui(panel="tray")
        deadline = time.time() + wait_seconds
        while time.time() < deadline:
            time.sleep(0.5)
            health = self.health()
            if health.get("ok"):
                return True
        return False

    def enqueue_publish(self, file_path, meta=None, auto_process=True, **context_kwargs):
        payload = {
            "file_path": file_path,
            "meta": meta or {},
            "auto_process": bool(auto_process),
        }
        if context_kwargs:
            payload.update(context_kwargs)
        return self._request("POST", "/api/publish/enqueue", payload=payload, timeout=120.0)

    def get_publish_jobs(self):
        return self._request("GET", "/api/publish/jobs")

    def process_next_publish(self):
        return self._request("POST", "/api/publish/process-next")

    def check_update(self, product="engine", local_version=None, include_download_url=True):
        query_parts = ["product=%s" % product]
        if local_version:
            query_parts.append("localVersion=%s" % local_version)
        if include_download_url:
            query_parts.append("includeDownloadUrl=true")
        query = "&".join(query_parts)
        return self._request("GET", "/api/update/check?%s" % query)

    def _request(self, method, path, payload=None, timeout=None):
        url = self.base_url + path
        data = None
        headers = {"Accept": "application/json"}

        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"

        request = Request(url=url, data=data, headers=headers)
        if hasattr(request, "get_method"):
            request.get_method = lambda: method

        effective_timeout = self.timeout if timeout is None else timeout
        try:
            response = urlopen(request, timeout=effective_timeout)
            body = response.read()
            return {
                "ok": True,
                "status_code": getattr(response, "code", 200),
                "data": self._decode_json(body),
                "raw": self._safe_decode(body),
                "url": url,
            }
        except HTTPError as err:
            body = err.read() if hasattr(err, "read") else b""
            return {
                "ok": False,
                "status_code": getattr(err, "code", None),
                "error": "HTTP %s" % getattr(err, "code", "error"),
                "data": self._decode_json(body),
                "raw": self._safe_decode(body),
                "url": url,
            }
        except (URLError, socket.error, ValueError) as err:
            return {
                "ok": False,
                "status_code": None,
                "error": str(err),
                "data": None,
                "raw": "",
                "url": url,
            }

    @staticmethod
    def _decode_json(raw_body):
        if not raw_body:
            return None

        text_body = EngineClient._safe_decode(raw_body)
        if not text_body:
            return None

        try:
            return json.loads(text_body)
        except ValueError:
            return None

    @staticmethod
    def _safe_decode(raw_bytes):
        if raw_bytes is None:
            return ""
        if isinstance(raw_bytes, str):
            return raw_bytes
        try:
            return raw_bytes.decode("utf-8")
        except Exception:
            return raw_bytes.decode("utf-8", "replace")
