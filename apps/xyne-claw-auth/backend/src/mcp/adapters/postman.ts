import type { McpToolInfo } from "../types.js";
import { createLogger } from "../../logger.js";
import { assertSafeOutboundUrl } from "../../mcpgateway/services/http-client.js";

const log = createLogger("postman-custom");

/**
 * ── Custom Postman tools (handled locally, not forwarded to the MCP server) ──
 *
 * The upstream Postman MCP server does not expose an on-demand `runMonitor`
 * tool. We bolt it on the same way Bitbucket's
 * `upload-pr-screenshot` / `get-pr-comments` are added: declare the tool specs
 * in POSTMAN_CUSTOM_TOOLS (merged into the `postman` connector's listed tools
 * by CUSTOM_TOOL_INJECTIONS in routes/mcp.ts) and intercept the call in
 * /mcp/call, dispatching to the handlers below instead of the vendor MCP.
 *
 * The handler authenticates with the SAME Postman API key the user already
 * configured on the Postman connection — we read it from the resolved
 * `credentials` bag. The Postman connector is a runtime DB row (no static
 * adapter / seed), so the exact credential field name isn't visible in code;
 * `resolveApiKey` therefore checks the common candidates. If the real field is
 * something else, add it to API_KEY_FIELDS.
 *
 * NOTE: collection EXECUTION (Newman) is intentionally NOT here. Running a
 * collection is code-execution + network egress and must not run in
 * claw-auth next to our secrets. It lives in the sandbox as the
 * `postman_sbx` tool (xyne-claw-shared/src/tools/postman-sbx). This adapter
 * keeps only the credential-bearing Postman *API* surface (runMonitor).
 */

// Candidate credential-field names the Postman API key may be stored under on
// the connection row. Ordered by likelihood. Extend if the connector uses a
// different key.
const API_KEY_FIELDS = ["apiKey", "apikey", "token", "POSTMAN_API_KEY", "postmanApiKey", "X-Api-Key"] as const;

function resolveApiKey(credentials: Record<string, unknown>): string {
  for (const field of API_KEY_FIELDS) {
    const v = credentials[field];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  throw new Error(
    `Postman API key not found on the connection credentials (looked for: ${API_KEY_FIELDS.join(", ")}). ` +
      `Reconnect the Postman integration or add its credential field name to API_KEY_FIELDS.`,
  );
}

function resolveBaseUrl(credentials: Record<string, unknown>): string {
  const raw = credentials["baseUrl"];
  const base = typeof raw === "string" && raw.trim() ? raw.trim() : "https://api.getpostman.com";
  return base.replace(/\/+$/, "");
}

// ── Tool specs ──────────────────────────────────────────────────────────────

export const POSTMAN_CUSTOM_TOOLS: McpToolInfo[] = [
  {
    name: "runMonitor",
    description:
      "Run an existing Postman monitor on demand. Calls the Postman API " +
      "(POST /monitors/{monitorId}/run). By default the run is dispatched asynchronously " +
      "and returns immediately (monitor runs can take several minutes and would otherwise " +
      "block on the tool-call timeout). Set `wait=true` to run synchronously and return the " +
      "full run result (only for short monitors).",
    inputSchema: {
      type: "object",
      properties: {
        monitorId: { type: "string", description: "The Postman monitor UID (e.g. 12345678-abcd-...)." },
        wait: {
          type: "boolean",
          description:
            "If true, run synchronously and wait for the result. Default false (dispatch async, return immediately).",
        },
      },
      required: ["monitorId"],
    },
  },
];

// ── runMonitor ────────────────────────────────────────────────────────────

interface MonitorRunResponse {
  run?: Record<string, unknown>;
  [k: string]: unknown;
}

export async function handleRunMonitor(
  credentials: Record<string, unknown>,
  params: Record<string, unknown>,
): Promise<string> {
  const apiKey = resolveApiKey(credentials);
  const baseUrl = resolveBaseUrl(credentials);

  const monitorId = params["monitorId"];
  if (typeof monitorId !== "string" || !monitorId.trim()) {
    throw new Error("runMonitor: monitorId is required");
  }
  const wait = params["wait"] === true;

  // async=true dispatches the run and returns immediately; omit it to run sync.
  const url = `${baseUrl}/monitors/${encodeURIComponent(monitorId.trim())}/run${wait ? "" : "?async=true"}`;

  // baseUrl is a user-stored credential; refuse internal / private / metadata
  // destinations before sending the API key.
  await assertSafeOutboundUrl(url);
  const res = await fetch(url, {
    method: "POST",
    headers: { "X-Api-Key": apiKey, Accept: "application/json" },
    // Sync monitor runs can take minutes; async returns fast. Cap sync waits so
    // we never exceed the MCP request timeout.
    signal: AbortSignal.timeout(wait ? 290_000 : 30_000),
  });

  const bodyText = await res.text().catch(() => "");
  if (!res.ok) {
    log.warn(`[postman] runMonitor ${monitorId} failed (${res.status})`);
    throw new Error(`Postman runMonitor failed (${res.status}): ${bodyText.slice(0, 400)}`);
  }

  let parsed: MonitorRunResponse | undefined;
  try {
    parsed = JSON.parse(bodyText) as MonitorRunResponse;
  } catch {
    parsed = undefined;
  }

  if (!wait) {
    return JSON.stringify(
      {
        dispatched: true,
        monitorId,
        message: "Monitor run dispatched asynchronously. Check the Postman dashboard for results.",
        response: parsed ?? bodyText.slice(0, 800),
      },
      null,
      2,
    );
  }
  return JSON.stringify({ dispatched: true, monitorId, run: parsed?.run ?? parsed ?? bodyText.slice(0, 4000) }, null, 2);
}
