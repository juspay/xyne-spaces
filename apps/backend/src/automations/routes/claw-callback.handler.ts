import type { Request, Response } from 'express';
import { logger } from '@/utils/logger';
import { db } from '@/database/client';
import { automationQueue } from '../queue/automation.queue';
import { AutomationRunStatus } from '../types/status';

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
        select: { data: true },
      }),
      db.workflowExecution.findUniqueOrThrow({
        where: { id: executionId },
        select: { status: true },
      }),
    ]);
    if (
      [
        AutomationRunStatus.COMPLETED,
        AutomationRunStatus.FAILED,
        AutomationRunStatus.CANCELLED,
        AutomationRunStatus.SKIPPED,
      ].includes(workflowExecution.status as AutomationRunStatus)
    ) {
      logger.warn(
        `[automations] claw-callback: ignoring callback for execution=${executionId} status=${workflowExecution.status}`,
      );
      res.json({ success: true, ignored: 'execution_terminal' });
      return;
    }

    if (!existingRow) {
      logger.warn(
        `[automations] claw-callback: ignoring unknown step execution=${executionId} step=${stepName}`,
      );
      res.json({ success: true, ignored: 'unknown_step' });
      return;
    }

    const existing = parseRowData(existingRow.data);
    if (existing.agentRawResult !== undefined) {
      logger.info(
        `[automations] claw-callback: duplicate ignored execution=${executionId} step=${stepName}`,
      );
      res.json({ success: true, duplicate: true });
      return;
    }

    const merged = { ...existing, agentRawResult: payload };
    const updated = await db.workflowStep.updateMany({
      where: {
        workflowExecutionId: executionId,
        stepName,
        data: existingRow.data,
      },
      data: { data: JSON.stringify(merged) },
    });
    if (updated.count === 0) {
      logger.info(
        `[automations] claw-callback: concurrent duplicate ignored execution=${executionId} step=${stepName}`,
      );
      res.json({ success: true, duplicate: true });
      return;
    }

    await automationQueue.enqueueRun({ executionId });

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
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
