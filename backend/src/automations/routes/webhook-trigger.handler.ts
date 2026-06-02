import { Router, type Request, type Response } from 'express';
import { WorkflowEventType } from '@prisma/client';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { automationQueue } from '../queue/automation.queue';
import { storedSecretMatches } from '../services/webhook-secret.service';
import { assertMatchesSchema } from '../engine/declared-schema';
import { isSensitiveHeader } from '../engine/webhook-step-encryption';
import { AutomationStatus, AutomationRunStatus } from '../types/status';
import {
  AUTOMATION_WORKFLOW_TYPE,
  parseAutomationConfig,
  parseAutomationMetadata,
} from '../types/workflow-adapter';
import { WEBHOOK_EVENT } from '../triggers/webhook.trigger';

const router = Router();

const DROPPED_HEADERS = new Set(['authorization', 'cookie']);

function collectHeaders(req: Request, marked: string[] | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (DROPPED_HEADERS.has(k.toLowerCase())) continue;
    out[k] = isSensitiveHeader(k, marked) ? '[REDACTED]' : v;
  }
  return out;
}

router.post(
  '/:seriesId/:secret',
  async (req: Request<{ seriesId: string; secret: string }>, res: Response): Promise<void> => {
    const { seriesId, secret } = req.params;

    const workflow = await db.workflow.findFirst({
      where: {
        automationSeriesId: seriesId,
        workflowType: AUTOMATION_WORKFLOW_TYPE,
        eventType: WorkflowEventType.WEBHOOK,
        status: AutomationStatus.ACTIVE,
      },
    });
    if (!workflow) {
      res
        .status(404)
        .json({ success: false, error: 'No active webhook automation for this URL' });
      return;
    }
    // Confirm the secret matches the one stored (encrypted) for this series —
    // timing-safe, and rotating it immediately invalidates old URLs.
    if (!(await storedSecretMatches(seriesId, secret))) {
      res.status(401).json({ success: false, error: 'Invalid webhook secret' });
      return;
    }

    const config = parseAutomationConfig(workflow.context);
    const triggerConfig = (config.trigger.config ?? {}) as {
      bodySchema?: Record<string, unknown>;
      headerSchema?: Record<string, unknown>;
    };
    const headerSchema = triggerConfig.headerSchema ?? {};
    const markedSecretHeaders = Object.keys(headerSchema).filter(
      k => headerSchema[k] === 'secret',
    );

    const body =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};
    const headers = collectHeaders(req, markedSecretHeaders);

    try {
      assertMatchesSchema(body, triggerConfig.bodySchema ?? {});
      assertMatchesSchema(req.headers as Record<string, unknown>, lowercaseKeys(headerSchema));
    } catch (err) {
      res.status(400).json({
        success: false,
        error: `Payload does not match the declared schema: ${err instanceof Error ? err.message : String(err)}`,
      });
      return;
    }

    const metadata = parseAutomationMetadata(workflow.metadata);
    const payload = { body, headers, receivedAt: new Date().toISOString() };
    const initialContext = {
      automation: {
        id: workflow.id,
        workspaceId: workflow.workspaceId,
        createdById: metadata.createdById,
      },
      trigger: { type: WEBHOOK_EVENT, ...payload, data: payload },
      steps: {},
      __meta: { error: null, chain: [] },
    };

    const execution = await db.$transaction(async tx => {
      const created = await tx.workflowExecution.create({
        data: {
          workflowId: workflow.id,
          workflowType: AUTOMATION_WORKFLOW_TYPE,
          status: AutomationRunStatus.PENDING,
          tag: 'root',
        },
      });
      await tx.workflowExecutionState.create({
        data: {
          workflowExecutionId: created.id,
          context: JSON.stringify(initialContext),
        },
      });
      return created;
    });

    await automationQueue.enqueueRun({ executionId: execution.id });
    logger.info(
      `[webhook-trigger] automation=${workflow.id} execution=${execution.id} accepted`,
    );

    res.status(202).json({ success: true, executionId: execution.id });
  },
);

function lowercaseKeys(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) out[k.toLowerCase()] = v;
  return out;
}

export default router;
