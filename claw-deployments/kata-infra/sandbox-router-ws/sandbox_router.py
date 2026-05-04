# Forked from upstream kubernetes-sigs/agent-sandbox sandbox_router.py
# (clients/python/agentic-sandbox-client/sandbox-router/sandbox_router.py)
# with a new @app.websocket("/{full_path:path}") proxy route added so that
# Chromium-CDP / Playwright-MCP / any other WS protocol can be routed
# through the same X-Sandbox-* header contract that HTTP already uses.

import asyncio
import os
import traceback

import httpx
import websockets
from fastapi import FastAPI, Request, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse, RedirectResponse

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
CLAW_PREVIEW_NAMESPACE = "xyne-apps"
CLAW_PREVIEW_DEFAULT_PORT = 6080


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

print(f"Sandbox router (WS-capable) configured with proxy timeout: {proxy_timeout}s")


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
        headers = {k: v for (k, v) in request.headers.items() if k.lower() != 'host'}
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
            headers=resp.headers,
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
    parts = sandbox_path.split("/", 1)
    sandbox_id = parts[0]
    rest = parts[1] if len(parts) > 1 else ""

    if not sandbox_id or not sandbox_id.replace("-", "").isalnum():
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
    await websocket.accept()

    skip = {b"host", b"connection", b"upgrade", b"origin",
            b"sec-websocket-key", b"sec-websocket-version",
            b"sec-websocket-extensions", b"sec-websocket-accept",
            b"sec-websocket-protocol"}
    forward_headers = [
        (k.decode("ascii", "replace"), v.decode("latin-1", "replace"))
        for (k, v) in websocket.headers.raw
        if k.lower() not in skip
    ]
    # Mirror header-mode's loopback-Origin spoof. websockify doesn't enforce
    # Origin by default but matching the rest of the router's posture costs
    # nothing.
    forward_headers.append(("Origin", f"http://127.0.0.1:{port}"))

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
                    print(f"[claw-preview WS] c2u error '{sandbox_id}': {e}")

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
                    print(f"[claw-preview WS] u2c error '{sandbox_id}': {e}")

            await asyncio.gather(
                client_to_upstream(),
                upstream_to_client(),
                return_exceptions=True,
            )

    except websockets.InvalidHandshake as e:
        print(f"[claw-preview WS] upstream handshake failed '{sandbox_id}': {e}")
    except (OSError, asyncio.TimeoutError) as e:
        print(f"[claw-preview WS] upstream connect failed '{sandbox_id}': {e}")
    except Exception as e:
        print(f"[claw-preview WS] unexpected error '{sandbox_id}': {e}")
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


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
