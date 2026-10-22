# Forked from upstream kubernetes-sigs/agent-sandbox sandbox_router.py
# (clients/python/agentic-sandbox-client/sandbox-router/sandbox_router.py)
# with a new @app.websocket("/{full_path:path}") proxy route added so that
# Chromium-CDP / Playwright-MCP / any other WS protocol can be routed
# through the same X-Sandbox-* header contract that HTTP already uses.

import asyncio
import hashlib
import os
import time
import traceback
from urllib.parse import urlsplit

import httpx
import websockets
from fastapi import FastAPI, Request, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, StreamingResponse, RedirectResponse

app = FastAPI()

DEFAULT_SANDBOX_PORT = 8888
DEFAULT_NAMESPACE = "default"
DEFAULT_PROXY_TIMEOUT = 180.0

# Path mode for human-driven preview. When a request's :path starts with
# /claw-preview/<sandboxId>/<rest>, route to the noVNC port on that sandbox
# instead of consulting X-Sandbox-* headers (the browser can't set custom
# headers on a navigation). Header mode below is unchanged — Playwright/MCP
# keeps using --cdp-header X-Sandbox-* exactly as before.
CLAW_PREVIEW_PREFIX = "/claw-preview/"
CLAW_PREVIEW_NAMESPACE = os.environ.get("CLAW_PREVIEW_NAMESPACE", "xyne-apps")
CLAW_PREVIEW_DEFAULT_PORT = 6080

# Path mode for the editor: /claw-code/<sandboxId>/<rest> → code-server on the
# same sandbox. Same namespace as the preview (both are set from the chart's
# CLAW_PREVIEW_NAMESPACE), different port.
def _get_claw_code_port() -> int:
    raw = os.environ.get("CLAW_CODE_PORT")
    if raw is None:
        return 8443
    try:
        return int(raw)
    except (ValueError, TypeError):
        # Tolerated rather than fatal: this process also serves /claw-preview,
        # and a typo in one chart value should not crashloop the preview too.
        print(f"WARNING: Invalid CLAW_CODE_PORT='{raw}', falling back to 8443")
        return 8443


CLAW_CODE_DEFAULT_PORT = _get_claw_code_port()

# Per-user access gate for /claw-code. claw-auth answers "may this Spaces
# session open this sandbox?" from the ConversationArtifact owner rows that
# /webhook/progress writes. Unlike /claw-preview (a view of a browser),
# code-server hands out file read/write AND a shell in a pod that holds the
# workspace's GitHub SSH key, so this route is not left open.
#
# Empty CLAW_AUTH_URL disables the gate — that is the local/dev shape, where
# there is no claw-auth to ask. In the cluster the chart always sets it.
CLAW_AUTH_URL = os.environ.get("CLAW_AUTH_URL", "").rstrip("/")
SANDBOX_ACCESS_PATH = "/claw/api/v1/sandbox-access"
PUBLIC_ORIGINS = frozenset(
    o.strip().rstrip("/").lower()
    for o in os.environ.get("PUBLIC_ORIGINS", "").split(",")
    if o.strip()
)
# One /api/auth/me round trip per decision, so allow is cached for a minute:
# a cold VS Code load is ~100 asset requests. Deny is cached briefly too, or a
# denied tab's retries become a request amplifier against claw-auth.
ACCESS_ALLOW_TTL = 60.0
ACCESS_DENY_TTL = 5.0
ACCESS_CACHE_MAX = 1024
_access_cache: dict = {}
# One in-flight check per (sandbox, session). A cold workbench fires ~100 asset
# requests at once, and claw-auth's limiter counts them against the USER's
# 600/min bucket — the same one the dashboard's own API calls use. Without this
# fan-in, opening the editor could rate-limit the person out of Xyne.
_access_locks: dict = {}

# Never relayed into a sandbox: it runs agent-written code, so the caller's
# Spaces session cookie must not land anywhere the agent can read it. The gate
# is the only consumer of these, and code-server runs with --auth none.
STRIPPED_REQUEST_HEADERS = frozenset({"host", "origin", "referer", "cookie", "authorization"})

# Dropped from both directions: these describe a single hop and must not be
# relayed. transfer-encoding matters most — uvicorn frames the response itself,
# so forwarding upstream's "chunked" double-chunks the body.
HOP_BY_HOP = frozenset({
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade",
})

