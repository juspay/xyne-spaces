import { Router, type NextFunction, type Request, type Response } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { WorkflowEventType } from '@xyne/shared';
import { triggerRegistry } from '../triggers/trigger-registry';
import { matchTicketScopeFilters, type TicketScopeFilter } from '../triggers/ticket-context';
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
  parseAutomationConfig,
  parseExecutionTriggerData,
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

// ─── Debug: entity runs (auth + workspace scoped only) ────────────────────
// Lists automation runs triggered by a message/mail/ticket. The entity id
// only lives inside `context.trigger` (no indexed relation to it), so we
// narrow candidate automations by scope (step 1, safe — static config), then
// page newest-first through their executions matching each against
// `context.trigger` (steps 2+3) until `limit` matches or a row-scanned
// ceiling is hit. Also windowed to [entity `createdAt`, +1h] as a cheap
// DB-side filter, since automations fire near-instantly on creation —
// avoids scanning years of unrelated newer executions for an old entity.
// email/ticket `createdAt` can be backdated on refetch/import, so this can
// in theory skip a genuinely older run — acceptable here since this is a
// debug aid, not the automation engine itself. Matching is scoped to
// `context.trigger` specifically, not the whole context, since a step like
// CREATE_TICKET embeds the id of the entity it *produced*, not the trigger.
// Declared before `/:automationId/runs` (both 2-segment paths) so
// `:automationId` doesn't capture the literal `debug` segment.
const DEBUG_ENTITY_PAGE_SIZE = 200;
const DEBUG_ENTITY_MAX_EXAMINED = 5000; // cost backstop, not a correctness bound
const DEBUG_ENTITY_TRIGGER_WINDOW_MS = 60 * 60 * 1000; // automations fire near-instantly on the entity's own creation

type DebugEntityType = 'MESSAGE' | 'EMAIL' | 'TICKET';

const DEBUG_ENTITY_TYPES: ReadonlySet<DebugEntityType> = new Set([
  'MESSAGE',
  'EMAIL',
  'TICKET',
]);

// TICKET only covers TICKET_CREATED — no per-update id to scope updates/comments to here.
const ENTITY_EVENT_TYPES: Record<DebugEntityType, WorkflowEventType[]> = {
  MESSAGE: [WorkflowEventType.MESSAGE_RECEIVED],
  EMAIL: [WorkflowEventType.EMAIL_RECEIVED, WorkflowEventType.EMAIL_SENT],
  TICKET: [WorkflowEventType.TICKET_CREATED],
};

const ENTITY_ID_KEY: Record<DebugEntityType, string> = {
  MESSAGE: 'messageId',
  EMAIL: 'emailId',
  TICKET: 'ticketId',
};

function matchesEntityTrigger(contextRaw: string | null, type: DebugEntityType, entityId: string): boolean {
  const trigger = parseExecutionTriggerData(contextRaw)['trigger'] as Record<string, unknown> | undefined;
  return trigger?.[ENTITY_ID_KEY[type]] === entityId;
}

function parseDebugEntityType(raw: unknown): DebugEntityType | null {
  return typeof raw === 'string' && DEBUG_ENTITY_TYPES.has(raw as DebugEntityType)
    ? (raw as DebugEntityType)
    : null;
}

interface DebugEntityScopeFacts {
  channelId: string | null;
  projectId: string | null;
  boardId: string | null;
  createdAt: Date;
}

// One indexed PK lookup per type — just channel/project/board, for scope narrowing.
async function fetchEntityScopeFacts(
  type: DebugEntityType,
  id: string,
): Promise<DebugEntityScopeFacts | null> {
  if (type === 'MESSAGE') {
    // Message has no channelId of its own — resolve via its conversation.
    const m = await db.message.findUnique({ where: { messageId: id }, select: { conversationId: true, createdAt: true } });
    if (!m) return null;
    const conversation = await db.conversation.findUnique({
      where: { conversationId: m.conversationId },
      select: { channelId: true },
    });
    return { channelId: conversation?.channelId ?? null, projectId: null, boardId: null, createdAt: m.createdAt };
  }
  if (type === 'EMAIL') {
    const e = await db.email.findUnique({ where: { id }, select: { channelId: true, createdAt: true } });
    return e ? { channelId: e.channelId, projectId: null, boardId: null, createdAt: e.createdAt } : null;
  }
  const t = await db.ticket.findUnique({
    where: { id },
    select: { channelId: true, projectId: true, boardId: true, createdAt: true },
  });
  return t ? { channelId: t.channelId, projectId: t.projectId, boardId: t.boardId, createdAt: t.createdAt } : null;
}

// Does this automation's own scope config even reach this entity? Ticket
// triggers reuse the engine's own matchTicketScopeFilters; message/email
// triggers only ever scope by channelIds.
function workflowMatchesEntityScope(
  type: DebugEntityType,
  triggerConfig: Record<string, unknown>,
  facts: DebugEntityScopeFacts,
): boolean {
  if (type === 'TICKET') {
    return matchTicketScopeFilters(triggerConfig as TicketScopeFilter, {
      channelId: facts.channelId,
      projectId: facts.projectId,
      boardId: facts.boardId,
    });
  }
  const channelIds = Array.isArray(triggerConfig['channelIds'])
    ? (triggerConfig['channelIds'] as unknown[]).filter((v): v is string => typeof v === 'string' && v.length > 0)
    : [];
  return channelIds.length === 0 || (!!facts.channelId && channelIds.includes(facts.channelId));
}

interface DebugRunRow {
  id: string;
  automationId: string;
  automationName: string | null;
  automationStatus: string | null;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
}

