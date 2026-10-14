import { SERVER } from "./config.js";
import { createLogger } from "./logger.js";

const log = createLogger("create-agent-check");

export const CREATE_AGENT_TOOL = "create-agent";

const CHECK_TIMEOUT_MS = 5000;

export interface CreateAgentCheck {
  refusal: string | null;
  notGranted: string[];
}

const PASS: CreateAgentCheck = { refusal: null, notGranted: [] };

export async function checkCreateAgent(
  userId: string,
  params: Record<string, unknown>,
): Promise<CreateAgentCheck> {
  if (!userId || !SERVER.s2sKey) return PASS;
  try {
    const base = SERVER.authServiceUrl.replace(/\/$/, "");
    const res = await fetch(`${base}/claw/api/v1/internal/agent-create/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-s2s-key": SERVER.s2sKey },
      body: JSON.stringify({ userId, params }),
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    if (!res.ok) return PASS;
    const body = (await res.json()) as { error?: unknown; notGranted?: unknown };
    const refusal = typeof body.error === "string" && body.error.trim() ? body.error.trim() : null;
    const notGranted = Array.isArray(body.notGranted)
      ? body.notGranted.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      : [];
    return { refusal, notGranted };
  } catch (err) {
    log.warn(`[create-agent-check] check failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    return PASS;
  }
}

export function createAgentRefusedText(refusal: string): string {
  return (
    `create-agent was NOT queued — no draft card will appear and nothing was created. ${refusal} ` +
    "Tell the user this plainly in one short line. Do not say a card is on screen."
  );
}

const listed = (tools: string[]): string => tools.map((t) => `\`${t}\``).join(", ");

export function createAgentUnknownToolsText(notGranted: string[]): string {
  return (
    `create-agent was NOT queued — no card has been shown. These tools do not exist in this workspace: ${listed(notGranted)}. ` +
    "Call create-agent again with real tool names only (search_tools finds them) or without them, " +
    "and make your summary describe only the tools you actually grant."
  );
}

export function createAgentDroppedToolsNote(notGranted: string[]): string {
  return (
    ` These requested tools do not exist and will NOT be granted: ${listed(notGranted)}. ` +
    "Say so in your one line, and do not claim the agent can do what they would have done."
  );
}