# Response headers a sandbox must not be able to set, because these routes are
# served on the dashboard's own origin and the sandbox serves whatever the agent
# wrote:
#   set-cookie             — cookies on the Spaces origin (session fixation,
#                            cookie tossing against the dashboard)
#   clear-site-data        — would sign the viewer out of Xyne
#   service-worker-allowed — would widen a worker's scope past /claw-*/ to the
#                            whole origin, which outlives the tab
# Neither websockify nor code-server (--auth none) emits any of them.
STRIPPED_RESPONSE_HEADERS = frozenset({
    "set-cookie", "clear-site-data", "service-worker-allowed",
})


def _get_proxy_timeout() -> float:
    raw = os.environ.get("PROXY_TIMEOUT_SECONDS")
    if raw is None:
        return DEFAULT_PROXY_TIMEOUT
    try:
        value = float(raw)
    except (ValueError, TypeError):
        print(f"WARNING: Invalid PROXY_TIMEOUT_SECONDS='{raw}', "
              f"falling back to {DEFAULT_PROXY_TIMEOUT}s")
        return DEFAULT_PROXY_TIMEOUT
    if value <= 0:
        print(f"WARNING: PROXY_TIMEOUT_SECONDS must be positive, got {value}, "
              f"falling back to {DEFAULT_PROXY_TIMEOUT}s")
        return DEFAULT_PROXY_TIMEOUT
    return value


proxy_timeout = _get_proxy_timeout()
client = httpx.AsyncClient(timeout=proxy_timeout)
# Separate client for the access gate: it sits in front of every editor
# request, so it gets a short timeout of its own instead of the proxy's. Longer
# than claw-auth's own 5s /api/auth/me budget, or a slow-but-working identity
# lookup would time out here and read as "gate unreachable".
access_client = httpx.AsyncClient(timeout=8.0)

print(f"Sandbox router (WS-capable) configured with proxy timeout: {proxy_timeout}s")
print(f"Sandbox router claw-code gate: {CLAW_AUTH_URL or 'DISABLED (no CLAW_AUTH_URL)'}")


def _split_sandbox_path(sandbox_path: str):
    """'<id>/rest' → ('<id>', 'rest'); '<id>' and '<id>/' → ('<id>', '')."""
    parts = sandbox_path.split("/", 1)
    return parts[0], (parts[1] if len(parts) > 1 else "")


def _valid_sandbox_id(sandbox_id: str) -> bool:
    return bool(sandbox_id) and sandbox_id.replace("-", "").isalnum()


_DEFAULT_PORTS = {"http": "80", "https": "443", "ws": "80", "wss": "443"}


def _normalize_netloc(netloc: str, scheme: str) -> str:
    netloc = netloc.strip().lower()
    default = _DEFAULT_PORTS.get(scheme)
    if default and netloc.endswith(f":{default}") and not netloc.endswith("]"):
        netloc = netloc[: -len(default) - 1]
    return netloc


def _first(value: str) -> str:
    return value.split(",", 1)[0].strip()


def _origin_allowed(headers, request_scheme: str) -> bool:
    origin = headers.get("origin", "").strip()
    if not origin or origin == "null":
        return False
    if origin.rstrip("/").lower() in PUBLIC_ORIGINS:
        return True
    try:
        parts = urlsplit(origin)
    except ValueError:
        return False
    if parts.scheme not in ("http", "https") or not parts.netloc:
        return False
    proto = _first(headers.get("x-forwarded-proto", "")).lower() or request_scheme
    if proto in ("https", "wss") and parts.scheme != "https":
        return False
    origin_netloc = _normalize_netloc(parts.netloc, parts.scheme)
    hosts = [_first(headers.get("x-forwarded-host", "")), headers.get("host", "")]
    return any(
        h and _normalize_netloc(h, parts.scheme) == origin_netloc for h in hosts
    )


def _deny_page(message: str) -> str:
    return (
        "<!doctype html><meta charset=utf-8><title>Sandbox editor</title>"
        "<style>body{font:14px/1.6 system-ui,sans-serif;margin:20vh auto;max-width:28rem;"
        "padding:0 1.5rem;color:#1f2328}</style>"
        f"<h1 style=font-size:1rem>Sandbox editor</h1><p>{message}</p>"
    )


