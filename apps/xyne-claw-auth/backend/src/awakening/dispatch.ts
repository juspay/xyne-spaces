/**
 * Builds and fires the xyne-claw run for an awakened window.
 *
 * Deliberately mirrors queue/scheduled-jobs-worker.ts, which is the proven
 * headless dispatch path: same /internal/run endpoint, same provider
 * resolution, same __persistedByCaller opt-out so we own the AgentRun row and
 * it gets the right triggerSource instead of racing the pod's own insert.
 *
 * Two things are specific to awakening:
 *  - the window artifact rides along as `contextFiles`, which xyne-claw writes
 *    into the session's .context/ directory before the agent starts;
 *  - the operating-contract skill is inlined rather than seeded, so it is
 *    present on every awakened run by construction.
 *
 * Pre-flight is FAIL-CLOSED on identity: an unattended run must act as the
 * agent's own app identity or not at all. Falling back to a user token would
 * mean a background loop acting with a human's credentials.
 */

import { prisma } from "../db.js";
import { CONFIG } from "../config.js";
import { decrypt } from "../crypto.js";
import { agentRunRepository } from "../repositories/index.js";
import { ensureUserExists } from "../lib/users-jit.js";
import { chatMessageRepository } from "../repositories/index.js";
import { setSession } from "../lib/session-context.js";
import { resolveAgentProviderConfigs } from "../lib/agent-provider-config.js";
import { renderWindow } from "./render.js";
import { HEARTBEAT_SKILL, REFLEX_SKILL } from "./skills.js";
import { buildWritePermissions } from "./write-policy.js";
import { buildOperatingContract } from "./contract.js";
import type { AgentSpacesIdentity, AwakeningWindow } from "./types.js";
import { createLogger } from "../logger.js";

const log = createLogger("awakening-dispatch");

export class AwakeningIdentityError extends Error {
  constructor(agentSlug: string, reason: string) {
    super(`Agent "${agentSlug}" cannot run unattended: ${reason}`);
    this.name = "AwakeningIdentityError";
  }
}

interface AgentIdentityRow {
  id: string;
  slug: string;
  orgId: string;
  config: unknown;
  spacesAppId: string | null;
  spacesAppUserId: string | null;
  spacesAppToken: string | null;
}

/**
 * Decrypt and validate the agent's Spaces app identity.
 * Throws rather than degrading — see the fail-closed note above.
 */
export function resolveAgentIdentity(agent: AgentIdentityRow, workspaceId: string): AgentSpacesIdentity {
  if (!agent.spacesAppId) throw new AwakeningIdentityError(agent.slug, "no Spaces app is linked");
  if (!agent.spacesAppUserId) throw new AwakeningIdentityError(agent.slug, "no Spaces app user id");
  if (!agent.spacesAppToken) throw new AwakeningIdentityError(agent.slug, "no Spaces app token");

  const [ciphertext, iv, authTag] = agent.spacesAppToken.split(":");
  if (!ciphertext || !iv || !authTag) {
    throw new AwakeningIdentityError(agent.slug, "app token is not in the expected encrypted format");
  }

  let appToken: string;
  try {
    appToken = decrypt(ciphertext, iv, authTag, CONFIG.encryptionKey);
  } catch (err) {
    throw new AwakeningIdentityError(
      agent.slug,
      `app token failed to decrypt (${err instanceof Error ? err.message : "unknown"})`,
    );
  }
  if (!appToken) throw new AwakeningIdentityError(agent.slug, "app token decrypted to an empty string");

  return { appToken, spacesAppId: agent.spacesAppId, spacesAppUserId: agent.spacesAppUserId, workspaceId };
}

