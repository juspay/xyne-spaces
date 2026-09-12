import { Router, type Request, type Response } from 'express';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import {
  getAutomationPauseState,
  getExecutionState,
  stitchExecutionContextMany,
} from '@/database/repositories/workflowExecutionStateUtils';
import { Prisma } from '@prisma/client';
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
  AUTOMATION_LIVE_STATUSES,
  AUTOMATION_SORT_FIELDS,
  AUTOMATION_STATUS_VALUES,
  AutomationPayloadSchema,
  channelIdWhere,
  createdByWhere,
  CreateAutomationPayloadSchema,
  decodeAutomationListCursorFor,
  encodeAutomationListCursorFor,
  getAuthContext,
  parseAllowedList,
  parseCsvList,
  parseEpochMsParam,
  parseListLimit,
  parseSortDirection,
  parseSortField,
  prepareConfigForSave,
  proposalVisibilityWhere,
  RUN_STATUS_FILTER_VALUES,
  safeParseJson,
  sendUnauthorized,
  WORKFLOW_EVENT_TYPE_VALUES,
} from './automation-route-helpers';
import { applyConfigOperations, ConfigOpError, type ConfigOperation } from './automation-config-ops';
import { clawClient } from '../services/claw-client';
import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { triggerRegistry } from '../triggers/trigger-registry';
import { stepRegistry } from '../steps/step-registry';
import { ConditionOperator, VALUE_LESS_OPERATORS } from '../types/operators';
import { automationService } from '../services/automation.service';
import { approvalService, ApprovalError } from '../services/approval.service';
import type { AutomationConfig } from '../types/automation-config';

/**
 * Claw-facing automation routes. Mounted at /api/automations/claw behind
 * authenticateUserOrApp, so both user tokens and app tokens can manage
 * automations headlessly.
 */

const router = Router();

router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  next();
});

// Schema discovery: registry-driven and read-only, so no workspace scoping.