def _prune_access_cache(now: float) -> None:
    for key in [k for (k, (expires, _)) in _access_cache.items() if expires <= now]:
        _access_cache.pop(key, None)
    if len(_access_cache) > ACCESS_CACHE_MAX:
        _access_cache.clear()


def _access_key(sandbox_id: str, cookie: str):
    return sandbox_id, hashlib.sha256(cookie.encode("utf-8", "replace")).hexdigest()


def _cached_access(key):
    entry = _access_cache.get(key)
    if not entry or entry[0] <= time.monotonic():
        return None
    allowed = entry[1]
    return allowed, (200 if allowed else 403), "cached"


async def _ask_claw_auth(key, sandbox_id: str, cookie: str, workspace_id: str):
    headers = {"cookie": cookie}
    if workspace_id:
        headers["x-workspace-id"] = workspace_id
    try:
        resp = await access_client.get(
            f"{CLAW_AUTH_URL}{SANDBOX_ACCESS_PATH}",
            params={"sandboxId": sandbox_id},
            headers=headers,
        )
    except Exception as e:
        print(f"[claw-code] access gate unreachable for '{sandbox_id}': {type(e).__name__}: {e}")
        return False, 503, "gate-unreachable"

    if resp.status_code in (200, 401, 403):
        allowed = resp.status_code == 200
        now = time.monotonic()
        _prune_access_cache(now)
        _access_cache[key] = (now + (ACCESS_ALLOW_TTL if allowed else ACCESS_DENY_TTL), allowed)
        return allowed, resp.status_code, f"claw-auth-{resp.status_code}"

    # 429 lands here too: claw-auth rate-limited us, which is a liveness answer
    # about the gate, not a verdict about the caller.
    print(f"[claw-code] access gate returned {resp.status_code} for '{sandbox_id}'")
    return False, 503, f"claw-auth-{resp.status_code}"


async def _claw_code_access(sandbox_id: str, cookie: str, workspace_id: str):
    """May the session behind `cookie` open this sandbox's editor?

    Returns (allowed, status, reason). Fails CLOSED: a claw-auth that cannot
    be reached yields 503, not an open editor. 401/403 are claw-auth's own
    answers and are relayed as-is so the browser can tell "log in" from
    "not your sandbox".
    """
    if not CLAW_AUTH_URL:
        return True, 200, "gate-disabled"
    if not cookie:
        return False, 401, "no-session"

    key = _access_key(sandbox_id, cookie)
    cached = _cached_access(key)
    if cached is not None:
        return cached

    lock = _access_locks.setdefault(key, asyncio.Lock())
    async with lock:
        # Whoever held the lock populated the cache while we queued.
        cached = _cached_access(key)
        if cached is not None:
            return cached
        try:
            return await _ask_claw_auth(key, sandbox_id, cookie, workspace_id)
        finally:
            _access_locks.pop(key, None)


async def _pump_ws(websocket: WebSocket, target: str, origin: str, label: str, sandbox_id: str):
    """Relay an accepted client WebSocket to `target` until either side closes."""
    await websocket.accept()

    # cookie and authorization join the hop-by-hop strips: the upstream is a
    # pod running agent-written code, and neither websockify nor code-server
    # (--auth none) reads them.
    skip = {b"host", b"connection", b"upgrade", b"origin",
            b"cookie", b"authorization",
            b"sec-websocket-key", b"sec-websocket-version",
            b"sec-websocket-extensions", b"sec-websocket-accept",
            b"sec-websocket-protocol"}
    forward_headers = [
        (k.decode("ascii", "replace"), v.decode("latin-1", "replace"))
        for (k, v) in websocket.headers.raw
        if k.lower() not in skip
    ]
    forward_headers.append(("Origin", origin))

    connect_kwargs = dict(max_size=None, ping_interval=None,
                          open_timeout=10, close_timeout=10)
    upstream_ctx = websockets.connect(
        target, extra_headers=forward_headers, **connect_kwargs)

    try:
        async with upstream_ctx as upstream:
            async def client_to_upstream():
                try:
                    while True:
                        msg = await websocket.receive()
                        if msg.get("type") == "websocket.disconnect":
                            return
                        if msg.get("bytes") is not None:
                            await upstream.send(msg["bytes"])
                        elif msg.get("text") is not None:
                            await upstream.send(msg["text"])
                except WebSocketDisconnect:
                    return
                except Exception as e:
                    print(f"[{label} WS] c2u error '{sandbox_id}': {e}")

            async def upstream_to_client():
                try:
                    async for frame in upstream:
                        if isinstance(frame, (bytes, bytearray)):
                            await websocket.send_bytes(bytes(frame))
                        else:
                            await websocket.send_text(frame)
                except websockets.ConnectionClosed:
                    return
                except Exception as e:
                    print(f"[{label} WS] u2c error '{sandbox_id}': {e}")

            await asyncio.gather(
                client_to_upstream(),
                upstream_to_client(),
                return_exceptions=True,
            )

    except websockets.InvalidHandshake as e:
        print(f"[{label} WS] upstream handshake failed '{sandbox_id}': {e}")
    except (OSError, asyncio.TimeoutError) as e:
        print(f"[{label} WS] upstream connect failed '{sandbox_id}': {e}")
    except Exception as e:
        print(f"[{label} WS] unexpected error '{sandbox_id}': {e}")
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


