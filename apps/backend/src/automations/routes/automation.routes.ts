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
import { AutomationRunStatus } from '../types/status';
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
  triggerTypeToEventType,
  workflowToAutomation,
} from '../types/workflow-adapter';
import {
  getAutomationPauseState,
  getExecutionState,
  stitchExecutionContextMany,
} from '@/database/repositories/workflowExecutionStateUtils';
import { approvalService, ApprovalError } from '../services/approval.service';
import { notifyAdminsOfArchiveRequest } from '../services/approval-notifications';
import { encryptWebhookStepHeaders } from '../engine/webhook-step-encryption';
import { uploadAutomationTemplates } from '@/middleware/upload';
import { AppError } from '@/middleware/errorHandler';
import {
  AutomationTemplateInputError,
  claimAutomationTemplates,
  releaseAutomationTemplate,
  storeAutomationTemplates,
} from '../services/automation-template.service';
import {
  deskLabelRulesService,
  DeskLabelRulesPayloadSchema,
} from '../services/desk-label-rules.service';

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

const AutomationPayloadSchema = z.object({
  name: z.string().trim().min(1).optional(),
  description: z.string().nullable().optional(),
  config: z.custom<AutomationConfig>().optional(),
});

const CreateAutomationPayloadSchema = AutomationPayloadSchema.extend({
  name: z.string().trim().min(1),
  config: z.custom<AutomationConfig>(),
});

function getAuthContext(req: Request): { userId: string; workspaceId: string } | null {
  const userId = req.user?.id;
  const workspaceId = req.user?.workspaceId;
  if (!userId || !workspaceId) return null;
  return { userId, workspaceId };
}

function sendUnauthorized(res: Response): void {
  res.status(401).json({ success: false, error: 'Unauthorized' });
}

function prepareConfigForSave(
  config: AutomationConfig,
  res: Response,
): { config: AutomationConfig; context: string; eventType: ReturnType<typeof triggerTypeToEventType> } | null {
  const validation = automationService.validateConfig(config);
  if (!validation.valid) {
    res.status(400).json({ success: false, error: 'Invalid automation config', data: validation });
    return null;
  }

  const configToSave = JSON.parse(JSON.stringify(config)) as AutomationConfig;
  encryptWebhookStepHeaders(configToSave.steps);
  return {
    config: configToSave,
    context: JSON.stringify(configToSave),
    eventType: triggerTypeToEventType(configToSave.trigger.type),
  };
}

function parseListLimit(raw: unknown): number {
  const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return 50;
  return Math.min(parsed, 100);
}

function encodeAutomationListCursor(row: { id: string; createdAt: Date }): string {
  return Buffer.from(JSON.stringify({ id: row.id, createdAt: row.createdAt.toISOString() })).toString('base64url');
}

function decodeAutomationListCursor(raw: unknown): { id: string; createdAt: Date } | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as {
      id?: unknown;
      createdAt?: unknown;
    };
    if (typeof parsed.id !== 'string' || typeof parsed.createdAt !== 'string') return null;
    const createdAt = new Date(parsed.createdAt);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { id: parsed.id, createdAt };
  } catch {
    return null;
  }
}

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

// POST /desk-label-rules — create 1–2 personal ACTIVE auto-label automations (no approval)
router.post('/desk-label-rules', async (req: Request, res: Response) => {
  try {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }

    const parsed = DeskLabelRulesPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.flatten() });
      return;
    }

    const result = await deskLabelRulesService.create(parsed.data, auth);
    res.status(result.created ? 201 : 200).json({
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === 'not-found') {
      res.status(404).json({ success: false, error: (err as Error).message });
      return;
    }
    if (code === 'forbidden') {
      res.status(403).json({ success: false, error: (err as Error).message });
      return;
    }
    if (code === 'invalid') {
      res.status(400).json({
        success: false,
        error: (err as Error).message,
        data: (err as { validation?: unknown }).validation,
      });
      return;
    }
    logger.error('[automations] desk-label-rules failed:', err);
    res.status(500).json({ success: false, error: 'Failed to create desk label rules' });
  }
});

