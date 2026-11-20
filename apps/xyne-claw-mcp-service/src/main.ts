/**
 * xyne-claw-mcp-service entrypoint. Exits when no caller public keys are set.
 *
 * Env:
 *   CLAW_MCP_PORT               listen port (default 3010)
 *   CLAW_ENCRYPTION_PUBLIC_KEYS {"<kid>": "<SPKI PEM>"} for caller xyne-claw-encryption
 *   CLAW_SERVICE_PUBLIC_KEYS    {"<kid>": "<SPKI PEM>"} for caller xyne-claw-auth
 *   MCP_ALLOWED_CALLERS         optional comma list of accepted callers
 *   MCP_ALLOWED_HTTP_HOSTS      hosts http launches may reach, internal ones included
 *   MCP_HTTP_ONLY_LISTED        "true": http launches only to MCP_ALLOWED_HTTP_HOSTS
 *   MCP_MAX_SESSIONS            optional cap on live sessions
 *   MCP_NPM_DIR / MCP_PY_DIR    installed npm / Python MCP servers
 */
import { createLogger } from "xyne-claw-shared";
import { AssertionVerifier, callerKeysFromEnv } from "./auth.js";
import { createMcpServiceApp } from "./app.js";
import { poolCloseAll } from "./pool.js";

const log = createLogger("mcp-service");

// Identify this process in structured logs (overridden by deployment env).
process.env["SERVICE_NAME"] ||= "xyne-claw-mcp-service";

const verifier = new AssertionVerifier(callerKeysFromEnv());
if (!verifier.configured) {
  log.error("[mcp-service] no caller public keys (CLAW_ENCRYPTION_PUBLIC_KEYS / CLAW_SERVICE_PUBLIC_KEYS); refusing to start");
  process.exit(1);
}
log.info(`[mcp-service] accepting calls from: ${verifier.callerNames.join(", ")}`);

const port = Number(process.env["CLAW_MCP_PORT"] ?? 3010);
const server = createMcpServiceApp(verifier).listen(port, () => {
  log.info(`[mcp-service] listening on :${port}`);
});
// Tool calls can run for up to 10 minutes.
server.requestTimeout = 0;
server.headersTimeout = 65_000;
server.keepAliveTimeout = 61_000;

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`[mcp-service] ${signal}: closing sessions`);
  server.close();
  await poolCloseAll();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