@app.get("/healthz")
async def health_check():
    return {"status": "ok"}


# ── /claw-preview/<sandboxId>/<rest> — human-driven preview via noVNC ──
# Registered BEFORE the catch-all proxy_request below so FastAPI matches
# this more-specific path first. The existing X-Sandbox-* header path
# (used by Playwright/MCP) is byte-identical to what shipped in v17.
@app.api_route(
    "/claw-preview/{sandbox_path:path}",
    methods=['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
)
async def proxy_claw_preview_http(request: Request, sandbox_path: str):
    parts = sandbox_path.split("/", 1)
    sandbox_id = parts[0]
    rest = parts[1] if len(parts) > 1 else ""

    if not sandbox_id:
        raise HTTPException(status_code=400, detail="claw-preview path requires a sandboxId")
    if not sandbox_id.replace("-", "").isalnum():
        raise HTTPException(status_code=400, detail="Invalid claw-preview sandboxId")

    # On the bare prefix (no path past sandboxId), redirect into vnc.html
    # with auto-connect so the user lands directly on the live screen.
    # websockify's --web mount has no index.html, so without this the user
    # would get a 404 and have to type /vnc.html themselves.
    if rest == "":
        # noVNC's `path` setting is anchored at host root (NOT relative to the
        # vnc.html URL), so we must override it explicitly. Default is just
        # "websockify" which would resolve to wss://host/websockify and fall
        # through to whatever else owns / on this domain — the dashboard, in
        # our case. Pass the full prefix so noVNC dials wss://host/claw-preview/<id>/websockify.
        #
        # quality=9 (max JPEG) + compression=0 (no zlib): trades ~3× bandwidth
        # for noticeably lower input-to-update latency — the zlib pass on
        # both client and server adds 5-15ms per frame which is the largest
        # client-side contribution.
        return RedirectResponse(
            url=(
                f"/claw-preview/{sandbox_id}/vnc.html"
                f"?autoconnect=true&resize=remote"
                f"&path=claw-preview/{sandbox_id}/websockify"
                f"&quality=9&compression=0"
            ),
            status_code=302,
        )

    namespace = CLAW_PREVIEW_NAMESPACE
    port = CLAW_PREVIEW_DEFAULT_PORT
    target_host = f"{sandbox_id}.{namespace}.svc.cluster.local"
    upstream_path = "/" + rest
    target_url = str(
        request.url.replace(
            scheme="http", hostname=target_host, port=port, path=upstream_path,
        )
    )

    print(f"[claw-preview] '{sandbox_id}' -> {target_url}")

    try:
        # cookie and authorization are dropped for the same reason as on the WS
        # leg and /claw-code: websockify reads neither, and the upstream is a pod
        # running agent-written code.
        headers = {
            k: v for (k, v) in request.headers.items()
            if k.lower() not in ("host", "cookie", "authorization")
        }
        # Same loopback-Host trick as proxy_request — keeps DNS-rebinding
        # checks happy on anything served behind 127.0.0.1.
        headers["host"] = f"127.0.0.1:{port}"

        req = client.build_request(
            method=request.method,
            url=target_url,
            headers=headers,
            content=await request.body(),
        )
        resp = await client.send(req, stream=True)
        return StreamingResponse(
            content=resp.aiter_bytes(),
            status_code=resp.status_code,
            headers={
                k: v for (k, v) in resp.headers.items()
                if k.lower() not in STRIPPED_RESPONSE_HEADERS
            },
        )
    except httpx.ConnectError as e:
        print(f"ERROR: claw-preview connect to {target_url} failed: {e}")
        raise HTTPException(
            status_code=502, detail=f"Could not reach sandbox {sandbox_id}",
        )
    except Exception as e:
        print(f"ERROR: claw-preview unexpected {type(e).__name__}: {e}")
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Internal error in claw-preview proxy: {type(e).__name__}: {e}",
        )


