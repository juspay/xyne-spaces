import type { Request, Response } from 'express';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { automationQueue } from '../queue/automation.queue';

export async function handleClawCallback(
  req: Request<{ executionId: string; stepName: string }>,
  res: Response,
): Promise<void> {
  const { executionId, stepName } = req.params;
  const payload = (req.body ?? {}) as Record<string, unknown>;

  try {
    const [existingRow, workflowExecution] = await Promise.all([
      db.workflowStep.findUnique({
        where: { workflowExecutionId_stepName: { workflowExecutionId: executionId, stepName } },
        select: { data: true, status: true },
      }),
      db.workflowExecution.findUniqueOrThrow({
        where: { id: executionId },
        select: { status: true },
      }),
    ]);
    if (!existingRow) {
      logger.error(
        `[automations] claw-callback: no workflow_step row for execution=${executionId} step=${stepName}`,
      );
      res.status(409).json({ success: false, error: 'waiting automation step not found' });
      return;
    }
    if (
      existingRow.status === 'COMPLETED' ||
      ['COMPLETED', 'FAILED', 'CANCELLED', 'SKIPPED'].includes(workflowExecution.status)
    ) {
      logger.info(
        `[automations] claw-callback ignored duplicate/stale payload execution=${executionId} step=${stepName}`,
      );
      res.json({ success: true, duplicate: true });
      return;
    }

    const existing = parseRowData(existingRow.data);
    const merged = { ...existing, agentRawResult: payload };

    await db.workflowStep.update({
      where: { workflowExecutionId_stepName: { workflowExecutionId: executionId, stepName } },
      data: { data: JSON.stringify(merged) },
    });

    await automationQueue.enqueueRun({ executionId, resumeStepName: stepName });

    logger.info(
      `[automations] claw-callback stored payload + enqueued resume execution=${executionId} step=${stepName}`,
    );
    res.json({ success: true });
  } catch (err) {
    logger.error(
      `[automations] claw-callback failed execution=${executionId} step=${stepName}:`,
      err,
    );
    res.status(500).json({ success: false, error: 'failed to persist callback' });
  }
}

function parseRowData(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('step data is not a JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `waiting step data is invalid: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