/** The task text the agent is woken with. The window artifact carries the data. */
function buildTask(w: AwakeningWindow): string {
  const s = w.signals;
  return [
    `You have woken on a ${w.kind}. Nobody triggered this run.`,
    "",
    `A window of everything that happened in your watched channels has been collected for you.`,
    `Read \`.context/heartbeat/WINDOW.md\` first — it is the overview, and it points at the detail.`,
    "",
    `Window: ${new Date(w.startMs).toISOString()} → ${new Date(w.endMs).toISOString()}`,
    `Events: ${s.eventCount} (${s.humanEventCount} from humans across ${s.distinctSenders} people and ${s.distinctThreads} threads)`,
    `Needing attention: ${s.unansweredThreads} unanswered thread(s), ${s.mentionsOfMe} direct mention(s) of you, ${s.actionSignals} action signal(s)`,
    "",
    `Follow the ${w.kind === "reflex" ? "xyne-reflex" : "xyne-heartbeat"} skill. Doing nothing is a valid and`,
    "common outcome — act only where you can genuinely add something.",
  ].join("\n");
}

export interface DispatchResult {
  sessionId: string | null;
  dispatched: boolean;
  reason?: string;
}

/**
 * Fire the run. Returns the claw sessionId on success.
 * The caller owns idempotency (the AgentAwakeningRun row) and the watermark.
 */