@app.websocket("/claw-preview/{sandbox_path:path}")
async def proxy_claw_preview_ws(websocket: WebSocket, sandbox_path: str):
    sandbox_id, rest = _split_sandbox_path(sandbox_path)

    if not _valid_sandbox_id(sandbox_id):
        await websocket.close(code=1008, reason="invalid claw-preview sandboxId")
        return

    namespace = CLAW_PREVIEW_NAMESPACE
    port = CLAW_PREVIEW_DEFAULT_PORT
    target_host = f"{sandbox_id}.{namespace}.svc.cluster.local"

    upstream_path = "/" + rest
    if websocket.url.query:
        upstream_path += f"?{websocket.url.query}"
    target = f"ws://{target_host}:{port}{upstream_path}"

    print(f"[claw-preview WS] '{sandbox_id}' -> {target}")
    # Mirror header-mode's loopback-Origin spoof. websockify doesn't enforce
    # Origin by default but matching the rest of the router's posture costs
    # nothing.
    await _pump_ws(websocket, target, f"http://127.0.0.1:{port}", "claw-preview", sandbox_id)


# ── /claw-code/<sandboxId>/<rest> — the editor, code-server on 8443 ──
# Registered before the catch-all for the same reason as claw-preview.
@app.api_route(
    "/claw-code/{sandbox_path:path}",
    methods=['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'DELETE', 'PATCH'],
)
async def proxy_claw_code_http(request: Request, sandbox_path: str):
    sandbox_id, rest = _split_sandbox_path(sandbox_path)

    if not sandbox_id:
        raise HTTPException(status_code=400, detail="claw-code path requires a sandboxId")
    if not _valid_sandbox_id(sandbox_id):
        raise HTTPException(status_code=400, detail="Invalid claw-code sandboxId")
    if "origin" in request.headers and not _origin_allowed(request.headers, request.url.scheme):
        print(f"[claw-code] deny '{sandbox_id}' (cross-origin {request.headers.get('origin')!r})")
        raise HTTPException(status_code=403, detail="Cross-origin request refused")

    # code-server builds its asset URLs relative to the CURRENT directory, so
    # on /claw-code/<id> the workbench dials /claw-code/<asset> — one level too
    # high — and every asset 404s. Land the user on the slashed form first.
    # Keyed off the raw path, not `rest`: /claw-code/<id>/ also parses to
    # rest == "" and redirecting that would loop.
    if "/" not in sandbox_path:
        target = f"/claw-code/{sandbox_id}/"
        if request.url.query:
            target += f"?{request.url.query}"
        return RedirectResponse(url=target, status_code=302)

    allowed, status, reason = await _claw_code_access(
        sandbox_id,
        request.headers.get("cookie", ""),
        request.headers.get("x-workspace-id", ""),
    )
    if not allowed:
        print(f"[claw-code] deny '{sandbox_id}' ({reason})")
        message = {
            401: "Sign in to Xyne in this browser, then reload this page.",
            403: "This sandbox belongs to a conversation you cannot open.",
        }.get(status, "Xyne could not check who you are. Try again in a moment.")
        # This route is reached by navigation, so a refusal has to be readable:
        # the desktop app hands the link to the system browser, which may not
        # carry a Spaces session at all.
        if "text/html" in request.headers.get("accept", ""):
            return HTMLResponse(_deny_page(message), status_code=status)
        raise HTTPException(status_code=status, detail=message)

    namespace = CLAW_PREVIEW_NAMESPACE
    port = CLAW_CODE_DEFAULT_PORT
    target_host = f"{sandbox_id}.{namespace}.svc.cluster.local"
    upstream_path = "/" + rest
    target_url = str(
        request.url.replace(
            scheme="http", hostname=target_host, port=port, path=upstream_path,
        )
    )

    print(f"[claw-code] '{sandbox_id}' -> {target_url}")

    try:
        headers = {
            k: v for (k, v) in request.headers.items()
            if k.lower() not in HOP_BY_HOP and k.lower() not in STRIPPED_REQUEST_HEADERS
        }
        # code-server refuses a request whose Origin host differs from its Host
        # (its DNS-rebinding guard), and it is the Host we rewrite. So both are
        # set to the upstream's own address rather than claw-preview's 127.0.0.1
        # spoof — the WS leg below cannot override Host, and the two must agree.
        headers["host"] = f"{target_host}:{port}"
        headers["origin"] = f"http://{target_host}:{port}"

        req = client.build_request(
            method=request.method,
            url=target_url,
            headers=headers,
            content=await request.body(),
        )
        resp = await client.send(req, stream=True)

        # aiter_raw, NOT aiter_bytes: httpx decompresses on aiter_bytes while
        # content-encoding is relayed verbatim, and code-server gzips — the
        # browser would try to gunzip plain bytes. Raw keeps body and headers
        # consistent.
        resp_headers = {
            k: v for (k, v) in resp.headers.items()
            if k.lower() not in HOP_BY_HOP and k.lower() not in STRIPPED_RESPONSE_HEADERS
        }
        # Any absolute redirect upstream emits points at the in-cluster host,
        # which the browser cannot resolve. Put it back under our prefix.
        location = resp_headers.get("location")
        if location and location.startswith(f"http://{target_host}:{port}"):
            resp_headers["location"] = (
                f"/claw-code/{sandbox_id}" + location[len(f"http://{target_host}:{port}"):]
            )

        return StreamingResponse(
            content=resp.aiter_raw(),
            status_code=resp.status_code,
            headers=resp_headers,
        )
    except httpx.ConnectError as e:
        print(f"ERROR: claw-code connect to {target_url} failed: {e}")
        raise HTTPException(
            status_code=502, detail=f"Could not reach sandbox {sandbox_id}",
        )
    except Exception as e:
        print(f"ERROR: claw-code unexpected {type(e).__name__}: {e}")
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail=f"Internal error in claw-code proxy: {type(e).__name__}: {e}",
        )