function toDebugRunRow(
  exec: { id: string; workflowId: string; status: string; createdAt: Date; updatedAt: Date },
  workflow: { workflowName: string | null; status: string } | undefined,
): DebugRunRow {
  const inProgress =
    exec.status === AutomationRunStatus.RUNNING ||
    exec.status === AutomationRunStatus.SCHEDULED ||
    exec.status === 'EXTERNAL_WAIT';
  return {
    id: exec.id,
    automationId: exec.workflowId,
    automationName: workflow?.workflowName ?? null,
    automationStatus: workflow?.status ?? null,
    status: exec.status,
    startedAt: exec.createdAt,
    completedAt: inProgress ? null : exec.updatedAt,
  };
}

router.get('/debug/runs', async (req: Request, res: Response) => {
  try {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }

    const type = parseDebugEntityType(req.query['type']);
    if (!type) {
      res.status(400).json({ success: false, error: '`type` (MESSAGE|EMAIL|TICKET) is required' });
      return;
    }
    const entityId = typeof req.query['id'] === 'string' ? (req.query['id'] as string) : null;
    if (!entityId) {
      res.status(400).json({ success: false, error: '`id` is required' });
      return;
    }

    const limit = parseListLimit(req.query['limit']);

    // Deleted/missing entity → no scope facts → step 1 stays unscoped.
    const scopeFacts = await fetchEntityScopeFacts(type, entityId);

    const candidateWorkflows = await db.workflow.findMany({
      where: {
        workspaceId: auth.workspaceId,
        workflowType: AUTOMATION_WORKFLOW_TYPE,
        eventType: { in: ENTITY_EVENT_TYPES[type] },
      },
      select: { id: true, workflowName: true, status: true, context: true },
    });
    const workflows = scopeFacts
      ? candidateWorkflows.filter(w => {
          try {
            return workflowMatchesEntityScope(type, parseAutomationConfig(w.context).trigger.config, scopeFacts);
          } catch {
            return true; // malformed config on a legacy automation — fail open, don't 500
          }
        })
      : candidateWorkflows;
    if (workflows.length === 0) {
      res.json({ success: true, data: { runs: [] }, timestamp: new Date().toISOString() });
      return;
    }
    const workflowById = new Map(workflows.map(w => [w.id, w]));
    const workflowIds = [...workflowById.keys()];

    // Fast path: WorkflowStep rows stamp entityType/entityId at execution time (see
    // AutomationExecutor.upsertStepRow), so this is an indexed lookup instead of a scan.
    // Falls through to the scan below for rows written before that stamping existed, or
    // for trigger types with no natural entity id (e.g. WEBHOOK).
    const fastExecs = await db.workflowExecution.findMany({
      where: {
        workflowId: { in: workflowIds },
        workflowSteps: {
          some: {
            workspaceId: auth.workspaceId,
            entityType: { in: ENTITY_EVENT_TYPES[type] },
            entityId,
          },
        },
      },
      select: { id: true, workflowId: true, status: true, createdAt: true, updatedAt: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    if (fastExecs.length > 0) {
      res.json({
        success: true,
        data: {
          runs: fastExecs.map(exec => toDebugRunRow(exec, workflowById.get(exec.workflowId))),
        },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const runs: DebugRunRow[] = [];
    // Try the windowed fast path first (covers near-instant triggers); if it
    // finds nothing, fall back to an unwindowed scan for stragglers like
    // reruns or backfills, whose execution createdAt isn't near the entity's.
    for (const useWindow of scopeFacts ? [true, false] : [false]) {
      if (runs.length > 0) break;
      const windowFilter =
        useWindow && scopeFacts
          ? {
              gte: scopeFacts.createdAt,
              lte: new Date(scopeFacts.createdAt.getTime() + DEBUG_ENTITY_TRIGGER_WINDOW_MS),
            }
          : null;
      const dir = useWindow ? 'asc' : 'desc'; // windowed pass reads forward from the trigger moment
      const cmp = useWindow ? 'gt' : 'lt';
      let cursor: { createdAt: Date; id: string } | null = null;
      let examined = 0;

      while (runs.length < limit && examined < DEBUG_ENTITY_MAX_EXAMINED) {
        const where: Prisma.WorkflowExecutionWhereInput = {
          workflowId: { in: workflowIds },
          ...(windowFilter ? { createdAt: windowFilter } : {}),
          ...(cursor
            ? { OR: [{ createdAt: { [cmp]: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { [cmp]: cursor.id } }] }
            : {}),
        };
        const page = await db.workflowExecution.findMany({
          where,
          select: { id: true, workflowId: true, status: true, createdAt: true, updatedAt: true },
          orderBy: [{ createdAt: dir }, { id: dir }],
          take: DEBUG_ENTITY_PAGE_SIZE,
        });
        if (page.length === 0) break;
        examined += page.length;
        const lastRow = page[page.length - 1];
        if (!lastRow) break;
        cursor = { createdAt: lastRow.createdAt, id: lastRow.id };

        const states = await db.workflowExecutionState.findMany({
          where: { workflowExecutionId: { in: page.map(e => e.id) } },
          select: { workflowExecutionId: true, context: true },
        });
        const contextById = new Map(states.map(s => [s.workflowExecutionId, s.context]));

        for (const exec of page) {
          if (runs.length >= limit) break;
          if (matchesEntityTrigger(contextById.get(exec.id) ?? null, type, entityId)) {
            runs.push(toDebugRunRow(exec, workflowById.get(exec.workflowId)));
          }
        }

        if (page.length < DEBUG_ENTITY_PAGE_SIZE) break; // exhausted every execution for these workflows
      }
    }

    res.json({ success: true, data: { runs }, timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error('[automations] debug/runs failed:', err);
    res.status(500).json({ success: false, error: 'Failed to list debug runs' });
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