export async function dispatchAwakening(
  window: AwakeningWindow,
  agent: AgentIdentityRow,
  identity: AgentSpacesIdentity,
  idempotencyKey: string,
): Promise<DispatchResult> {
  // The run route derives the org from the RUN'S USER, never from the request
  // body or headers — requireAuth strips x-org-id inbound so a caller can
  // never inject one. An awakened run has no human session, so the bot's own
  // Spaces user must exist locally, carrying the agent's org, before dispatch.
  const mirrored = await ensureUserExists(identity.spacesAppUserId, "awakening", agent.orgId);
  if (!mirrored) {
    return {
      sessionId: null,
      dispatched: false,
      reason: `could not mirror the agent's Spaces user ${identity.spacesAppUserId} into org ${agent.orgId}`,
    };
  }

  const rendered = renderWindow(window);
  const conversationId = `awaken_${window.agentId}_${window.startMs}`;

  // Fold the run's write policy into the agent config as per-tool denials.
  // Enforced at claw-auth's MCP call boundary, so it holds regardless of what
  // the model decides to try.
  const baseConfig = (agent.config ?? {}) as Record<string, unknown>;
  const existingPermissions =
    (baseConfig["toolPermissions"] as Record<string, string> | undefined) ?? {};
  const awakenedAgentConfig: Record<string, unknown> = {
    ...baseConfig,
    toolPermissions: buildWritePermissions(window.config, existingPermissions),
  };

  const { providerConfigs, providerOrder, parent: providerParent } = await resolveAgentProviderConfigs(
    agent as Parameters<typeof resolveAgentProviderConfigs>[0],
    { headlessBulk: true },
  ).catch(() => ({ providerConfigs: {}, providerOrder: [] as string[], parent: undefined as string | undefined }));

  const dispatchPayload = {
    userId: identity.spacesAppUserId,
    task: buildTask(window),
    agentSlug: agent.slug,
    orgId: window.orgId,
    channelId: "",
    conversationId,
    traceId: conversationId,
    callbackUrl: `${CONFIG.internalUrl}/claw/api/v1/awakening/${idempotencyKey}/result`,
    progressUrl: `${CONFIG.internalUrl}/claw/api/v1/webhook/progress`,
    idempotencyKey,
    detached: true,
    // Distinguishes an unattended run from a scheduled or user-triggered one.
    // xyne-claw keys the write guard and the tool set off this.
    eventType: "awakening",
    awakening: {
      kind: window.kind,
      writePolicy: window.config.writePolicy,
      shadow: window.config.shadow,
      windowStartMs: window.startMs,
      windowEndMs: window.endMs,
      entryPath: rendered.entryPath,
      // Live injection applies to reflex runs only: a heartbeat is a deliberate
      // pass over a sealed window, and mutating that window mid-run would make
      // its own artifact a lie.
      injectEnabled: window.kind === "reflex" && window.config.reflex.injectEnabled,
    },
    contextFiles: rendered.files,
    additionalInstructions: buildOperatingContract(window),
    skills: [window.kind === "reflex" ? REFLEX_SKILL : HEARTBEAT_SKILL],
    // We insert the AgentRun ourselves (below) so it carries triggerSource
    // "heartbeat"; without this the pod also inserts one tagged "spaces" and
    // the two race on the sessionId unique constraint.
    __persistedByCaller: true,
    agentConfig: awakenedAgentConfig,
    ...(providerParent ? { provider: providerParent } : {}),
    ...(Object.keys(providerConfigs).length > 0 ? { providerConfigs } : {}),
    ...(providerOrder.length > 1 ? { providerOrder } : {}),
  };

  const res = await fetch(`${CONFIG.internalUrl}/claw/api/v1/internal/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
    },
    body: JSON.stringify(dispatchPayload),
  });

  const body = (await res.json().catch(() => null)) as
    | { success?: boolean; sessionId?: string; error?: string }
    | null;

  if (!res.ok || !body?.success) {
    const reason = body?.error ?? `HTTP ${res.status}`;
    log.warn(`[awakening] dispatch failed agent=${agent.slug} kind=${window.kind}: ${reason}`);
    return { sessionId: null, dispatched: false, reason };
  }

  const sessionId = body.sessionId ?? null;
  if (sessionId) {
    // Persist the run's SessionContext.
    //
    // Load-bearing for requirement 3 ("the agent gets a human's hands"):
    // routes/mcp.ts decides at TOOL-LISTING time whether Spaces is served in
    // APP mode (the xyne-spaces-app-tools server, which owns the ungated
    // `apps-send-message`) or USER mode. That decision reads this context and
    // keys off `isAutomation`. With no context the run silently falls back to
    // user mode, where the only post tool is HITL-gated — so an unattended
    // agent raises an approval card that nobody will ever click, and appears
    // to simply say nothing.
    //
    // An awakened run IS an app-user run with no human in the thread, which is
    // exactly what that flag means.
    await setSession(sessionId, {
      mentionedUserId: identity.spacesAppUserId,
      senderId: identity.spacesAppUserId,
      senderName: agent.slug,
      // No single channel: an awakened agent decides which of its watched
      // channels to act in, and passes the target explicitly to each tool.
      channelId: "",
      channelName: "",
      conversationId,
      task: `${window.kind} window`,
      agentId: agent.id,
      agentOrgId: window.orgId,
      agentSlug: agent.slug,
      responseMode: "conversation",
      // Read by routes/mcp.ts to grant this run the bot-identity send tool and
      // the Spaces subagent. Without it the run has no way to speak at all.
      triggerSource: window.kind,
      // The agent posts through tools, choosing thread and wording itself.
      // Its final answer is a report for the operator, not a channel message.
      suppressThreadReply: true,
      isAutomation: true,
      appToken: identity.appToken,
      spacesAppId: identity.spacesAppId,
      spacesAppUserId: identity.spacesAppUserId,
      workspaceId: identity.workspaceId,
      traceId: conversationId,
    }).catch((e) =>
      log.warn(`[awakening] setSession failed for ${sessionId}: ${e instanceof Error ? e.message : e}`),
    );

    // The chat UI renders a conversation from ChatMessage rows, not from
    // AgentRun. Without this opening turn an awakened conversation exists in
    // the run list but its thread is empty and will not open.
    await chatMessageRepository
      .create({
        conversationId,
        agentSlug: agent.slug,
        userId: identity.spacesAppUserId,
        role: "user",
        content: dispatchPayload.task,
        status: "completed",
        orgId: window.orgId,
      })
      .catch((e) => log.warn(`[awakening] user ChatMessage failed: ${e instanceof Error ? e.message : e}`));

    await agentRunRepository
      .start({
        sessionId,
        userId: identity.spacesAppUserId,
        agentSlug: agent.slug,
        orgId: window.orgId,
        triggerSource: window.kind,
        task: `${window.kind} window ${new Date(window.startMs).toISOString()}`,
        conversationId,
      })
      .catch((e) => log.warn(`[awakening] AgentRun.start failed: ${e instanceof Error ? e.message : e}`));
  }

  log.info(
    `[awakening] dispatched agent=${agent.slug} kind=${window.kind} events=${window.events.length} session=${sessionId}`,
  );
  return { sessionId, dispatched: true };
}
