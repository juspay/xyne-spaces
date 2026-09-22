import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";
import { fetchClawRunWithRetry } from "./claw-fetch.js";
import { enqueueRun, getRunExecutionQueue } from "../queue/run-execution-queue.js";

const log = createLogger("dispatch-run");

export type RunDispatchPayload = Record<string, unknown> & { sessionId?: string };

export interface RunDispatchResult {
  success: boolean;
  sessionId?: string;
  error?: string;
  status: number;
  queued?: boolean;
  queuePosition?: number;
}

export interface DispatchRunOptions {
  onEnqueued?: (sessionId: string) => Promise<void>;
}

export async function dispatchRun(
  payload: RunDispatchPayload,
  options: DispatchRunOptions = {},
): Promise<RunDispatchResult> {
  const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : undefined;
  if (!sessionId) {
    log.error("[dispatch-run] refusing to enqueue a run whose payload carries no sessionId");
    return { success: false, error: "Run dispatch payload is missing a sessionId", status: 500 };
  }
  if (payload.instant === true) {
    const clawRes = await fetchClawRunWithRetry(
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(CONFIG.xyneClawS2sKey ? { "x-s2s-key": CONFIG.xyneClawS2sKey } : {}),
        },
        body: JSON.stringify({ ...payload, sessionId }),
      },
      "instant-dispatch",
    );
    const clawBody = (await clawRes.json().catch(() => null)) as {
      success?: boolean;
      sessionId?: string;
      error?: string;
    } | null;
    if (!clawRes.ok || !clawBody?.success) {
      return {
        success: false,
        sessionId,
        error: clawBody?.error ?? `Instant dispatch failed: HTTP ${clawRes.status}`,
        status: clawRes.status >= 400 ? clawRes.status : 502,
      };
    }
    if (options.onEnqueued) await options.onEnqueued(sessionId);
    return { success: true, sessionId: clawBody.sessionId ?? sessionId, status: 202, queued: false };
  }
  await enqueueRun({ ...payload, sessionId });
  log.info(`[metric] name=run_queue_enqueued kind=count value=1 session=${sessionId}`);
  const waiting = await getRunExecutionQueue()
    .getWaitingCount()
    .catch(() => undefined);
  if (options.onEnqueued) await options.onEnqueued(sessionId);
  return {
    success: true,
    sessionId,
    status: 202,
    queued: true,
    ...(typeof waiting === "number" ? { queuePosition: waiting } : {}),
  };
}