@app.websocket("/claw-code/{sandbox_path:path}")
async def proxy_claw_code_ws(websocket: WebSocket, sandbox_path: str):
    sandbox_id, rest = _split_sandbox_path(sandbox_path)

    if not _valid_sandbox_id(sandbox_id):
        await websocket.close(code=1008, reason="invalid claw-code sandboxId")
        return
    if not _origin_allowed(websocket.headers, websocket.url.scheme):
        print(f"[claw-code WS] deny '{sandbox_id}' (origin {websocket.headers.get('origin')!r})")
        await websocket.close(code=1008, reason="cross-origin")
        return

    allowed, _status, reason = await _claw_code_access(
        sandbox_id,
        websocket.headers.get("cookie", ""),
        websocket.headers.get("x-workspace-id", ""),
    )
    if not allowed:
        print(f"[claw-code WS] deny '{sandbox_id}' ({reason})")
        await websocket.close(code=1008, reason="forbidden")
        return

    namespace = CLAW_PREVIEW_NAMESPACE
    port = CLAW_CODE_DEFAULT_PORT
    target_host = f"{sandbox_id}.{namespace}.svc.cluster.local"

    upstream_path = "/" + rest
    if websocket.url.query:
        upstream_path += f"?{websocket.url.query}"
    target = f"ws://{target_host}:{port}{upstream_path}"

    print(f"[claw-code WS] '{sandbox_id}' -> {target}")
    # Origin must match the Host `websockets` derives from the URI, or
    # code-server rejects the upgrade.
    await _pump_ws(websocket, target, f"http://{target_host}:{port}", "claw-code", sandbox_id)


