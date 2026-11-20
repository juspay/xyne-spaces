/** Client of the MCP service at CLAW_MCP_URL, signing requests with claw-auth's key. */
import {
  createMcpServiceClient,
  McpServiceError,
  type McpCallResult,
  type McpServiceClient,
  type McpSessionRef,
} from "xyne-claw-mcp-common/client";
import { MCP_REQUEST_TIMEOUT_MS, MCP_SERVICE_NAME } from "xyne-claw-mcp-common/protocol";
import { CONFIG } from "../config.js";
import { errMsg } from "../lib/errors.js";
import { internalFetch } from "../lib/safe-fetch.js";
import { signServiceAssertion } from "../lib/service-assertion.js";
import { createLogger } from "../logger.js";

export { McpServiceError };
export type { McpSessionRef };
export type McpCallRaw = McpCallResult;
export type McpExecutor = McpServiceClient;

const log = createLogger("mcp-executor");

const MAX_RESPONSE_BYTES = Number(process.env["CLAW_MCP_MAX_RESPONSE_BYTES"] ?? 50 * 1024 * 1024);

/** True when CLAW_MCP_URL is set. */
export function mcpServiceConfigured(): boolean {
  return CONFIG.clawMcpUrl !== "";
}

let cached: { baseUrl: string; client: McpServiceClient } | null = null;

export function mcpExecutor(): McpExecutor {
  const baseUrl = CONFIG.clawMcpUrl;
  if (!baseUrl) {
    throw new McpServiceError("MCP servers are unavailable: CLAW_MCP_URL is not set", "not-configured", 503);
  }
  if (cached?.baseUrl === baseUrl) return cached.client;
  const client = createMcpServiceClient({
    baseUrl,
    sign: (method, path, claims) => signServiceAssertion(MCP_SERVICE_NAME, method, path, claims),
    send: (url, init) =>
      internalFetch(url, init, {
        // Service timeout plus 15 s.
        timeoutMs: MCP_REQUEST_TIMEOUT_MS + 15_000,
        maxRedirects: 0,
        maxResponseBytes: MAX_RESPONSE_BYTES,
      }),
    onEvictError: (err) => log.warn(`[mcp-executor] evict failed: ${errMsg(err)}`),
  });
  cached = { baseUrl, client };
  return client;
}
