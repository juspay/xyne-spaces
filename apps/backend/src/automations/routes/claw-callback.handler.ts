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
        select: { data: true },
      }),
      db.workflowExecution.findUniqueOrThrow({
        where: { id: executionId },
        select: { workspaceId: true },
      }),
    ]);
    if (!existingRow) {
      logger.warn(
        `[automations] claw-callback: no workflow_step row for execution=${executionId} step=${stepName} — proceeding with empty existing data`,
      );
    }

    const existing = parseRowData(existingRow?.data);
    const merged = { ...existing, agentRawResult: payload };

    await db.workflowStep.upsert({
      where: { workflowExecutionId_stepName: { workflowExecutionId: executionId, stepName } },
      create: {
        workflowExecutionId: executionId,
        stepName,
        stepExecutorType: 'RUN_AGENT',
        status: 'EXTERNAL_WAIT',
        data: JSON.stringify(merged),
        workspaceId: workflowExecution.workspaceId,
      },
      update: {
        data: JSON.stringify(merged),
      },
    });

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
