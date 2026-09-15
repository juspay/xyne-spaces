import type { Request, Response } from 'express';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { runAsServiceActor, runAsSystem } from '@/database/tenant/context';
import { WORKFLOWS_TYPE } from '../constants';
import { persistence, workflowRuntime } from '../runtime';
import { readAgentDispatch } from './claw-provider';

/** Inert marker for the tenant context — only `workspaceId` is read by the stamper. */
const SERVICE_ACTOR = 'workflows-claw-callback';

/**
 * A stale callback answers 200, not an error. Claw did nothing wrong, and a
 * non-2xx would have its recovery worker redeliver a payload we are discarding
 * on purpose.
 */

/** The step statuses that represent an open gate, matching the SDK's own check. */
const PARKED = new Set(['EXTERNAL_WAIT', 'REVIEW_WAIT']);

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
  const payload = (req.body ?? {}) as Record<string, unknown>;

  if (!nodePath || !Number.isInteger(attempt)) {
    res.status(400).json({ success: false, error: 'missing nodePath or attempt' });
    return;
  }

  try {
    // Resolve which tenant to become BEFORE opening a scope. `db` scopes every
    // read to the ambient workspace, and a callback arrives with nothing but an
    // id — the same ordering constraint the worker has.
    const execution = await runAsSystem(() =>
      db.workflowExecution.findFirst({
        where: { id: executionId, workflowType: WORKFLOWS_TYPE },
        select: { workspaceId: true, createdBy: true },
      }),
    );

    if (!execution) {
      // Not ours, or deleted mid-run. Both are legitimate; 404 so claw stops
      // retrying against a run that no longer exists.
      logger.info(
        `[workflows] claw-callback: execution ${executionId} not found or not a workflow run — ignoring`,
      );
      res.status(404).json({ success: false, error: 'execution not found' });
      return;
    }

    await runAsServiceActor(SERVICE_ACTOR, execution.workspaceId, async () => {
      // One indexed read on (executionId, stepName) — the node path addresses
      // the gate directly.
      const gate = await persistence.getStep(executionId, nodePath);

      // Not parked means the run already reported and moved on: claw's recovery
      // worker re-delivering, or a duplicate POST.
      if (!gate || !PARKED.has(gate.status)) {
        logger.info(
          `[workflows] claw-callback: no open gate at ${nodePath} on execution ${executionId} `
          + '— already resumed or completed, ignoring',
        );
        res.json({ success: true, ignored: 'gate not open' });
        return;
      }

      // The gate is open, but is it still on *this* run? A repair re-dispatch
      // re-parks the same step at the same node path, so a late callback from
      // the attempt we already rejected would otherwise be accepted here and
      // the workflow would proceed on a response that failed validation.
      const parked = readAgentDispatch(gate.data);
      if (parked && parked.attempt !== attempt) {
        logger.info(
          `[workflows] claw-callback: ${nodePath} on execution ${executionId} is on attempt `
          + `${String(parked.attempt)}, callback is for ${String(attempt)} — superseded, ignoring`,
        );
        res.json({ success: true, ignored: 'superseded attempt' });
        return;
      }

      // The runtime authorizes the resume, so it needs an actor. The execution's
      // creator keeps this valid once the real authorizer replaces the interim
      // workspace-scoped one; a cron- or webhook-triggered run has no creator,
      // and the interim authorizer does not read userId.
      // TODO(phase-10): a system resume path, so this does not depend on a
      // creator that may legitimately be absent.
      await workflowRuntime.resume(
        { userId: execution.createdBy ?? '', workspaceId: execution.workspaceId },
        executionId,
        { data: { action: 'approve', data: payload }, nodePath },
      );

      logger.info(
        `[workflows] claw-callback resumed execution=${executionId} node=${nodePath} attempt=${String(attempt)}`,
      );
      res.json({ success: true });
    });
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
