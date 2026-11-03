import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient

import main
import s2s_auth

KEY = "test-ocr-s2s-key"
PROTECTED = [
    ("get", "/status"),
    ("get", "/status/some-doc"),
    ("get", "/instance_status"),
    ("post", "/process"),
    ("post", "/process_async"),
]


class S2SKeyMatchesTest(unittest.TestCase):
    def test_matches_only_identical_non_empty_keys(self):
        assert s2s_auth.s2s_key_matches(KEY, KEY)
        assert not s2s_auth.s2s_key_matches("wrong", KEY)
        assert not s2s_auth.s2s_key_matches(None, KEY)
        assert not s2s_auth.s2s_key_matches("", KEY)
        assert not s2s_auth.s2s_key_matches("", "")
        assert not s2s_auth.s2s_key_matches(KEY, "")


class S2SRouteAuthTest(unittest.TestCase):
    def setUp(self):
        # No `with` block: the lifespan (Redis poller, LightOn client) never runs,
        # so app.state.processor stays unset and authorised OCR calls return 503.
        self.client = TestClient(main.app, raise_server_exceptions=False)
        main.app.state.processor = None

    def _call(self, method, path, headers=None):
        return getattr(self.client, method)(path, headers=headers or {})

    def test_protected_routes_reject_missing_key(self):
        with patch.object(s2s_auth, "settings", SimpleNamespace(s2s_key=KEY)):
            for method, path in PROTECTED:
                with self.subTest(path=path):
                    assert self._call(method, path).status_code == 401

    def test_protected_routes_reject_wrong_key(self):
        with patch.object(s2s_auth, "settings", SimpleNamespace(s2s_key=KEY)):
            for method, path in PROTECTED:
                with self.subTest(path=path):
                    resp = self._call(method, path, {"x-s2s-key": "wrong"})
                    assert resp.status_code == 401
                    assert resp.json() == {"detail": "Unauthorized"}

    def test_unset_key_rejects_everything(self):
        with patch.object(s2s_auth, "settings", SimpleNamespace(s2s_key="")):
            for method, path in PROTECTED:
                with self.subTest(path=path):
                    resp = self._call(method, path, {"x-s2s-key": ""})
                    assert resp.status_code == 401

    def test_valid_key_reaches_handlers(self):
        with patch.object(s2s_auth, "settings", SimpleNamespace(s2s_key=KEY)):
            headers = {"x-s2s-key": KEY}
            # /status itself is past auth; its pre-existing response-model mismatch
            # is out of scope here, so only assert the auth check let it through.
            assert self.client.get("/status", headers=headers).status_code != 401
            assert self.client.get("/status/missing", headers=headers).status_code == 404
            assert self.client.get("/instance_status", headers=headers).status_code == 200
            resp = self.client.post(
                "/process_async",
                headers=headers,
                files={"file": ("doc.pdf", b"%PDF-1.4", "application/pdf")},
                data={"job_id": "j1", "file_id": "f1", "doc_id": "d1"},
            )
            # Past the auth check; fails only because no OCR processor is configured.
            assert resp.status_code == 503

    def test_health_needs_no_key(self):
        with patch.object(s2s_auth, "settings", SimpleNamespace(s2s_key=KEY)):
            # 503 because no processor is configured, but never 401.
            assert self.client.get("/health").status_code == 503

    def test_docs_and_cors_are_disabled(self):
        assert self.client.get("/docs").status_code == 404
        assert self.client.get("/openapi.json").status_code == 404
        resp = self.client.get("/health", headers={"Origin": "https://evil.example"})
        assert "access-control-allow-origin" not in resp.headers


if __name__ == "__main__":
    unittest.main()