@app.api_route("/{full_path:path}", methods=['GET', 'POST', 'PUT', 'DELETE', 'PATCH'])
async def proxy_request(request: Request, full_path: str):
    sandbox_id = request.headers.get("X-Sandbox-ID")
    if not sandbox_id:
        raise HTTPException(status_code=400, detail="X-Sandbox-ID header is required.")

    namespace = request.headers.get("X-Sandbox-Namespace", DEFAULT_NAMESPACE)
    if not namespace.replace("-", "").isalnum():
        raise HTTPException(status_code=400, detail="Invalid namespace format.")

    try:
        port = int(request.headers.get("X-Sandbox-Port", DEFAULT_SANDBOX_PORT))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid port format.")

    target_host = f"{sandbox_id}.{namespace}.svc.cluster.local"
    target_url = str(
        request.url.replace(scheme="http", hostname=target_host, port=port)
    )

    print(f"Proxying request for sandbox '{sandbox_id}' to URL: {target_url}")

    try:
        headers = {key: value for (key, value) in request.headers.items() if key.lower() != 'host'}
        # Override Host so the upstream sees a "loopback-shaped" hostname.
        # Reason: Chrome DevTools (CDP) refuses HTTP requests whose Host
        # isn't localhost or an IP (DNS-rebinding protection). httpx would
        # otherwise auto-generate Host=<pod-fqdn>:<port> from the target URL.
        # Setting Host=127.0.0.1:<port> is also accepted by Vite's
        # server.allowedHosts default (loopback always allowed) and is a
        # no-op for services that don't care about Host (workspace server,
        # nix process-compose dashboards, etc.).
        headers["host"] = f"127.0.0.1:{port}"

        req = client.build_request(
            method=request.method,
            url=target_url,
            headers=headers,
            content=await request.body(),
        )

        resp = await client.send(req, stream=True)

        # CDP-discovery rewrite. Chromium's /json/version + /json + /json/list
        # endpoints embed the URL the upstream sees ITSELF as in the
        # `webSocketDebuggerUrl` field of the returned JSON. Since we rewrite
        # the upstream Host to "127.0.0.1:<port>" (DNS-rebinding workaround
        # above), chromium reports `ws://127.0.0.1:<port>/devtools/...`.
        # Playwright clients parse that URL and connect directly — but
        # 127.0.0.1 from the client's perspective is its own pod, not the
        # sandbox. So we have to swap the URL back to the client-facing
        # address (this router) before returning. We keep the path so the
        # router's @app.websocket route picks it up on the subsequent WS
        # upgrade and forwards (with the same X-Sandbox-* headers the client
        # supplied — playwright-mcp's --cdp-header propagates them to both
        # discovery and WS).
        path_normalized = full_path.rstrip("/")
        is_cdp_discovery = path_normalized in ("json/version", "json", "json/list")
        if is_cdp_discovery and resp.status_code == 200:
            body = await resp.aread()
            try:
                # Use the client's view of us as the new prefix. request.url.netloc
                # is e.g. "sandbox-router-test-svc:8080" — exactly what the client
                # used to reach us, so any subsequent ws:// URL parsed from this
                # response will hit us too.
                client_netloc = request.url.netloc
                inner_prefix = f"ws://127.0.0.1:{port}"
                outer_prefix = f"ws://{client_netloc}"
                text = body.decode("utf-8", errors="replace")
                rewritten = text.replace(inner_prefix, outer_prefix)
                # Also handle the localhost variant chromium sometimes reports.
                rewritten = rewritten.replace(
                    f"ws://localhost:{port}", outer_prefix
                )
                # Drop content-length so FastAPI/uvicorn computes the new one.
                resp_headers = {
                    k: v for (k, v) in resp.headers.items()
                    if k.lower() not in ("content-length", "transfer-encoding")
                }
                return StreamingResponse(
                    content=iter([rewritten.encode("utf-8")]),
                    status_code=resp.status_code,
                    headers=resp_headers,
                )
            except Exception as e:
                print(f"WARN: failed to rewrite CDP discovery response: {e}")
                # Fall through to passthrough below.

        return StreamingResponse(
            content=resp.aiter_bytes(),
            status_code=resp.status_code,
            headers=resp.headers,
        )
    except httpx.ConnectError as e:
        print(f"ERROR: Connection to sandbox at {target_url} failed. Error: {e}")
        raise HTTPException(
            status_code=502, detail=f"Could not connect to the backend sandbox: {sandbox_id}")
    except Exception as e:
        print(f"An unexpected error occurred for {target_url}: {type(e).__name__}: {e}")
        traceback.print_exc()
        raise HTTPException(
            status_code=500, detail=f"An internal error occurred in the proxy: {type(e).__name__}: {e}")


