import { randomUUID } from "node:crypto";
import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";
import { redisService } from "../redis.js";
import { agentRunRepository, chatMessageRepository } from "../repositories/index.js";
import { errMsg } from "./errors.js";
import { resolveFastMode } from "./fast-mode.js";

const log = createLogger("xyne-ai-continuation");

/** Past this we dispatch anyway and let claw decide. */
const LOCK_WAIT_MAX_MS = 120_000;
const LOCK_POLL_MS = 2_000;

/**
 * Continuation run for a Xyne AI card. No channel for /webhook/result to post
 * into, so this mirrors artifact-app-agents' dispatchRun: pre-create the row,
 * then finalize onto it via agent-chat's internal callback.
 */
export async function dispatchXyneAiContinuationRun(input: {
  agent: { id: string; orgId: string; config?: unknown } | null;
  agentSlug: string;
  conversationId: string;
  userId: string;
  orgId: string;
  prompt: string;
  context?: string | undefined;
  idempotencyKey: string;
  failureMessage: string;
  /** Assistant row the card sits on — this turn's tree parent. */
  chatMessageId: string;
}): Promise<void> {
  try {
    // No user row (the answer or approval is on the card), and the assistant row chains
    // onto the card's turn — off the ROOT the chat reads it as a regenerate
    // fork and pages the question out of view.
    const parentId =
      input.chatMessageId ||
      (await chatMessageRepository
        .latestMessageId(input.conversationId, input.agentSlug)
        .catch(() => null)) ||
      null;

    const assistantMsg = await chatMessageRepository.create({
      conversationId: input.conversationId,
      agentSlug: input.agentSlug,
      userId: input.userId,
      role: "assistant",
      content: "",
      status: "running",
      orgId: input.orgId,
      parentId,
    });

    // The card is clickable before the asking run ends, and that run holds the
    // session lock for tens of seconds — dispatching into it returns
    // `session_locked`, so wait the lock out first.
    const lockKeys = [
      `claw-session-lock:${input.conversationId}_${input.agentSlug}`,
      `claw-session-lock:${input.conversationId}`,
    ];
    const redis = redisService.getConnection();
    const lockWaitDeadline = Date.now() + LOCK_WAIT_MAX_MS;
    let waitedMs = 0;
    while (Date.now() < lockWaitDeadline) {
      const held = await redis.exists(...lockKeys).catch(() => 0);
      if (!held) break;
      await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
      waitedMs += LOCK_POLL_MS;
    }
    if (waitedMs > 0) {
      log.info(`[continuation] xyne-ai waited ${waitedMs}ms for the conversation lock`);
    }

    const callbackId = randomUUID();
    const base = `${CONFIG.internalUrl}/claw/api/v1/internal/agent-chat/${encodeURIComponent(input.agentSlug)}/chat/${encodeURIComponent(input.conversationId)}`;
    const query = `callbackId=${callbackId}&assistantMessageId=${assistantMsg.id}`;

    const { resolveAgentProviderConfigs } = await import("./agent-provider-config.js");
    const providers = input.agent
      ? await resolveAgentProviderConfigs(
          { id: input.agent.id, config: input.agent.config ?? null },
          { headlessBulk: true },
        ).catch(() => null)
      : null;
    const fastModeEnabled = await resolveFastMode(
      input.conversationId,
      input.agentSlug,
      input.agent?.config ?? null,
    ).catch(() => false);

    const runRes = await fetch(`${CONFIG.internalUrl}/claw/api/v1/internal/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
      },
      body: JSON.stringify({
        userId: input.userId,
        task: input.prompt,
        ...(input.context ? { context: input.context } : {}),
        agentSlug: input.agentSlug,
        orgId: input.orgId,
        conversationId: input.conversationId,
        traceId: input.conversationId,
        callbackUrl: `${base}/callback?${query}`,
        progressUrl: `${base}/progress?${query}`,
        idempotencyKey: input.idempotencyKey.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 128),
        detached: true,
        __persistedByCaller: true,
        // The sidebar chat can render cards (draft agent, connectors) even
        // though progress here is a URL, not a live emitter. Without this
        // marker claw treats the continuation as a headless run and drops
        // propose-agent / suggest-connectors. Honored only from S2S callers.
        cardSurface: "xyne-ai",
        ...(input.agent?.config ? { agentConfig: input.agent.config } : {}),
        ...(providers?.parent ? { provider: providers.parent } : {}),
        ...(providers && Object.keys(providers.providerConfigs).length > 0
          ? { providerConfigs: providers.providerConfigs }
          : {}),
        ...(providers && providers.providerOrder.length > 1
          ? { providerOrder: providers.providerOrder }
          : {}),
        fastMode: fastModeEnabled,
      }),
    });

    const runBody = (await runRes.json().catch(() => null)) as
      | { success?: boolean; sessionId?: string; error?: string }
      | null;
    if (!runRes.ok || !runBody?.success || !runBody.sessionId) {
      await chatMessageRepository
        .update(assistantMsg.id, { status: "failed", content: input.failureMessage })
        .catch(() => {});
      log.error(`[continuation] xyne-ai run failed: ${runBody?.error ?? `HTTP ${runRes.status}`}`);
      return;
    }

    await agentRunRepository
      .start({
        sessionId: runBody.sessionId,
        userId: input.userId,
        agentSlug: input.agentSlug,
        orgId: input.orgId,
        triggerSource: "chat",
        task: input.prompt,
        conversationId: input.conversationId,
      })
      .catch((err: unknown) => log.warn(`[continuation] xyne-ai run not tracked: ${errMsg(err)}`));

    log.info(`[continuation] xyne-ai → run ${runBody.sessionId} conv=${input.conversationId}`);
  } catch (err) {
    log.error(`[continuation] xyne-ai dispatch error: ${errMsg(err)}`);
  }
}

