/**
 * Local HTTP proxy for GitHub Copilot API.
 *
 * GitHub Copilot's OpenAI-compatible API requires headers that
 * pi-coding-agent can't inject. This proxy runs locally, buffers
 * each request body to determine the correct x-initiator value
 * (matching OpenCode's CopilotAuthPlugin logic), then forwards
 * to https://api.githubcopilot.com with the required headers.
 *
 * Key headers (per OpenCode):
 *   Authorization: Bearer <github_oauth_token>
 *   User-Agent: opencode/<version>
 *   Openai-Intent: conversation-edits
 *   x-initiator: "user" (last msg role=user) | "agent" (tool turns)
 *
 * The GitHub OAuth access_token (from device-code flow with read:user scope)
 * is sent directly as the Bearer — opencode does the same. GitHub's edge
 * derives session-scoped tokens server-side; we don't run our own
 * /copilot_internal/v2/token exchange (that endpoint 404s for the OAuth
 * scopes we have anyway).
 *
 * If a request returns 401 with "authentication token is expired", the
 * user's OAuth token itself has been revoked/expired (e.g. they re-logged in
 * elsewhere) and they need to re-authenticate. We surface that error rather
 * than papering over it.
 */

import * as http from "node:http";
import * as https from "node:https";
import * as net from "node:net";

import { createLogger } from "./logger.js";
const log = createLogger("copilot-proxy");

const TARGET_HOST = "api.githubcopilot.com";

/**
 * x-initiator logic (matches OpenCode):
 * - "user"  → fresh first-turn message (no prior assistant turns yet)
 * - "agent" → tool result processing, continued sessions, thread replies
 *
 * Thread replies resume a session that already has assistant messages, so
 * they get "agent" automatically — Copilot won't count them as user usage.
 */
function getXInitiator(rawBody: Buffer): string {
  try {
    const body = JSON.parse(rawBody.toString()) as {
      messages?: Array<{ role: string }>;
    };
    const messages = body.messages;
    if (Array.isArray(messages) && messages.length > 0) {
      const last = messages[messages.length - 1];
      const hasAssistantTurn = messages.some((m) => m.role === "assistant");
      // Only mark as "user" for the very first user message in a fresh session
      if (last?.role === "user" && !hasAssistantTurn) return "user";
    }
  } catch { /* non-JSON */ }
  return "agent";
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.listen(0, () => {
      const addr = srv.address() as net.AddressInfo;
      srv.close((err) => (err ? reject(err) : resolve(addr.port)));
    });
  });
}


