/**
 * Agent-run dispatch for a fired automation.
 *
 * Reuses the SAME internal contract the scheduled-jobs worker uses
 * (`POST {internalUrl}/claw/api/v1/internal/run` with the `x-s2s-key` header —
 * see `queue/scheduled-jobs-worker.ts`). The one deliberate divergence: a
 * scheduled job mints a FRESH `scheduled_<id>_<ts>` conversationId so the agent
 * gets a clean session, whereas an agent-automation dispatches into the
 * ORIGINAL `conversationId` so the agent resumes the same thread with full
 * history and posts its reply back where the user is watching.
 *
 * The heavy LLM run happens off the request path — the public ingress returns
 * 202 and this dispatch is fired after the run row is recorded.
 */

import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";

const log = createLogger("agent-automations:dispatch");

export interface AutomationDispatchInput {
  automationId: string;
  runId: string;
  userId: string;
  orgId: string;
  agentSlug: string;
  /** Original thread — wakeups CONTINUE this conversation. */
  conversationId: string;
  channelId?: string | null;
  /** Rendered task (may already have {{trigger.body.*}} substituted upstream). */
  task: string;
  /** The webhook event, exposed to the run as {{trigger.*}} context. */
  trigger: { body: unknown; headers: Record<string, string>; receivedAt: string };
  /** Stable per-delivery key so /internal/run dedups a retried dispatch. */
  deliveryId: string;
}

export interface DispatchResult {
  success: boolean;
  sessionId?: string;
  error?: string;
}

const RUN_BASE = `${CONFIG.internalUrl}/claw/api/v1`;

export async function dispatchAutomationRun(input: AutomationDispatchInput): Promise<DispatchResult> {
  const callbackUrl = `${RUN_BASE}/agent-automations/runs/${input.runId}/result`;
  const progressUrl = `${RUN_BASE}/webhook/progress`;
  const idempotencyKey = `agentauto_${input.automationId}_${input.deliveryId}`
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .slice(0, 128);

  const context = [
    "## Agent Automation",
    "You previously proposed watching an external event on this thread; a matching event just fired.",
    "Continue in THIS conversation using the thread history. The raw event is available as `trigger`.",
    "",
    "### trigger.body",
    "```json",
    JSON.stringify(input.trigger.body, null, 2),
    "```",
  ].join("\n");

  const dispatchPayload = {
    userId: input.userId,
    task: input.task,
    context,
    agentSlug: input.agentSlug,
    orgId: input.orgId,
    channelId: input.channelId ?? "",
    // ORIGINAL thread — deliberate divergence from scheduled jobs.
    conversationId: input.conversationId,
    traceId: input.conversationId,
    callbackUrl,
    progressUrl,
    idempotencyKey,
    detached: true,
    eventType: "agent_automation",
    trigger: input.trigger,
  };

  // Inference-only typing for `fetch`/`res`, matching queue/scheduled-jobs-worker.ts
  // (avoids depending on a global `Response` type being in scope).
  try {
    const res = await fetch(`${RUN_BASE}/internal/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
      },
      body: JSON.stringify(dispatchPayload),
    });
    const body = (await res.json().catch(() => ({}))) as DispatchResult;
    if (!res.ok || !body.success) {
      return { success: false, error: body.error ?? `run dispatch HTTP ${res.status}` };
    }
    return { success: true, sessionId: body.sessionId };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error(`dispatch failed for automation=${input.automationId} delivery=${input.deliveryId}: ${error}`);
    return { success: false, error };
  }
}
