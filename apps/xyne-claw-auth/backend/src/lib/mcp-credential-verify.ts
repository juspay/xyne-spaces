import { checkHealth } from "../health.js";
import { evictSession } from "../mcp/runner.js";
import { resolveConnectorDefinition } from "../mcp/connector-definitions.js";
import { errMsg } from "./errors.js";
import { createLogger } from "../logger.js";

const log = createLogger("mcp-verify");

export const MCP_VERIFY_TIMEOUT_MS = Number(process.env["MCP_VERIFY_TIMEOUT_MS"] ?? 45_000);

const OAUTH_ISSUED_TYPES = new Set([
  "google",
  "microsoft",
  "xyne-spaces",
  "xyne-spaces-app-tools",
  "xyne-dashboard",
]);

export type McpVerification =
  | { ok: true; skipped: boolean; message: string }
  | { ok: false; kind: "rejected" | "unreachable"; message: string };

export function verificationSkippedFor(serverType: string): boolean {
  return OAUTH_ISSUED_TYPES.has(serverType);
}

const TRANSIENT_MARKERS = [
  "etimedout",
  "econnreset",
  "econnrefused",
  "enotfound",
  "eai_again",
  "socket hang up",
  "fetch failed",
  "network error",
  "timed out",
  "timeout",
  "connection closed",
  "rate-limited",
  "rate limited",
  "too many requests",
];

function classify(message: string): "rejected" | "unreachable" {
  const lower = message.toLowerCase();
  return TRANSIENT_MARKERS.some((marker) => lower.includes(marker)) ? "unreachable" : "rejected";
}

async function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
): Promise<{ timedOut: false; value: T } | { timedOut: true }> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<{ timedOut: true }>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
  });
  try {
    return await Promise.race([work.then((value) => ({ timedOut: false as const, value })), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function verifyMcpCredentials(args: {
  sessionKey: string;
  serverType: string;
  serverName: string;
  credentials: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<McpVerification> {
  const { sessionKey, serverType, serverName, credentials } = args;
  const timeoutMs = args.timeoutMs ?? MCP_VERIFY_TIMEOUT_MS;

  if (verificationSkippedFor(serverType)) {
    return { ok: true, skipped: true, message: "Connected." };
  }

  const definition = await resolveConnectorDefinition(serverType).catch(() => undefined);
  if (!definition) {
    return { ok: false, kind: "rejected", message: `No connector definition for "${serverType}".` };
  }

  const requiresCredentials = (definition.credentialFields ?? []).some((field) => !field.optional);
  if (!requiresCredentials) {
    return { ok: true, skipped: true, message: "Connected." };
  }

  const raced = await withTimeout(
    checkHealth(sessionKey, serverType, serverName, credentials),
    timeoutMs,
  ).catch((err: unknown) => ({ timedOut: false as const, value: { healthy: false, message: errMsg(err), latencyMs: 0 } }));

  if (raced.timedOut) {
    await evictSession(sessionKey, serverType).catch(() => {});
    log.warn(`[verify] ${serverType} timed out after ${timeoutMs}ms for ${sessionKey}`);
    return {
      ok: false,
      kind: "unreachable",
      message: `${serverName} didn't respond within ${Math.round(timeoutMs / 1000)}s. Nothing was saved — try again.`,
    };
  }

  const result = raced.value;
  if (result.healthy) {
    log.info(`[verify] ${serverType} ok in ${result.latencyMs}ms`);
    return { ok: true, skipped: false, message: result.message };
  }

  const kind = classify(result.message);
  log.info(`[verify] ${serverType} ${kind}: ${result.message.slice(0, 160)}`);
  return {
    ok: false,
    kind,
    message:
      kind === "unreachable"
        ? `Couldn't reach ${serverName} to check these details (${result.message}). Nothing was saved — try again.`
        : `${serverName} rejected these details: ${result.message}`,
  };
}