// GET /desk-label-rules — owner + desk scoped list (never syncs via Zero automationsList)
router.get('/desk-label-rules', async (req: Request, res: Response) => {
  try {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }
    const channelId =
      typeof req.query.channelId === 'string' && req.query.channelId.length > 0
        ? req.query.channelId
        : undefined;
    if (!channelId) {
      res.status(400).json({ success: false, error: 'channelId is required' });
      return;
    }
    const limit = parseListLimit(req.query.limit);
    const cursor = decodeAutomationListCursor(req.query.cursor);
    const page = await deskLabelRulesService.listOwned(auth, channelId, { limit, cursor });
    res.json({
      success: true,
      data: {
        automations: page.automations,
        counts: page.counts,
        pagination: {
          limit: page.pagination.limit,
          nextCursor: page.pagination.nextCursor
            ? encodeAutomationListCursor(page.pagination.nextCursor)
            : null,
          hasMore: page.pagination.hasMore,
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === 'not-found') {
      res.status(404).json({ success: false, error: (err as Error).message });
      return;
    }
    if (code === 'forbidden') {
      res.status(403).json({ success: false, error: (err as Error).message });
      return;
    }
    logger.error('[automations] desk-label-rules list failed:', err);
    res.status(500).json({ success: false, error: 'Failed to list desk label rules' });
  }
});

// POST /desk-label-rules/:id/backfill — replay an existing rule over older mail
router.post('/desk-label-rules/:id/backfill', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }
    const result = await deskLabelRulesService.startBackfill(req.params.id, auth);
    if (!result) {
      res.status(503).json({ success: false, error: 'Backfill queue is unavailable' });
      return;
    }
    res.status(result === 'enqueued' ? 202 : 200).json({
      success: true,
      data: { backfill: result },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === 'not-found') {
      res.status(404).json({ success: false, error: (err as Error).message });
      return;
    }
    if (code === 'forbidden') {
      res.status(403).json({ success: false, error: (err as Error).message });
      return;
    }
    if (code === 'invalid') {
      res.status(400).json({ success: false, error: (err as Error).message });
      return;
    }
    logger.error('[automations] desk-label-rules backfill failed:', err);
    res.status(500).json({ success: false, error: 'Failed to start backfill' });
  }
});

// GET /desk-label-rules/:id/backfill — progress of the latest run, null once aged out
router.get('/desk-label-rules/:id/backfill', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }
    const run = await deskLabelRulesService.getBackfillStatus(req.params.id, auth);
    res.json({
      success: true,
      data: { backfill: run },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === 'not-found') {
      res.status(404).json({ success: false, error: (err as Error).message });
      return;
    }
    if (code === 'forbidden') {
      res.status(403).json({ success: false, error: (err as Error).message });
      return;
    }
    logger.error('[automations] desk-label-rules backfill status failed:', err);
    res.status(500).json({ success: false, error: 'Failed to read backfill status' });
  }
});

const DeskLabelRuleStatusSchema = z.object({
  status: z.enum([AutomationStatus.ACTIVE, AutomationStatus.DISABLED]),
});

// PATCH /desk-label-rules/:id — owner disable/activate without AUTOMATIONS admin
router.patch('/desk-label-rules/:id', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }
    const parsed = DeskLabelRuleStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: parsed.error.flatten() });
      return;
    }
    const automation = await deskLabelRulesService.setStatus(
      req.params.id,
      parsed.data.status,
      auth,
    );
    res.json({
      success: true,
      data: { automation },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === 'not-found') {
      res.status(404).json({ success: false, error: (err as Error).message });
      return;
    }
    if (code === 'forbidden') {
      res.status(403).json({ success: false, error: (err as Error).message });
      return;
    }
    logger.error('[automations] desk-label-rules patch failed:', err);
    res.status(500).json({ success: false, error: 'Failed to update desk label rule' });
  }
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

// GET /:id/versions — full lineage (all versions) this automation belongs to, newest first
router.get('/:id/versions', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }

    // Scope by workspaceId so a user cannot read another tenant's lineage.
    const workflow = await db.workflow.findFirst({
      where: {
        id: req.params.id,
        workflowType: AUTOMATION_WORKFLOW_TYPE,
        workspaceId: auth.workspaceId,
      },
    });
    if (!workflow) {
      res.status(404).json({ success: false, error: 'Automation not found' });
      return;
    }

    const seriesId = workflow.automationSeriesId ?? workflow.id;
    const versions = (await approvalService.listLineageVersions(seriesId)).filter(
      v => v.workspaceId === auth.workspaceId,
    );
    res.json({ success: true, data: versions, timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error('[automations] list versions failed:', err);
    res.status(500).json({ success: false, error: 'Failed to list automation versions' });
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

// DELETE /:id — personal desk rules archive immediately; others raise an admin archive request
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
        workspaceId: auth.workspaceId,
        status: { not: AutomationStatus.ARCHIVED },
        workflowType: AUTOMATION_WORKFLOW_TYPE,
      },
    });
    if (existing) {
      void notifyAdminsOfArchiveRequest(workflowToAutomation(existing), auth.userId).catch(err =>
        logger.error('[automations] notifyAdminsOfArchiveRequest failed', err),
      );
      res.json({
        success: true,
        data: { message: 'Archive request submitted to admins.' },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    try {
      const archived = await deskLabelRulesService.archivePersonal(req.params.id, auth);
      res.json({
        success: true,
        data: { automation: archived, message: 'Personal desk rule archived.' },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === 'not-found' || code === 'forbidden') {
        // Do not disclose another user's personal rule through this shared endpoint.
        res.status(404).json({ success: false, error: 'Automation not found' });
        return;
      }
      throw err;
    }
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

const RUN_STATUS_FILTER_VALUES: ReadonlySet<string> = new Set(
  Object.values(AutomationRunStatus),
);

function parseEpochMsParam(value: unknown): Date | null {
  if (typeof value !== 'string' || value === '') return null;
  const ms = Number.parseInt(value, 10);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms) : null;
}

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

function safeParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

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
