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
    const existingRow = await db.workflowStep.findUnique({
      where: { workflowExecutionId_stepName: { workflowExecutionId: executionId, stepName } },
      select: { data: true },
    });
    if (!existingRow) {
      logger.warn(
        `[automations] claw-callback: no dispatched step for execution=${executionId} step=${stepName} — refusing`,
      );
      res.status(404).json({ success: false, error: 'no dispatched step for this callback' });
      return;
    }

    const existing = parseRowData(existingRow.data);
    if (existing['agentRawResult'] !== undefined) {
      logger.info(
        `[automations] claw-callback: execution=${executionId} step=${stepName} already answered — ignoring`,
      );
      res.json({ success: true, ignored: 'already answered' });
      return;
    }
    const merged = { ...existing, agentRawResult: payload };

    await db.workflowStep.update({
      where: { workflowExecutionId_stepName: { workflowExecutionId: executionId, stepName } },
      data: { data: JSON.stringify(merged) },
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