async function startCopilotProxy(githubToken: string): Promise<{
  url: string;
  close: () => void;
}> {
  const port = await getFreePort();

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const rawBody = Buffer.concat(chunks);
      const xInitiator = getXInitiator(rawBody);
      log.info(`[copilot-proxy] ${req.method} ${req.url} requestSize=${rawBody.length} bytes (x-initiator=${xInitiator})`);

      const outHeaders: Record<string, string | string[]> = {
        ...(req.headers as Record<string, string | string[]>),
        host: TARGET_HOST,
        "authorization": `Bearer ${githubToken}`,
        "User-Agent": "opencode/0.3.118",
        "Openai-Intent": "conversation-edits",
        "x-initiator": xInitiator,
      };
      delete outHeaders["proxy-connection"];
      delete outHeaders["connection"];
      delete outHeaders["transfer-encoding"];
      delete outHeaders["x-api-key"];

      const proxyReq = https.request(
        { hostname: TARGET_HOST, port: 443, path: req.url, method: req.method, headers: outHeaders },
        (proxyRes) => {
          if ((proxyRes.statusCode ?? 200) >= 400) {
            // Buffer error body so we can log it
            const errChunks: Buffer[] = [];
            proxyRes.on("data", (c: Buffer) => errChunks.push(c));
            proxyRes.on("end", () => {
              const errBody = Buffer.concat(errChunks);
              const status = proxyRes.statusCode ?? 502;
              log.error(`[copilot-proxy] ${req.method} ${req.url} → ${status} body=${errBody.toString().slice(0, 500)}`);
              // Copilot returns 429 with an opaque body ("quota exceeded") when
              // the user's subscription is out of quota. The downstream
              // quota-fallback (run.ts) classifies by string-matching the SDK
              // error, so rewrite the body into a canonical, always-matched
              // Anthropic-shaped error carrying the literal tokens
              // isQuotaExhaustedError keys on ("429", "quota_exceeded",
              // "rate_limit_exceeded"). Without this a personal-Copilot quota
              // 429 fell through unclassified and the run was dropped with no
              // reply (prod 2026-06-11, @infra-doctor). The TTL/headers are
              // replaced with JSON so the SDK parses it as a normal API error.
              if (status === 429) {
                const original = errBody.toString().slice(0, 200).replace(/\s+/g, " ").trim();
                const canonical = JSON.stringify({
                  type: "error",
                  error: {
                    type: "rate_limit_error",
                    message: `GitHub Copilot quota exceeded — HTTP 429 quota_exceeded / rate_limit_exceeded. Upstream: ${original}`,
                  },
                });
                const headers = { ...proxyRes.headers, "content-type": "application/json" };
                delete headers["content-length"];
                delete headers["content-encoding"];
                res.writeHead(429, headers);
                res.end(canonical);
                return;
              }
              res.writeHead(status, proxyRes.headers);
              res.end(errBody);
            });
          } else {
            log.info(`[copilot-proxy] ${req.method} ${req.url} → ${proxyRes.statusCode} (x-initiator=${xInitiator})`);
            res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
            proxyRes.pipe(res, { end: true });
          }
        },
      );

      proxyReq.on("error", (err) => {
        log.error(`[copilot-proxy] upstream error: ${err.message}`);
        if (!res.headersSent) {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { message: err.message, type: "proxy_error" } }));
        }
      });

      proxyReq.end(rawBody);
    });

    req.on("error", (err) => {
      log.error(`[copilot-proxy] request error: ${err.message}`);
      if (!res.headersSent) { res.statusCode = 400; res.end(); }
    });
  });

  await new Promise<void>((resolve, reject) =>
    server.listen(port, "127.0.0.1", resolve).once("error", reject),
  );

  log.info(`[copilot-proxy] Listening on http://127.0.0.1:${port} → https://${TARGET_HOST}`);
  return { url: `http://127.0.0.1:${port}`, close: () => server.close() };
}

// Cache: githubToken → proxy. Each entry is a live local HTTP server. Tokens
// rotate, so without eviction the old token's proxy leaks a port/listener for
// the whole process lifetime. We evict on an idle-TTL (not a count cap, which
// could close a proxy mid-run): an active run touches its entry at start, while
// a rotated/abandoned token's proxy goes untouched and is swept. The TTL
// defaults well above any normal run length so an in-flight run is never cut.
const PROXY_IDLE_TTL_MS = Number(process.env["XYNE_CLAW_COPILOT_PROXY_TTL_MS"] ?? 60 * 60 * 1000);
const proxyCache = new Map<string, { url: string; close: () => void; lastUsed: number }>();

function sweepIdleProxies(now: number): void {
  for (const [token, p] of proxyCache) {
    if (now - p.lastUsed > PROXY_IDLE_TTL_MS) {
      proxyCache.delete(token);
      try { p.close(); } catch { /* best-effort */ }
    }
  }
}

export async function getOrCreateCopilotProxy(githubToken: string): Promise<string> {
  const now = Date.now();
  sweepIdleProxies(now); // lazy — piggybacks on calls, no background timer
  const cached = proxyCache.get(githubToken);
  if (cached) {
    cached.lastUsed = now;
    return cached.url;
  }
  const proxy = await startCopilotProxy(githubToken);
  proxyCache.set(githubToken, { ...proxy, lastUsed: now });
  return proxy.url;
}
