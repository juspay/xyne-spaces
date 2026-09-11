import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { triggerRegistry } from '../triggers/trigger-registry';
import { stepRegistry } from '../steps/step-registry';
import { ConditionOperator } from '../types/operators';
import { automationService } from '../services/automation.service';
import {
  issueWebhookSecret,
  webhookSecretExists,
} from '../services/webhook-secret.service';
import { WEBHOOK_EVENT } from '../triggers/webhook.trigger';
import type { AutomationConfig } from '../types/automation-config';
import { clawClient } from '../services/claw-client';
import { config } from '@/config/env';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { AutomationStatus } from '../types/status';
import {
  workflowExecutionToRun,
  workflowExecutionToRunSummary,
  AUTOMATION_WORKFLOW_TYPE,
  buildAutomationMetadata,
  workflowToAutomation,
} from '../types/workflow-adapter';
import {
  getAutomationPauseState,
  getExecutionState,
  stitchExecutionContextMany,
} from '@/database/repositories/workflowExecutionStateUtils';
import { approvalService, ApprovalError } from '../services/approval.service';
import { notifyAdminsOfArchiveRequest } from '../services/approval-notifications';
import { uploadAutomationTemplates } from '@/middleware/upload';
import { AppError } from '@/middleware/errorHandler';
import {
  AutomationTemplateInputError,
  claimAutomationTemplates,
  releaseAutomationTemplate,
  storeAutomationTemplates,
} from '../services/automation-template.service';
import {
  AutomationPayloadSchema,
  CreateAutomationPayloadSchema,
  decodeAutomationListCursor,
  encodeAutomationListCursor,
  getAuthContext,
  parseEpochMsParam,
  parseListLimit,
  prepareConfigForSave,
  RUN_STATUS_FILTER_VALUES,
  safeParseJson,
  sendUnauthorized,
} from './automation-route-helpers';

const router = Router();

router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  next();
});

const OPERATOR_METADATA: Record<
  ConditionOperator,
  { label: string; valueType: 'string' | 'number' | 'boolean' | 'none' | 'tag' }
> = {
  [ConditionOperator.EQ]: { label: 'equals', valueType: 'string' },
  [ConditionOperator.NEQ]: { label: 'does not equal', valueType: 'string' },
  [ConditionOperator.CONTAINS]: { label: 'contains', valueType: 'string' },
  [ConditionOperator.GT]: { label: 'is greater than', valueType: 'number' },
  [ConditionOperator.GTE]: { label: 'is greater than or equal to', valueType: 'number' },
  [ConditionOperator.LT]: { label: 'is less than', valueType: 'number' },
  [ConditionOperator.LTE]: { label: 'is less than or equal to', valueType: 'number' },
  [ConditionOperator.EXISTS]: { label: 'exists', valueType: 'none' },
  [ConditionOperator.HAS_TAG]: { label: 'has tag', valueType: 'tag' },
};

router.get('/schema/operators', (_req, res) => {
  const list = Object.entries(OPERATOR_METADATA).map(([value, meta]) => ({ value, ...meta }));
  res.json({ success: true, data: list, timestamp: new Date().toISOString() });
});

router.post(
  '/attachments',
  uploadAutomationTemplates,
  async (req: Request, res: Response, next: NextFunction) => {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }
    try {
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      const stepId = typeof req.body?.stepId === 'string' ? req.body.stepId : '';
      const attachments = await storeAutomationTemplates({
        files,
        stepId,
        userId: auth.userId,
        workspaceId: auth.workspaceId,
      });
      res.json({ success: true, data: attachments, timestamp: new Date().toISOString() });
    } catch (error) {
      if (error instanceof AutomationTemplateInputError) {
        res.status(error.statusCode).json({ success: false, error: error.message });
        return;
      }
      logger.error('[automations] template attachment upload failed', error);
      next(new AppError('Failed to upload template attachment', 500));
    }
  },
);

router.delete(
  '/attachments/:attachmentId',
  async (req: Request<{ attachmentId: string }>, res: Response, next: NextFunction) => {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }
    try {
      const removed = await releaseAutomationTemplate({
        attachmentId: req.params.attachmentId,
        workspaceId: auth.workspaceId,
      });
      res.json({ success: true, data: { removed }, timestamp: new Date().toISOString() });
    } catch (error) {
      logger.error('[automations] template attachment release failed', error);
      next(new AppError('Failed to release template attachment', 500));
    }
  },
);

router.get('/schema/triggers', (_req, res) => {
  res.json({
    success: true,
    data: triggerRegistry.listMetadata(),
    timestamp: new Date().toISOString(),
  });
});

