import type { Request, Response } from 'express';
import { findWorkflowExecutionForCallback, resumeWorkflowClawCallback } from '@/bypassAcl/workflowServices';
import { logger } from '@/utils/logger';

/**
 * A stale callback answers 200, not an error. Claw did nothing wrong, and a
 * non-2xx would have its recovery worker redeliver a payload we are discarding
 * on purpose.
 */

/**
 * Claw's completion callback for a parked agent step.
 *
 * Claw POSTs here when a dispatched run finishes. The body is claw's result
 * envelope (`{status, result, attachments, error}`), handed to the SDK as an
 * opaque resume payload; `ClawAgentProvider.collect()` reads it back on the
 * other side.
 *
 * **The gate is addressed by node path; the attempt number says whether it is
 * still current.** A repair re-dispatch re-parks the same step at the same node
 * path, so the path alone cannot distinguish a live callback from a superseded
 * one. Both checks are cheap: one indexed read, one integer comparison.
 *
 * Guarded by `validateS2SKey` at the mount, like the automations and SDLC
 * callbacks: the S2S key is the authorization, and the execution id is not
 * treated as a secret.
 */
export async function handleWorkflowClawCallback(
  req: Request<{ executionId: string }>,
  res: Response,
): Promise<void> {
  const { executionId } = req.params;
  const nodePath = typeof req.query['nodePath'] === 'string' ? req.query['nodePath'] : undefined;
  const attempt = Number(req.query['attempt']);
  // Which turn of a step's conversation this answers, when the step keeps one.
  const turn = typeof req.query['turn'] === 'string' ? Number(req.query['turn']) : undefined;
  const payload = (req.body ?? {}) as Record<string, unknown>;

  if (!nodePath || !Number.isInteger(attempt)) {
    res.status(400).json({ success: false, error: 'missing nodePath or attempt' });
    return;
  }

  try {
    // Resolve which tenant to become BEFORE opening a scope. `db` scopes every
    // read to the ambient workspace, and a callback arrives with nothing but an
    // id — the same ordering constraint the worker has.
    const execution = await findWorkflowExecutionForCallback(executionId);

    if (!execution) {
      // Not ours, or deleted mid-run. Both are legitimate; 404 so claw stops
      // retrying against a run that no longer exists.
      logger.info(
        `[workflows] claw-callback: execution ${executionId} not found or not a workflow run — ignoring`,
      );
      res.status(404).json({ success: false, error: 'execution not found' });
      return;
    }

    const outcome = await resumeWorkflowClawCallback(execution, executionId, nodePath, attempt, turn, payload);
    if (outcome.kind === 'ignored') {
      res.json({ success: true, ignored: outcome.reason });
    } else {
      res.json({ success: true });
    }
  } catch (err) {
    logger.error(
      `[workflows] claw-callback failed execution=${executionId} node=${nodePath ?? '?'}:`,
      err,
    );
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: 'failed to resume execution' });
    }
  }
}
