"""Tests for the /claw-code path mode and its access gate.

    pip install -r requirements.txt pytest && pytest

The upstream sandbox and claw-auth are both httpx MockTransports, so nothing
here needs a cluster. CLAW_AUTH_URL is set before the import because the module
reads it at import time.

Upstream bodies are async iterators on purpose: a Response built from `text=`
or `content=<bytes>` counts as already read, and the proxy streams it with
aiter_raw.
"""

import asyncio
import gzip
import os

os.environ["CLAW_AUTH_URL"] = "http://claw-auth.test"

import httpx
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

import sandbox_router

SBX = "sbx-1"
SAME_ORIGIN = "http://testserver"
UPSTREAM = f"{SBX}.xyne-apps.svc.cluster.local:8443"


async def _stream(data: bytes):
    yield data


def upstream_response(status: int = 200, body: bytes = b"workbench", **headers) -> httpx.Response:
    return httpx.Response(status, content=_stream(body), headers=headers)


def ok(_request: httpx.Request) -> httpx.Response:
    return upstream_response()


def allow_gate(_request: httpx.Request) -> httpx.Response:
    return httpx.Response(200, json={"allow": True, "reason": "owner"})


def build(upstream=ok, gate=allow_gate):
    """Wire both clients to mocks and return (TestClient, upstream_requests)."""
    seen = []

    def record(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return upstream(request)

    sandbox_router.client = httpx.AsyncClient(transport=httpx.MockTransport(record))
    sandbox_router.access_client = httpx.AsyncClient(transport=httpx.MockTransport(gate))
    return TestClient(sandbox_router.app, follow_redirects=False), seen


def signed_in(client: TestClient, session: str = "s") -> TestClient:
    client.cookies.clear()
    client.cookies.set("xyne_session", session)
    return client


@pytest.fixture(autouse=True)
def _clear_access_cache():
    sandbox_router._access_cache.clear()
    sandbox_router._access_locks.clear()
    yield
    sandbox_router._access_cache.clear()
    sandbox_router._access_locks.clear()


# ── the trailing slash ──

def test_bare_path_redirects_to_slashed():
    client, seen = build()
    resp = signed_in(client).get(f"/claw-code/{SBX}")
    assert resp.status_code == 302
    assert resp.headers["location"] == f"/claw-code/{SBX}/"
    assert seen == []


def test_bare_path_redirect_keeps_the_query():
    client, _ = build()
    resp = signed_in(client).get(f"/claw-code/{SBX}?folder=/home")
    assert resp.headers["location"] == f"/claw-code/{SBX}/?folder=/home"


def test_slashed_path_is_proxied_not_redirected():
    """The naive `rest == ""` check would redirect this too, and loop."""
    client, seen = build()
    resp = signed_in(client).get(f"/claw-code/{SBX}/")
    assert resp.status_code == 200
    assert len(seen) == 1


# ── proxying ──

def test_prefix_is_stripped():
    client, seen = build()
    signed_in(client).get(f"/claw-code/{SBX}/")
    client.get(f"/claw-code/{SBX}/static/out/vs/loader.js?v=2")
    assert seen[0].url.path == "/"
    assert seen[1].url.path == "/static/out/vs/loader.js"
    assert seen[1].url.query == b"v=2"


def test_host_and_origin_agree():
    """code-server rejects a request whose Origin host differs from its Host."""
    client, seen = build()
    signed_in(client).get(f"/claw-code/{SBX}/", headers={"origin": SAME_ORIGIN})
    assert seen[0].headers["host"] == UPSTREAM
    assert seen[0].headers["origin"] == f"http://{UPSTREAM}"


def test_session_cookie_is_not_forwarded_into_the_sandbox():
    """The upstream pod runs agent-written code; the gate is the only consumer."""
    client, seen = build()
    signed_in(client).get(
        f"/claw-code/{SBX}/", headers={"authorization": "Bearer xyne_tok", "x-custom": "keep"},
    )
    assert "cookie" not in {k.lower() for k in seen[0].headers}
    assert "authorization" not in {k.lower() for k in seen[0].headers}
    assert seen[0].headers["x-custom"] == "keep"


def test_sandbox_cannot_set_headers_that_reach_the_spaces_origin():
    """These routes answer on the dashboard's host, so a sandbox must not be
    able to set cookies on it, sign the viewer out, or widen a worker's scope."""
    def hostile(_request):
        return upstream_response(**{
            "set-cookie": "user_session_id=attacker; Path=/",
            "clear-site-data": '"cookies"',
            "service-worker-allowed": "/",
            "content-type": "text/html",
        })

    client, _ = build(hostile)
    resp = signed_in(client).get(f"/claw-code/{SBX}/")
    relayed = {k.lower() for k in resp.headers}
    assert "set-cookie" not in relayed
    assert "clear-site-data" not in relayed
    assert "service-worker-allowed" not in relayed
    assert resp.headers["content-type"] == "text/html"


def test_claw_preview_also_withholds_set_cookie():
    def hostile(_request):
        return upstream_response(**{"set-cookie": "user_session_id=attacker; Path=/"})

    client, _ = build(hostile)
    resp = client.get(f"/claw-preview/{SBX}/vnc.html")
    assert "set-cookie" not in {k.lower() for k in resp.headers}


def test_gzip_body_is_relayed_raw():
    """aiter_bytes would hand the browser plain bytes under content-encoding."""
    plain = b"workbench" * 50

    def gzipped(_request):
        return upstream_response(
            body=gzip.compress(plain),
            **{"content-encoding": "gzip", "content-type": "text/html"},
        )

    client, _ = build(gzipped)
    resp = signed_in(client).get(f"/claw-code/{SBX}/")
    assert resp.headers["content-encoding"] == "gzip"
    # httpx decodes it on this side, which only works if the compressed bytes
    # were relayed verbatim.
    assert resp.content == plain


def test_hop_by_hop_response_headers_are_dropped():
    def chunked(_request):
        return upstream_response(
            body=b"hi", **{"transfer-encoding": "chunked", "connection": "keep-alive"},
        )

    client, _ = build(chunked)
    resp = signed_in(client).get(f"/claw-code/{SBX}/")
    assert "connection" not in {k.lower() for k in resp.headers}
    assert resp.text == "hi"


def test_absolute_upstream_redirect_is_rewritten():
    def redirect(_request):
        return upstream_response(302, b"", location=f"http://{UPSTREAM}/?folder=/home")

    client, _ = build(redirect)
    resp = signed_in(client).get(f"/claw-code/{SBX}/")
    assert resp.headers["location"] == f"/claw-code/{SBX}/?folder=/home"


def test_invalid_sandbox_id_is_rejected():
    client, seen = build()
    resp = signed_in(client).get("/claw-code/not_a_sandbox/")
    assert resp.status_code == 400
    assert seen == []


# ── the access gate ──

def test_no_session_is_401():
    client, seen = build()
    resp = client.get(f"/claw-code/{SBX}/")
    assert resp.status_code == 401
    assert seen == []


def test_claw_auth_deny_is_relayed():
    def deny(_request):
        return httpx.Response(403, json={"allow": False, "reason": "denied"})

    client, seen = build(gate=deny)
    resp = signed_in(client).get(f"/claw-code/{SBX}/")
    assert resp.status_code == 403
    assert seen == []


def test_gate_fails_closed_when_claw_auth_is_unreachable():
    def unreachable(request):
        raise httpx.ConnectError("no route", request=request)

    client, seen = build(gate=unreachable)
    resp = signed_in(client).get(f"/claw-code/{SBX}/")
    assert resp.status_code == 503
    assert seen == []


def test_navigation_denial_is_a_readable_page():
    client, _ = build()
    resp = client.get(f"/claw-code/{SBX}/", headers={"accept": "text/html"})
    assert resp.status_code == 401
    assert resp.headers["content-type"].startswith("text/html")
    assert "Sign in to Xyne" in resp.text


def test_non_navigation_denial_stays_json():
    client, _ = build()
    resp = client.get(f"/claw-code/{SBX}/", headers={"accept": "application/json"})
    assert resp.status_code == 401
    assert resp.json()["detail"].startswith("Sign in to Xyne")


def test_gate_decision_is_cached():
    gate_calls = []

    def counting_gate(request):
        gate_calls.append(request)
        return httpx.Response(200, json={"allow": True})

    client, _ = build(gate=counting_gate)
    signed_in(client)
    for _ in range(5):
        client.get(f"/claw-code/{SBX}/")
    assert len(gate_calls) == 1
    assert gate_calls[0].url.params["sandboxId"] == SBX


def test_gate_is_single_flight():
    """A cold workbench fans out ~100 requests; claw-auth must see one check.

    Without this, the burst counts against the user's own 600/min claw-auth
    bucket — the one the dashboard uses — so opening the editor could rate-limit
    them out of Xyne.
    """
    gate_calls = []

    async def slow_gate(request):
        gate_calls.append(request)
        await asyncio.sleep(0.05)
        return httpx.Response(200, json={"allow": True})

    sandbox_router.access_client = httpx.AsyncClient(transport=httpx.MockTransport(slow_gate))

    async def race():
        return await asyncio.gather(
            *[sandbox_router._claw_code_access(SBX, "xyne_session=s", "") for _ in range(50)]
        )

    verdicts = asyncio.run(race())
    assert all(allowed for (allowed, _status, _reason) in verdicts)
    assert len(gate_calls) == 1


def test_gate_keys_on_the_session():
    gate_calls = []

    def counting_gate(request):
        gate_calls.append(request)
        return httpx.Response(200, json={"allow": True})

    client, _ = build(gate=counting_gate)
    signed_in(client, "first").get(f"/claw-code/{SBX}/")
    signed_in(client, "second").get(f"/claw-code/{SBX}/")
    assert len(gate_calls) == 2


def test_ws_upgrade_is_gated():
    gate_calls = []

    def counting_gate(request):
        gate_calls.append(request)
        return httpx.Response(403, json={"allow": False})

    client, _ = build(gate=counting_gate)
    with pytest.raises(WebSocketDisconnect) as excinfo:
        with signed_in(client).websocket_connect(f"/claw-code/{SBX}/", headers={"origin": SAME_ORIGIN}):
            pass
    assert excinfo.value.code == 1008
    assert len(gate_calls) == 1


# ── Origin ──

def test_same_origin_http_is_proxied():
    client, seen = build()
    resp = signed_in(client).post(f"/claw-code/{SBX}/vscode-remote", headers={"origin": SAME_ORIGIN})
    assert resp.status_code == 200
    assert len(seen) == 1


def test_forwarded_public_host_is_same_origin():
    client, seen = build()
    resp = signed_in(client).get(
        f"/claw-code/{SBX}/",
        headers={
            "origin": "https://app.xyne.test",
            "x-forwarded-host": "app.xyne.test",
            "x-forwarded-proto": "https",
        },
    )
    assert resp.status_code == 200
    assert len(seen) == 1


def test_foreign_origin_http_is_403():
    client, seen = build()
    resp = signed_in(client).post(
        f"/claw-code/{SBX}/vscode-remote", headers={"origin": "https://evil.test"},
    )
    assert resp.status_code == 403
    assert seen == []


def test_http_origin_under_https_is_403():
    client, seen = build()
    resp = signed_in(client).get(
        f"/claw-code/{SBX}/",
        headers={
            "origin": "http://app.xyne.test",
            "host": "app.xyne.test",
            "x-forwarded-proto": "https",
        },
    )
    assert resp.status_code == 403
    assert seen == []


def test_http_without_origin_is_proxied():
    """Top-level navigations and same-origin GETs may carry no Origin."""
    client, seen = build()
    resp = signed_in(client).get(f"/claw-code/{SBX}/")
    assert resp.status_code == 200
    assert len(seen) == 1


def test_public_origins_allowlist(monkeypatch):
    monkeypatch.setattr(sandbox_router, "PUBLIC_ORIGINS", frozenset({"https://app.xyne.test"}))
    client, seen = build()
    resp = signed_in(client).get(f"/claw-code/{SBX}/", headers={"origin": "https://app.xyne.test"})
    assert resp.status_code == 200
    assert len(seen) == 1


def test_head_and_options_are_routed():
    client, seen = build()
    signed_in(client)
    assert client.head(f"/claw-code/{SBX}/").status_code == 200
    assert client.options(f"/claw-code/{SBX}/", headers={"origin": SAME_ORIGIN}).status_code == 200
    assert [r.method for r in seen] == ["HEAD", "OPTIONS"]


def _ws_rejected_before_gate(headers):
    gate_calls = []

    def counting_gate(request):
        gate_calls.append(request)
        return httpx.Response(200, json={"allow": True})

    client, seen = build(gate=counting_gate)
    with pytest.raises(WebSocketDisconnect) as excinfo:
        with signed_in(client).websocket_connect(f"/claw-code/{SBX}/", headers=headers):
            pass
    assert excinfo.value.code == 1008
    assert gate_calls == []
    assert seen == []


def test_foreign_origin_ws_is_403():
    _ws_rejected_before_gate({"origin": "https://evil.test"})


def test_missing_origin_ws_is_403():
    _ws_rejected_before_gate({})


def test_same_origin_ws_reaches_upstream(monkeypatch):
    pumped = []

    async def fake_pump(websocket, target, origin, label, sandbox_id):
        pumped.append((target, origin))
        await websocket.accept()
        await websocket.send_text("hello")
        await websocket.close()

    monkeypatch.setattr(sandbox_router, "_pump_ws", fake_pump)
    client, _ = build()
    with signed_in(client).websocket_connect(f"/claw-code/{SBX}/", headers={"origin": SAME_ORIGIN}) as ws:
        assert ws.receive_text() == "hello"
    assert pumped == [(f"ws://{UPSTREAM}/", f"http://{UPSTREAM}")]


# ── claw-preview, which shares the WS pump ──

def test_claw_preview_bare_prefix_still_opens_vnc():
    client, _ = build()
    resp = client.get(f"/claw-preview/{SBX}/")
    assert resp.status_code == 302
    assert resp.headers["location"].startswith(f"/claw-preview/{SBX}/vnc.html")


def test_claw_preview_is_not_gated():
    client, seen = build()
    resp = client.get(f"/claw-preview/{SBX}/vnc.html")
    assert resp.status_code == 200
    assert seen[0].headers["host"] == "127.0.0.1:6080"


def test_claw_preview_also_withholds_the_session_cookie():
    client, seen = build()
    signed_in(client).get(f"/claw-preview/{SBX}/vnc.html")
    assert "cookie" not in {k.lower() for k in seen[0].headers}