# WS upgrades go through Starlette's separate websocket router and don't
# conflict with the HTTP catch-all above. Same X-Sandbox-* header contract.
@app.websocket("/{full_path:path}")
async def proxy_websocket(websocket: WebSocket, full_path: str):
    sandbox_id = websocket.headers.get("X-Sandbox-ID")
    if not sandbox_id:
        await websocket.close(code=1008, reason="X-Sandbox-ID required")
        return

    namespace = websocket.headers.get("X-Sandbox-Namespace", DEFAULT_NAMESPACE)
    if not namespace.replace("-", "").isalnum():
        await websocket.close(code=1008, reason="invalid namespace")
        return

    try:
        port = int(websocket.headers.get("X-Sandbox-Port", DEFAULT_SANDBOX_PORT))
    except ValueError:
        await websocket.close(code=1008, reason="invalid port")
        return

    target_host = f"{sandbox_id}.{namespace}.svc.cluster.local"
    path = "/" + full_path
    if websocket.url.query:
        path += f"?{websocket.url.query}"
    target = f"ws://{target_host}:{port}{path}"

    print(f"WS proxy '{sandbox_id}' -> {target}")
    await websocket.accept()

    # Strip hop-by-hop, WS-handshake, and Origin headers; the websockets
    # library will generate fresh handshake headers, and we override
    # Origin below so chromium's DNS-rebinding-origin check accepts it.
    skip = {b"host", b"connection", b"upgrade", b"origin",
            b"sec-websocket-key", b"sec-websocket-version",
            b"sec-websocket-extensions", b"sec-websocket-accept",
            b"sec-websocket-protocol"}
    forward_headers = [
        (k.decode("ascii", "replace"), v.decode("latin-1", "replace"))
        for (k, v) in websocket.headers.raw
        if k.lower() not in skip
    ]
    # Force Origin to a loopback value. Chromium with --remote-allow-origins
    # set will accept this; without overriding, Origin from the proxied
    # client (or absent) would fail chromium's CDP origin check.
    forward_headers.append(("Origin", f"http://127.0.0.1:{port}"))

    connect_kwargs = dict(max_size=None, ping_interval=None,
                          open_timeout=10, close_timeout=10)
    # websockets 12.x still uses `extra_headers`; the rename to
    # `additional_headers` happened in 13. Stick with `extra_headers`
    # here since the requirements pin is 12. NOTE: the earlier
    # try-additional-then-fallback pattern doesn't work because the
    # TypeError is raised inside `__aenter__` (when create_connection
    # is invoked), not at the websockets.connect() call itself.
    upstream_ctx = websockets.connect(
        target, extra_headers=forward_headers, **connect_kwargs)

    try:
        async with upstream_ctx as upstream:

            async def client_to_upstream():
                try:
                    while True:
                        msg = await websocket.receive()
                        if msg.get("type") == "websocket.disconnect":
                            return
                        if msg.get("bytes") is not None:
                            await upstream.send(msg["bytes"])
                        elif msg.get("text") is not None:
                            await upstream.send(msg["text"])
                except WebSocketDisconnect:
                    return
                except Exception as e:
                    print(f"WS c2u error for {sandbox_id}: {e}")

            async def upstream_to_client():
                try:
                    async for frame in upstream:
                        if isinstance(frame, (bytes, bytearray)):
                            await websocket.send_bytes(bytes(frame))
                        else:
                            await websocket.send_text(frame)
                except websockets.ConnectionClosed:
                    return
                except Exception as e:
                    print(f"WS u2c error for {sandbox_id}: {e}")

            await asyncio.gather(
                client_to_upstream(),
                upstream_to_client(),
                return_exceptions=True,
            )

    except websockets.InvalidHandshake as e:
        print(f"WS upstream handshake failed for {sandbox_id}: {e}")
    except (OSError, asyncio.TimeoutError) as e:
        print(f"WS upstream connect failed for {sandbox_id}: {e}")
    except Exception as e:
        print(f"WS proxy unexpected error for {sandbox_id}: {e}")
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
