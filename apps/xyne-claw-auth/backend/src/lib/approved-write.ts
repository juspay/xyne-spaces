/**
 * Executing a write action that a human approved somewhere OTHER than the
 * Spaces web app.
 *
 * Claw's write tools never execute themselves: they return a signed
 * `pendingAction` and claw-auth posts an Approve/Decline card. That card has
 * always lived in Spaces, and routes/flow-action.ts executes it there. A
 * messaging channel (WhatsApp) can now render the same approval as a native
 * card, so the tap needs somewhere to land — this module.
 *
 * It deliberately covers ONLY the generic MCP-connector path, the last branch
 * of flow-action's approve-write handler. Every branch flow-action special-
 * cases (Spaces app-token sends, gateway services, Google, Microsoft, skill
 * and agent-tool mutations) carries setup that the Spaces card has and a
 * messenger does not, so those are refused here and pointed back at Spaces
 * rather than half-implemented. Widening this set means porting a branch
 * properly, not deleting a check.
 */
import { createLogger } from "../logger.js";
import { errMsg } from "./errors.js";
import type { SignedWriteAction as BaseWriteAction } from "./write-actions.js";
import { AGENT_TOOL_SLUGS } from "./agent-tools-apply.js";
import { GATEWAY_KEY_PREFIX, parseGatewayCatalogSource } from "../mcpgateway/key-format.js";

const log = createLogger("approved-write");

/** A pending write exactly as claw minted it. The signature covers only the
 *  four fields of the base shape (routes/mcp.ts signAction); the two optional
 *  ones ride along so a re-signed card can be verified in either form. */
export interface SignedWriteAction extends BaseWriteAction {
  agentSlug?: string;
  spacesAppId?: string;
}

export type ApprovedWriteOutcome =
  | { ok: true; message: string; resultText: string }
  | { ok: false; message: string; reason: "signature" | "unsupported" | "no-connection" | "failed" };

/** True when flow-action would take a branch this module does not implement. */
export function needsSpacesApproval(serverType: string, tool: string): boolean {
  if (parseGatewayCatalogSource(serverType) || serverType.startsWith(GATEWAY_KEY_PREFIX)) return true;
  if (serverType === "google" || serverType === "microsoft") return true;
  if (serverType === "skill") return true;
  if (serverType === "agent-tools" && (AGENT_TOOL_SLUGS.has(tool) || tool === "create-skill")) return true;
  // Posting AS the user through the Spaces app token needs an agent's
  // spacesAppToken, which is resolved from the card's own agent binding.
  if (serverType === "xyne-spaces" && tool === "spaces-send-message") return true;
  return false;
}

/**
 * Verify and run an approved write.
 *
 * `approverUserId` is the identity of whoever pressed the button, resolved by
 * the caller from its own surface. It must equal the user the action was
 * signed for — this is the same rule flow-action enforces, and it is what
 * stops one person approving a write queued under another's identity.
 */
export async function executeApprovedWrite(input: {
  action: SignedWriteAction;
  approverUserId: string;
  conversationId?: string;
}): Promise<ApprovedWriteOutcome> {
  const { action, approverUserId } = input;
  const { serverType, tool, params, userId, signature } = action;

  if (approverUserId !== userId) {
    log.error(`[approved-write] identity mismatch: approver=${approverUserId} signed-for=${userId} tool=${tool}`);
    return { ok: false, reason: "signature", message: "This approval isn't yours to give." };
  }

  const { verifyActionSignatureAny } = await import("../routes/mcp.js");
  // Claw signs the bare four-field shape; accept the agent-bound shape too so
  // a re-signed card (webhook.ts mints one for Spaces) still verifies.
  const bare = { serverType, tool, params, userId };
  const bound = { ...bare, agentSlug: action.agentSlug ?? "", spacesAppId: action.spacesAppId ?? "" };
  if (!verifyActionSignatureAny([bare, bound], signature)) {
    log.error(`[approved-write] HMAC verification failed tool=${tool} user=${userId}`);
    return { ok: false, reason: "signature", message: "This action could not be verified. Please approve it in Xyne Spaces." };
  }

  if (needsSpacesApproval(serverType, tool)) {
    return {
      ok: false,
      reason: "unsupported",
      message: `"${tool}" has to be approved in Xyne Spaces — it needs a connection this chat can't reach.`,
    };
  }

  const { callTool } = await import("../mcp/runner.js");
  const { hasConnectorDefinition } = await import("../mcp/connector-definitions.js");
  const { loadEffectiveCredentials } = await import("./credentials-loader.js");

  if (!(await hasConnectorDefinition(serverType))) {
    return { ok: false, reason: "unsupported", message: `No adapter for ${serverType}.` };
  }
  const effective = await loadEffectiveCredentials(userId, serverType, action.agentSlug);
  if (!effective) {
    return { ok: false, reason: "no-connection", message: `Your ${serverType} connection is missing — reconnect it in Xyne Spaces.` };
  }

  try {
    const result = await callTool(userId, serverType, effective.credentials, tool, params);
    log.info(`[approved-write] executed tool=${tool} user=${userId} → ${result.content.slice(0, 100)}`);
    return { ok: true, message: `Done — ${tool} ran.`, resultText: result.content };
  } catch (err) {
    // The raw error can carry connector internals; keep the detail in the log
    // and give the person the short version.
    log.error(`[approved-write] tool failed tool=${tool} user=${userId}: ${errMsg(err)}`);
    return { ok: false, reason: "failed", message: `${tool} failed to run. Please try again from Xyne Spaces.` };
  }
}
