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
