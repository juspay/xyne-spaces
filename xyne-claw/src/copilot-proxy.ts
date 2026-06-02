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
      console.log(`[copilot-proxy] ${req.method} ${req.url} requestSize=${rawBody.length} bytes (x-initiator=${xInitiator})`);

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
              console.error(`[copilot-proxy] ${req.method} ${req.url} → ${proxyRes.statusCode} body=${errBody.toString().slice(0, 500)}`);
              res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
              res.end(errBody);
            });
          } else {
            console.log(`[copilot-proxy] ${req.method} ${req.url} → ${proxyRes.statusCode} (x-initiator=${xInitiator})`);
            res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
            proxyRes.pipe(res, { end: true });
          }
        },
      );

      proxyReq.on("error", (err) => {
        console.error(`[copilot-proxy] upstream error: ${err.message}`);
        if (!res.headersSent) {
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { message: err.message, type: "proxy_error" } }));
        }
      });

      proxyReq.end(rawBody);
    });

    req.on("error", (err) => {
      console.error(`[copilot-proxy] request error: ${err.message}`);
      if (!res.headersSent) { res.statusCode = 400; res.end(); }
    });
  });

  await new Promise<void>((resolve, reject) =>
    server.listen(port, "127.0.0.1", resolve).once("error", reject),
  );

  console.log(`[copilot-proxy] Listening on http://127.0.0.1:${port} → https://${TARGET_HOST}`);
  return { url: `http://127.0.0.1:${port}`, close: () => server.close() };
}

// Cache: githubToken → proxy — starts once, lives for the process lifetime
const proxyCache = new Map<string, { url: string; close: () => void }>();

export async function getOrCreateCopilotProxy(githubToken: string): Promise<string> {
  const cached = proxyCache.get(githubToken);
  if (cached) return cached.url;
  const proxy = await startCopilotProxy(githubToken);
  proxyCache.set(githubToken, proxy);
  return proxy.url;
}
