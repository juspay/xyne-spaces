import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { automationService } from '../services/automation.service';
import type { AutomationConfig } from '../types/automation-config';
import { AutomationRunStatus, AutomationStatus } from '../types/status';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
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
import { encryptWebhookStepHeaders } from '../engine/webhook-step-encryption';
import {
  AutomationTemplateInputError,
  claimAutomationTemplates,
} from '../services/automation-template.service';

/**
 * Claw-facing automation management routes.
 *
 * Mounted under /api/automations/claw and gated by authenticateUserOrApp,
 * so both regular user tokens and agent app tokens can manage automations
 * programmatically (headless / no UI required).
 *
 * This intentionally mirrors the create/list/get/update/run-history surface of
 * /api/automations, but strips out schema/metadata/template/webhook endpoints
 * that are not needed for headless CRUD.
 */

const router = Router();

router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  next();
});

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

const RUN_STATUS_FILTER_VALUES: ReadonlySet<string> = new Set(
  Object.values(AutomationRunStatus),
);

function parseEpochMsParam(value: unknown): Date | null {
  if (typeof value !== 'string' || value === '') return null;
  const ms = Number.parseInt(value, 10);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms) : null;
}

function safeParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

// POST / — create a new automation as DRAFT
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
    logger.error('[automations/claw] create failed:', err);
    res.status(500).json({ success: false, error: 'Failed to create automation' });
  }
});

// GET / — list automations
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
    logger.error('[automations/claw] list failed:', err);
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
    logger.error('[automations/claw] get failed:', err);
    res.status(500).json({ success: false, error: 'Failed to get automation' });
  }
});

// PUT /:id — update or create a new DRAFT version
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
    logger.error('[automations/claw] update failed:', err);
    res.status(500).json({ success: false, error: 'Failed to update automation' });
  }
});

// GET /:automationId/runs — list runs for an automation
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

// GET /runs/:executionId — fetch a single run
router.get(
  '/runs/:executionId',
  async (req: Request<{ executionId: string }>, res: Response) => {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }
    const { executionId } = req.params;

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

export default router;