// GET /schema/operators — derived from the enum, not a copied label map.
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
    const sortBy = parseSortField(req.query['sortBy']);
    const sortDir = parseSortDirection(req.query['sortDir']);
    const column = AUTOMATION_SORT_FIELDS[sortBy];
    const cursor = decodeAutomationListCursorFor(req.query['cursor'], sortBy);

    // Filters mirror the dashboard's AutomationFilters. All are multi-value.
    const statuses = parseAllowedList(req.query['status'], AUTOMATION_STATUS_VALUES);
    const triggerTypes = parseAllowedList(req.query['triggerType'], WORKFLOW_EVENT_TYPE_VALUES);
    const channelIds = parseCsvList(req.query['channelId']);
    const createdBy = parseCsvList(req.query['createdBy']);
    const qRaw = req.query['q'];
    const q = typeof qRaw === 'string' ? qRaw.trim() : '';
    const dateField = req.query['dateField'] === 'updatedAt' ? 'updatedAt' : 'createdAt';
    const from = parseEpochMsParam(req.query['from']);
    const to = parseEpochMsParam(req.query['to']);

    // Keyset pagination: past the cursor on the sort column, id breaking ties.
    const beyond = sortDir === 'asc' ? 'gt' : 'lt';

    const and: Prisma.WorkflowWhereInput[] = [
      // Never removable by any filter combination — see proposalVisibilityWhere.
      proposalVisibilityWhere(auth.userId) as Prisma.WorkflowWhereInput,
    ];
    if (createdBy.length > 0) and.push({ OR: createdByWhere(createdBy) as Prisma.WorkflowWhereInput[] });
    if (channelIds.length > 0) and.push({ OR: channelIdWhere(channelIds) as Prisma.WorkflowWhereInput[] });
    if (q) {
      // Description lives in `metadata`, trigger type in `context`.
      and.push({
        OR: [
          { workflowName: { contains: q, mode: 'insensitive' } },
          { metadata: { contains: q } },
          { context: { contains: q } },
        ],
      });
    }
    if (cursor) {
      and.push({
        OR: [
          { [column]: { [beyond]: cursor.value } } as Prisma.WorkflowWhereInput,
          { [column]: cursor.value, id: { [beyond]: cursor.id } } as Prisma.WorkflowWhereInput,
        ],
      });
    }

    const where: Prisma.WorkflowWhereInput = {
      workflowType: AUTOMATION_WORKFLOW_TYPE,
      workspaceId: auth.workspaceId,
      // Live set by default; history statuses only when named explicitly.
      status: { in: statuses.length > 0 ? statuses : [...AUTOMATION_LIVE_STATUSES] },
      ...(triggerTypes.length > 0 ? { eventType: { in: triggerTypes } } : {}),
      ...(from || to
        ? { [dateField]: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
      AND: and,
    };

    const workflows = await db.workflow.findMany({
      where,
      orderBy: [{ [column]: sortDir }, { id: sortDir }] as Prisma.WorkflowOrderByWithRelationInput[],
      take: limit + 1,
    });
    const hasMore = workflows.length > limit;
    const page = hasMore ? workflows.slice(0, limit) : workflows;
    const last = page[page.length - 1];
    res.json({
      success: true,
      data: page.map(workflowToAutomation),
      pagination: {
        limit,
        sortBy,
        sortDir,
        nextCursor: hasMore && last ? encodeAutomationListCursorFor(sortBy, last) : null,
        hasMore,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('[automations/claw] list failed:', err);
    res.status(500).json({ success: false, error: 'Failed to list automations' });
  }
});

/* GET /runs — workspace-wide runs; `automationId` narrows to one automation.
 * MUST stay above "GET /:id": both are one segment, first registered wins. */
router.get('/runs', async (req: Request, res: Response) => {
  try {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }

    const limitRaw = req.query['limit'];
    const limit = Math.min(Math.max(Number.parseInt(String(limitRaw ?? 50), 10) || 50, 1), 200);
    const cursor = typeof req.query['cursor'] === 'string' ? (req.query['cursor'] as string) : null;
    const statusRaw = req.query['status'];
    const status =
      typeof statusRaw === 'string' && RUN_STATUS_FILTER_VALUES.has(statusRaw) ? statusRaw : null;
    const automationIdRaw = req.query['automationId'];
    const automationId =
      typeof automationIdRaw === 'string' && automationIdRaw ? automationIdRaw : null;
    const from = parseEpochMsParam(req.query['from']);
    const to = parseEpochMsParam(req.query['to']);

    // Executions carry a denormalised workspaceId, so this stays tenant-scoped.
    const rows = await db.workflowExecution.findMany({
      where: {
        workspaceId: auth.workspaceId,
        workflowType: AUTOMATION_WORKFLOW_TYPE,
        ...(automationId ? { workflowId: automationId } : {}),
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
    const stitched = await stitchExecutionContextMany(page);

    res.json({
      success: true,
      data: {
        runs: stitched.map(row => workflowExecutionToRunSummary(row, { context: row.context })),
        nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('[automations/claw] workspace run list failed:', err);
    res.status(500).json({ success: false, error: 'Failed to list runs' });
  }
});

/* GET /agents — agents a RUN_AGENT step can call. Declared here because the
 * existing handler sits behind authMiddleware.authenticate and would reject an
 * app token. One segment, so it must stay above "GET /:id". */
router.get('/agents', async (_req: Request, res: Response) => {
  try {
    const agents = await clawClient.listAgents();
    res.json({ success: true, data: agents, timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error('[automations/claw] agents lookup failed:', err);
    res.status(502).json({
      success: false,
      error: 'Failed to fetch claw agents',
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});

/* GET /pending — proposals waiting on a human decision.
 * Single path segment, so it must stay above "GET /:id". */
router.get('/pending', async (req: Request, res: Response) => {
  try {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }
    // listPendingProposals is not tenant-scoped, so re-filter by workspace.
    const pending = (await approvalService.listPendingProposals()).filter(
      p => p.workspaceId === auth.workspaceId,
    );
    res.json({ success: true, data: pending, timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error('[automations/claw] pending list failed:', err);
    res.status(500).json({ success: false, error: 'Failed to list pending automations' });
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
        // Another user's private DRAFT / PENDING_APPROVAL must 404, not read.
        ...(proposalVisibilityWhere(auth.userId) as Prisma.WorkflowWhereInput),
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

/* PATCH /:id/config — targeted step-tree edits, so an agent need not resend the
 * whole config. Validated and saved under the same rules as PUT. */
router.patch('/:id/config', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }

    const operations = (req.body as { operations?: unknown })?.operations;
    if (!Array.isArray(operations) || operations.length === 0) {
      res.status(400).json({ success: false, error: 'Provide a non-empty `operations` array' });
      return;
    }

    const existing = await db.workflow.findFirst({
      where: {
        id: req.params.id,
        workflowType: AUTOMATION_WORKFLOW_TYPE,
        workspaceId: auth.workspaceId,
        status: { not: AutomationStatus.ARCHIVED },
        ...(proposalVisibilityWhere(auth.userId) as Prisma.WorkflowWhereInput),
      },
    });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Automation not found' });
      return;
    }

    const existingAutomation = workflowToAutomation(existing);

    let nextConfig;
    try {
      nextConfig = applyConfigOperations(existingAutomation.config, operations as ConfigOperation[]);
    } catch (opErr) {
      if (opErr instanceof ConfigOpError) {
        res.status(400).json({ success: false, error: opErr.message });
        return;
      }
      throw opErr;
    }

    const prepared = prepareConfigForSave(nextConfig, res);
    if (!prepared) return;

    const metadata = buildAutomationMetadata({
      description: existingAutomation.description,
      createdById:
        existing.status === AutomationStatus.DRAFT && existingAutomation.createdById === auth.userId
          ? existingAutomation.createdById
          : auth.userId,
    });

    // Own DRAFT edits in place; anything live forks a new DRAFT, as PUT does.
    if (existing.status === AutomationStatus.DRAFT && existingAutomation.createdById === auth.userId) {
      const updated = await db.$transaction(async tx => {
        await claimAutomationTemplates(tx, prepared.config, auth.workspaceId);
        return tx.workflow.update({
          where: { id: existing.id },
          data: {
            context: prepared.context,
            eventType: prepared.eventType,
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
      await claimAutomationTemplates(tx, prepared.config, auth.workspaceId);
      return tx.workflow.create({
        data: {
          workflowType: AUTOMATION_WORKFLOW_TYPE,
          workflowName: existing.workflowName,
          workspaceId: auth.workspaceId,
          status: AutomationStatus.DRAFT,
          automationSeriesId: seriesId,
          context: prepared.context,
          eventType: prepared.eventType,
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
    logger.error('[automations/claw] patch config failed:', err);
    res.status(500).json({ success: false, error: 'Failed to patch automation config' });
  }
});

/* POST /:id/clone — copy into a new DRAFT. Starts its own lineage
 * (automationSeriesId null), so approving it never touches the source. */
router.post('/:id/clone', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }

    const source = await db.workflow.findFirst({
      where: {
        id: req.params.id,
        workflowType: AUTOMATION_WORKFLOW_TYPE,
        workspaceId: auth.workspaceId,
        status: { not: AutomationStatus.ARCHIVED },
        ...(proposalVisibilityWhere(auth.userId) as Prisma.WorkflowWhereInput),
      },
    });
    if (!source) {
      res.status(404).json({ success: false, error: 'Automation not found' });
      return;
    }

    const sourceAutomation = workflowToAutomation(source);
    const requestedName = (req.body as { name?: unknown })?.name;
    const name =
      typeof requestedName === 'string' && requestedName.trim()
        ? requestedName.trim()
        : `${sourceAutomation.name} (copy)`;

    const prepared = prepareConfigForSave(sourceAutomation.config, res);
    if (!prepared) return;

    const clone = await db.$transaction(async tx => {
      await claimAutomationTemplates(tx, prepared.config, auth.workspaceId);
      return tx.workflow.create({
        data: {
          workflowType: AUTOMATION_WORKFLOW_TYPE,
          workflowName: name,
          workspaceId: auth.workspaceId,
          status: AutomationStatus.DRAFT,
          context: prepared.context,
          eventType: prepared.eventType,
          // The clone belongs to whoever cloned it, not the original author.
          metadata: buildAutomationMetadata({
            description: sourceAutomation.description,
            createdById: auth.userId,
          }),
        },
      });
    });

    res.status(201).json({
      success: true,
      data: { automation: workflowToAutomation(clone) },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    if (err instanceof AutomationTemplateInputError) {
      res.status(err.statusCode).json({ success: false, error: err.message });
      return;
    }
    logger.error('[automations/claw] clone failed:', err);
    res.status(500).json({ success: false, error: 'Failed to clone automation' });
  }
});

// GET /:id/versions — every version in this automation's lineage.
router.get('/:id/versions', async (req: Request<{ id: string }>, res: Response) => {
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
      },
    });
    if (!workflow) {
      res.status(404).json({ success: false, error: 'Automation not found' });
      return;
    }

    // Series id is not tenant-scoped, so re-filter by workspace.
    const seriesId = workflow.automationSeriesId ?? workflow.id;
    const versions = (await approvalService.listLineageVersions(seriesId)).filter(
      v => v.workspaceId === auth.workspaceId,
    );
    res.json({ success: true, data: versions, timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error('[automations/claw] list versions failed:', err);
    res.status(500).json({ success: false, error: 'Failed to list automation versions' });
  }
});

// POST /:id/submit — the only transition out of DRAFT. Lands in
// PENDING_APPROVAL; approval itself stays a human action.
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