router.get('/schema/triggers/:type', (req: Request, res: Response) => {
  const { type } = req.params;
  if (!type || !triggerRegistry.has(type)) {
    res.status(404).json({ success: false, error: `Unknown trigger type "${type}"` });
    return;
  }
  const impl = triggerRegistry.get(type);
  const rawConfig = zodToJsonSchema(impl.configSchema as z.ZodSchema, { name: 'config' }) as Record<
    string,
    unknown
  >;
  res.json({
    success: true,
    data: {
      type: impl.type,
      name: impl.name,
      description: impl.description,
      category: impl.category,
      icon: impl.icon,
      configSchema: impl.decorateConfigSchema(rawConfig),
      outputSchema: zodToJsonSchema(impl.outputSchema as z.ZodSchema, { name: 'output' }),
      ...(impl.type === WEBHOOK_EVENT ? { webhookUrl: webhookEndpoint() } : {}),
    },
    timestamp: new Date().toISOString(),
  });
});

router.get('/schema/steps', (_req, res) => {
  res.json({
    success: true,
    data: stepRegistry.listMetadata(),
    timestamp: new Date().toISOString(),
  });
});

router.get('/schema/steps/:type', (req: Request, res: Response) => {
  const { type } = req.params;
  if (!type || !stepRegistry.has(type)) {
    res.status(404).json({ success: false, error: `Unknown step type "${type}"` });
    return;
  }
  const impl = stepRegistry.get(type);
  res.json({
    success: true,
    data: {
      type: impl.type,
      kind: impl.kind,
      name: impl.name,
      description: impl.description,
      category: impl.category,
      icon: impl.icon,
      configSchema: zodToJsonSchema(impl.configSchema as z.ZodSchema, { name: 'config' }),
      outputSchema: zodToJsonSchema(impl.outputSchema as z.ZodSchema, { name: 'output' }),
    },
    timestamp: new Date().toISOString(),
  });
});

router.post('/validate', (req: Request, res: Response) => {
  const body = req.body as { config?: AutomationConfig };
  if (!body?.config) {
    res.status(400).json({ success: false, error: 'Missing `config` in request body' });
    return;
  }
  const result = automationService.validateConfig(body.config);
  res.json({ success: true, data: result, timestamp: new Date().toISOString() });
});

// POST / — create a new automation as DRAFT (no activation)
router.post('/', async (req: Request, res: Response) => {
  try {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }

    const parsed = CreateAutomationPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.flatten() });
      return;
    }

    const prepared = prepareConfigForSave(parsed.data.config, res);
    if (!prepared) return;

    const workflow = await db.$transaction(async tx => {
      await claimAutomationTemplates(tx, prepared.config, auth.workspaceId);
      return tx.workflow.create({
        data: {
          workflowType: AUTOMATION_WORKFLOW_TYPE,
          workflowName: parsed.data.name,
          workspaceId: auth.workspaceId,
          status: AutomationStatus.DRAFT,
          eventType: prepared.eventType,
          context: prepared.context,
          metadata: buildAutomationMetadata({
            description: parsed.data.description ?? null,
            createdById: auth.userId,
          }),
        },
      });
    });
    res.status(201).json({
      success: true,
      data: { automation: workflowToAutomation(workflow) },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    if (err instanceof AutomationTemplateInputError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    logger.error('[automations] create failed:', err);
    res.status(500).json({ success: false, error: 'Failed to create automation' });
  }
});

