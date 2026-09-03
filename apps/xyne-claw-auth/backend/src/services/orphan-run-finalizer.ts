import { prisma } from "../db.js";
import { errMsg } from "../lib/errors.js";
import { createLogger } from "../logger.js";
import { cancelRunRecovery, handleRunCompletion } from "../queue/run-recovery-worker.js";

const log = createLogger("orphan-run-finalizer");

export interface OrphanRunRef {
  sessionId: string;
  agentSlug: string;
  userId?: string | null;
  conversationId?: string | null;
}

export async function finalizeOrphanedRun(
  run: OrphanRunRef,
  error: string,
  logPrefix = "orphan-finalizer",
): Promise<boolean> {
  await cancelRunRecovery(run.sessionId).catch((err) =>
    log.warn(`[${logPrefix}] cancelRunRecovery failed for ${run.sessionId}: ${errMsg(err)}`),
  );

  const updated = await prisma.agentRun.updateMany({
    where: { sessionId: run.sessionId, status: "running" },
    data: {
      status: "failed",
      error,
      completedAt: new Date(),
      currentToolLabel: null,
    },
  });
  if (updated.count === 0) return false;

  await handleRunCompletion(run.sessionId, "failed", error).catch((err) =>
    log.warn(`[${logPrefix}] handleRunCompletion failed for orphan ${run.sessionId}: ${errMsg(err)}`),
  );
  return true;
}
