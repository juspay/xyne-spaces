import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";
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
  httpDispatch: () => Promise<RunDispatchResult>;
  onEnqueued?: (sessionId: string) => Promise<void>;
}

export function runQueueEnabled(): boolean {
  return CONFIG.runQueueEnabled;
}

export async function dispatchRun(
  payload: RunDispatchPayload,
  options: DispatchRunOptions,
): Promise<RunDispatchResult> {
  const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : undefined;
  if (runQueueEnabled()) {
    if (!sessionId) {
      log.error("[dispatch-run] XYNE_RUN_QUEUE=1 but the payload carries no sessionId — falling back to HTTP dispatch");
    } else {
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
  }
  return options.httpDispatch();
}