// GET / — list automations using the same base query as Zero automationsList
router.get('/', async (req: Request, res: Response) => {
  try {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }

    const limit = parseListLimit(req.query.limit);
    const cursor = decodeAutomationListCursor(req.query.cursor);

    const workflows = await db.workflow.findMany({
      where: {
        workflowType: AUTOMATION_WORKFLOW_TYPE,
        workspaceId: auth.workspaceId,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const hasMore = workflows.length > limit;
    const page = hasMore ? workflows.slice(0, limit) : workflows;
    res.json({
      success: true,
      data: page.map(workflowToAutomation),
      pagination: {
        limit,
        nextCursor: hasMore && page.length > 0 ? encodeAutomationListCursor(page[page.length - 1]) : null,
        hasMore,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('[automations] list failed:', err);
    res.status(500).json({ success: false, error: 'Failed to list automations' });
  }
});

// GET /:id — fetch a single automation
router.get('/:id', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }

    const workflow = await db.workflow.findFirst({
      where: {
        id: req.params.id,
        workflowType: AUTOMATION_WORKFLOW_TYPE,
        workspaceId: auth.workspaceId,
        status: { not: AutomationStatus.ARCHIVED },
      },
    });
    if (!workflow) {
      res.status(404).json({ success: false, error: 'Automation not found' });
      return;
    }
    res.json({ success: true, data: workflowToAutomation(workflow), timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error('[automations] get failed:', err);
    res.status(500).json({ success: false, error: 'Failed to get automation' });
  }
});

// PUT /:id — create a new DRAFT version in the same lineage (automationSeriesId preserved)
router.put('/:id', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }

    const parsed = AutomationPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.flatten() });
      return;
    }

    const existing = await db.workflow.findFirst({
      where: {
        id: req.params.id,
        workflowType: AUTOMATION_WORKFLOW_TYPE,
        workspaceId: auth.workspaceId,
        status: { not: AutomationStatus.ARCHIVED },
      },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Automation not found' });
      return;
    }

    const existingAutomation = workflowToAutomation(existing);
    const prepared = parsed.data.config !== undefined
      ? prepareConfigForSave(parsed.data.config, res)
      : null;
    if (parsed.data.config !== undefined && !prepared) return;

    const metadata = buildAutomationMetadata({
      description: parsed.data.description !== undefined
        ? parsed.data.description
        : (existingAutomation.description ?? null),
      createdById: existing.status === AutomationStatus.DRAFT && existingAutomation.createdById === auth.userId
        ? existingAutomation.createdById
        : auth.userId,
    });

    if (existing.status === AutomationStatus.DRAFT && existingAutomation.createdById === auth.userId) {
      const updated = await db.$transaction(async tx => {
        if (prepared) await claimAutomationTemplates(tx, prepared.config, auth.workspaceId);
        return tx.workflow.update({
          where: { id: existing.id },
          data: {
            ...(parsed.data.name !== undefined && { workflowName: parsed.data.name }),
            ...(prepared && {
              context: prepared.context,
              eventType: prepared.eventType,
            }),
            metadata,
            updatedAt: new Date(),
          },
        });
      });
      res.json({
        success: true,
        data: { automation: workflowToAutomation(updated) },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Create a new DRAFT version in the same lineage; do not mutate approved/live rows.
    const seriesId = existing.automationSeriesId ?? existing.id;
    const newVersion = await db.$transaction(async tx => {
      if (prepared) await claimAutomationTemplates(tx, prepared.config, auth.workspaceId);
      return tx.workflow.create({
        data: {
          workflowType: AUTOMATION_WORKFLOW_TYPE,
          workflowName: parsed.data.name ?? existing.workflowName,
          workspaceId: auth.workspaceId,
          status: AutomationStatus.DRAFT,
          automationSeriesId: seriesId,
          context: prepared ? prepared.context : existing.context,
          ...(prepared && { eventType: prepared.eventType }),
          metadata,
        },
      });
    });

    res.status(201).json({
      success: true,
      data: { automation: workflowToAutomation(newVersion) },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    if (err instanceof AutomationTemplateInputError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    logger.error('[automations] update failed:', err);
    res.status(500).json({ success: false, error: 'Failed to create automation version' });
  }
});

// POST /:id/submit — submit DRAFT for approval; DMs all AUTOMATIONS admins
router.post('/:id/submit', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }

    const view = await approvalService.submitForApproval(req.params.id, auth.userId);
    res.json({ success: true, data: { automation: view }, timestamp: new Date().toISOString() });
  } catch (err) {
    if (err instanceof ApprovalError) {
      const status = err.code === 'not-found' ? 404
        : err.code === 'not-owner' || err.code === 'not-admin' ? 403
        : 409;
      res.status(status).json({ success: false, error: err.message });
      return;
    }
    logger.error('[automations] submit failed:', err);
    res.status(500).json({ success: false, error: 'Failed to submit automation for approval' });
  }
});

// DELETE /:id — raise an archive request to admins via DM; does not archive directly
router.delete('/:id', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }

    const existing = await db.workflow.findFirst({
      where: {
        id: req.params.id,
        workflowType: AUTOMATION_WORKFLOW_TYPE,
        workspaceId: auth.workspaceId,
        status: { not: AutomationStatus.ARCHIVED },
      },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Automation not found' });
      return;
    }

    void notifyAdminsOfArchiveRequest(workflowToAutomation(existing), auth.userId).catch(err =>
      logger.error('[automations] notifyAdminsOfArchiveRequest failed', err),
    );
    res.json({
      success: true,
      data: { message: 'Archive request submitted to admins.' },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('[automations] delete failed:', err);
    res.status(500).json({ success: false, error: 'Failed to submit archive request' });
  }
});

router.get('/claw/agents', async (_req: Request, res: Response) => {
  try {
    const agents = await clawClient.listAgents();
    res.json({ success: true, data: agents, timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error('[automations] /claw/agents failed:', err);
    res
      .status(502)
      .json({
        success: false,
        error: 'Failed to fetch claw agents',
        detail: err instanceof Error ? err.message : String(err),
      });
  }
});

router.get(
  '/:automationId/runs',
  async (req: Request<{ automationId: string }>, res: Response) => {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }
    const { automationId } = req.params;
    const limitRaw = req.query['limit'];
    const limit = Math.min(Math.max(Number.parseInt(String(limitRaw ?? 50), 10) || 50, 1), 200);
    const cursor = typeof req.query['cursor'] === 'string' ? (req.query['cursor'] as string) : null;
    const statusRaw = req.query['status'];
    const status =
      typeof statusRaw === 'string' && RUN_STATUS_FILTER_VALUES.has(statusRaw) ? statusRaw : null;
    const from = parseEpochMsParam(req.query['from']);
    const to = parseEpochMsParam(req.query['to']);

    // Scope by workspaceId so a user cannot read another tenant's run history.
    const workflow = await db.workflow.findFirst({
      where: {
        id: automationId,
        workflowType: AUTOMATION_WORKFLOW_TYPE,
        workspaceId: auth.workspaceId,
      },
    });
    if (!workflow) {
      res.status(404).json({ success: false, error: 'Automation not found' });
      return;
    }

    const rows = await db.workflowExecution.findMany({
      where: {
        workflowId: automationId,
        ...(status ? { status } : {}),
        ...(from || to
          ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
          : {}),
      },
      select: {
        id: true,
        workflowId: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;

    const stitched = await stitchExecutionContextMany(page);

    res.json({
      success: true,
      data: {
        runs: stitched.map(row =>
          workflowExecutionToRunSummary(row, { context: row.context }),
        ),
        nextCursor,
      },
      timestamp: new Date().toISOString(),
    });
  },
);

router.get(
  '/runs/:executionId',
  async (req: Request<{ executionId: string }>, res: Response) => {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }
    const { executionId } = req.params;

    // Scope by workspaceId so a user cannot read another tenant's run detail.
    const execution = await db.workflowExecution.findFirst({
      where: {
        id: executionId,
        workflowType: AUTOMATION_WORKFLOW_TYPE,
        workspaceId: auth.workspaceId,
      },
    });
    if (!execution) {
      res.status(404).json({ success: false, error: 'Run not found' });
      return;
    }

    const [state, pauseState, stepRows] = await Promise.all([
      getExecutionState(executionId),
      getAutomationPauseState(executionId),
      db.workflowStep.findMany({
        where: { workflowExecutionId: executionId },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    res.json({
      success: true,
      data: {
        run: workflowExecutionToRun(execution, state),
        state: pauseState,
        steps: stepRows.map(r => ({
          id: r.id,
          stepName: r.stepName,
          status: r.status,
          data: r.data ? safeParseJson(r.data) : null,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        })),
      },
      timestamp: new Date().toISOString(),
    });
  },
);

function webhookEndpoint(): string {
  return `${config.backendUrl.replace(/\/$/, '')}/api/automation-webhooks`;
}

async function resolveWebhookAutomation(
  automationId: string,
  workspaceId: string,
): Promise<{ seriesId: string } | { error: { status: number; message: string } }> {
  // Scope by workspaceId so an authenticated user in one workspace cannot resolve
  // (and mint/read the webhook secret for) an automation owned by another workspace.
  const workflow = await db.workflow.findFirst({
    where: {
      id: automationId,
      workflowType: AUTOMATION_WORKFLOW_TYPE,
      workspaceId,
    },
  });
  if (!workflow) {
    return { error: { status: 404, message: 'Automation not found' } };
  }
  return { seriesId: workflow.automationSeriesId ?? workflow.id };
}

// Read-only: the token is shown only once at creation, so this returns just
// whether a secret has been issued (never the token itself).
router.get(
  '/:automationId/webhook',
  async (req: Request<{ automationId: string }>, res: Response) => {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }
    const resolved = await resolveWebhookAutomation(req.params.automationId, auth.workspaceId);
    if ('error' in resolved) {
      res.status(resolved.error.status).json({ success: false, error: resolved.error.message });
      return;
    }
    res.json({
      success: true,
      data: {
        url: `${webhookEndpoint()}/${resolved.seriesId}`,
        issued: await webhookSecretExists(resolved.seriesId),
      },
      timestamp: new Date().toISOString(),
    });
  },
);

router.post(
  '/:automationId/webhook',
  async (req: Request<{ automationId: string }>, res: Response) => {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }
    const resolved = await resolveWebhookAutomation(req.params.automationId, auth.workspaceId);
    if ('error' in resolved) {
      res.status(resolved.error.status).json({ success: false, error: resolved.error.message });
      return;
    }
    const secret = await issueWebhookSecret(resolved.seriesId);
    res.json({
      success: true,
      data: {
        url: secret ? `${webhookEndpoint()}/${resolved.seriesId}/${secret}` : null,
        alreadyIssued: secret === null,
      },
      timestamp: new Date().toISOString(),
    });
  },
);

export default router;
