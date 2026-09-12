import { Router, type Request, type Response } from 'express';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import {
  getAutomationPauseState,
  getExecutionState,
  stitchExecutionContextMany,
} from '@/database/repositories/workflowExecutionStateUtils';
import { claimAutomationTemplates, AutomationTemplateInputError } from '../services/automation-template.service';
import { AutomationStatus } from '../types/status';
import {
  AUTOMATION_WORKFLOW_TYPE,
  buildAutomationMetadata,
  workflowExecutionToRun,
  workflowExecutionToRunSummary,
  workflowToAutomation,
} from '../types/workflow-adapter';
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
import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { triggerRegistry } from '../triggers/trigger-registry';
import { stepRegistry } from '../steps/step-registry';
import { ConditionOperator, VALUE_LESS_OPERATORS } from '../types/operators';
import { automationService } from '../services/automation.service';
import { approvalService, ApprovalError } from '../services/approval.service';
import type { AutomationConfig } from '../types/automation-config';

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

/* ── Schema discovery ──────────────────────────────────────────────────
 * An agent has to author `config` from nothing, so it needs the vocabulary
 * first: which triggers and steps exist, and what each one's parameters are.
 * These are registry-driven and read-only, so they need no workspace scoping.
 *
 * Registered before the parameterised routes below. Express only matches a
 * single path segment per ":param", so "/schema/triggers" could not collide
 * with "/:id" anyway — the ordering is for the reader, not the router.
 */

// GET /schema/operators — condition operators available to `conditions`.
// Derived from the exported enum + VALUE_LESS_OPERATORS rather than copying
// the label map that lives privately in automation.routes.ts: one source of
// truth, and nothing here goes stale when an operator is added there.
router.get('/schema/operators', (_req: Request, res: Response) => {
  const list = Object.values(ConditionOperator).map(value => ({
    value,
    requiresValue: !VALUE_LESS_OPERATORS.has(value),
  }));
  res.json({ success: true, data: list, timestamp: new Date().toISOString() });
});

// GET /schema/triggers — every trigger type, name, description, category
router.get('/schema/triggers', (_req: Request, res: Response) => {
  res.json({ success: true, data: triggerRegistry.listMetadata(), timestamp: new Date().toISOString() });
});

// GET /schema/triggers/:type — full JSON Schema for one trigger
router.get('/schema/triggers/:type', (req: Request<{ type: string }>, res: Response) => {
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
      configSchema: impl.decorateConfigSchema(rawConfig),
      outputSchema: zodToJsonSchema(impl.outputSchema as z.ZodSchema, { name: 'output' }),
    },
    timestamp: new Date().toISOString(),
  });
});

// GET /schema/steps — every step type
router.get('/schema/steps', (_req: Request, res: Response) => {
  res.json({ success: true, data: stepRegistry.listMetadata(), timestamp: new Date().toISOString() });
});

// GET /schema/steps/:type — full JSON Schema for one step
router.get('/schema/steps/:type', (req: Request<{ type: string }>, res: Response) => {
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
      configSchema: zodToJsonSchema(impl.configSchema as z.ZodSchema, { name: 'config' }),
      outputSchema: zodToJsonSchema(impl.outputSchema as z.ZodSchema, { name: 'output' }),
    },
    timestamp: new Date().toISOString(),
  });
});

// POST /validate — check a config without persisting anything.
// Pure: lets an agent iterate on a config before it writes a DRAFT.
router.post('/validate', (req: Request, res: Response) => {
  const body = req.body as { config?: AutomationConfig };
  if (!body?.config) {
    res.status(400).json({ success: false, error: 'Missing `config` in request body' });
    return;
  }
  const result = automationService.validateConfig(body.config);
  res.json({ success: true, data: result, timestamp: new Date().toISOString() });
});

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

// POST /:id/submit — submit a DRAFT for approval.
// This is the ONLY transition out of DRAFT: create and update both leave an
// automation in DRAFT, so without this an agent-authored automation can never
// run. Approval itself stays a human/admin action.
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
    logger.error('[automations/claw] submit failed:', err);
    res.status(500).json({ success: false, error: 'Failed to submit automation for approval' });
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
