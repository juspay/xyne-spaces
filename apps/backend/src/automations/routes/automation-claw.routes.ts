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
import { webhookSecretExists } from '../services/webhook-secret.service';
import { config } from '@/config/env';
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
    const sortBy = parseSortField(req.query['sortBy']);
    const sortDir = parseSortDirection(req.query['sortDir']);
    const column = AUTOMATION_SORT_FIELDS[sortBy];
    const cursor = decodeAutomationListCursorFor(req.query['cursor'], sortBy);

    // Filter vocabulary deliberately mirrors the dashboard's AutomationFilters
    // (AutomationsList/AutomationFiltersBar/filters.ts) so an agent and a person
    // narrow the same list the same way. All are multi-value.
    const statuses = parseAllowedList(req.query['status'], AUTOMATION_STATUS_VALUES);
    const triggerTypes = parseAllowedList(req.query['triggerType'], WORKFLOW_EVENT_TYPE_VALUES);
    const channelIds = parseCsvList(req.query['channelId']);
    const createdBy = parseCsvList(req.query['createdBy']);
    const qRaw = req.query['q'];
    const q = typeof qRaw === 'string' ? qRaw.trim() : '';
    const dateField = req.query['dateField'] === 'updatedAt' ? 'updatedAt' : 'createdAt';
    const from = parseEpochMsParam(req.query['from']);
    const to = parseEpochMsParam(req.query['to']);

    // Keyset pagination: strictly past the cursor on the sort column, with id
    // breaking ties. Direction follows the sort so `asc` pages forward too.
    const beyond = sortDir === 'asc' ? 'gt' : 'lt';

    const and: Prisma.WorkflowWhereInput[] = [
      // Never removable by any filter combination — see proposalVisibilityWhere.
      proposalVisibilityWhere(auth.userId) as Prisma.WorkflowWhereInput,
    ];
    if (createdBy.length > 0) and.push({ OR: createdByWhere(createdBy) as Prisma.WorkflowWhereInput[] });
    if (channelIds.length > 0) and.push({ OR: channelIdWhere(channelIds) as Prisma.WorkflowWhereInput[] });
    if (q) {
      // The dashboard matches name, description and trigger type. Description
      // lives in `metadata` and the trigger type in `context`, both JSON text.
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
      // Default to the live set the dashboard shows; history statuses
      // (ARCHIVED/REJECTED/REVOKED/AUTO_REVOKED) only when named explicitly.
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

/* GET /runs — runs across the WHOLE workspace, not scoped to one automation.
 *
 * Lets an agent answer "what failed in the last hour" without first listing
 * automations and fanning out per id. `automationId` narrows it back down.
 *
 * MUST stay above "GET /:id": both are a single path segment, so whichever is
 * registered first wins and "/runs" would otherwise be read as an id.
 */
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

    // Tenant scoping: executions carry a denormalised workspaceId, so this
    // never leaks another workspace's runs even without an automation filter.
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

/* GET /agents — agents a RUN_AGENT step can call.
 *
 * The user-facing surface has this at /api/automations/claw/agents, which now
 * resolves into THIS router first. It would still fall through to the old
 * handler, but that one sits behind authMiddleware.authenticate and so would
 * reject an app token — the exact caller this route exists for. Declared here
 * so app-token runs get the same answer as user sessions.
 *
 * Single path segment, so it must stay above "GET /:id".
 */
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
        // Another user's private DRAFT / PENDING_APPROVAL must 404, not read —
        // otherwise the guard on the list is cosmetic, since ids are guessable
        // from a lineage or a run.
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

/* PATCH /:id/config — targeted edits to the step tree.
 *
 * PUT /:id replaces the whole config, so an agent editing one step has to
 * reproduce the entire tree — expensive, easy to get wrong, and it silently
 * discards anything changed since it last read. This applies named operations
 * server-side instead (add/update/delete/move a step by id, set a CONDITIONAL
 * or SWITCH-case condition, set the trigger or schedule), then validates and
 * saves through exactly the same DRAFT-vs-new-version rules as PUT.
 */
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

    // Editing your own DRAFT changes it in place; editing anything live forks a
    // new DRAFT version, exactly as PUT does.
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

/* POST /:id/clone — copy an automation into a brand-new DRAFT.
 *
 * Deliberately starts its OWN lineage (automationSeriesId left null) rather
 * than joining the source's: a clone is a separate automation, not another
 * version of the original, so approving it must not touch the source's series.
 */
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

function webhookEndpoint(): string {
  return `${config.backendUrl.replace(/\/$/, '')}/api/automation-webhooks`;
}

/* GET /:id/webhook — the webhook URL for a WEBHOOK-triggered automation.
 *
 * Read-only and never returns the secret: the token is shown once at creation,
 * so this reports only whether one has been issued. Minting a secret stays off
 * the claw surface deliberately — it was not requested, and handing an agent a
 * credential-minting endpoint deserves its own decision.
 */
router.get('/:id/webhook', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const auth = getAuthContext(req);
    if (!auth) {
      sendUnauthorized(res);
      return;
    }

    // Scoped by workspace so a caller cannot resolve another tenant's webhook.
    const workflow = await db.workflow.findFirst({
      where: {
        id: req.params.id,
        workflowType: AUTOMATION_WORKFLOW_TYPE,
        workspaceId: auth.workspaceId,
        ...(proposalVisibilityWhere(auth.userId) as Prisma.WorkflowWhereInput),
      },
    });
    if (!workflow) {
      res.status(404).json({ success: false, error: 'Automation not found' });
      return;
    }

    const seriesId = workflow.automationSeriesId ?? workflow.id;
    res.json({
      success: true,
      data: {
        url: `${webhookEndpoint()}/${seriesId}`,
        issued: await webhookSecretExists(seriesId),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('[automations/claw] webhook lookup failed:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch webhook details' });
  }
});

// GET /:id/versions — every version in this automation's lineage.
// Each version is its own row with its own id, so an agent can list the
// lineage here and then fetch any one of them in full via GET /:id.
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

    // Re-filter by workspace: the lineage is looked up by series id, which is
    // not itself tenant-scoped.
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

// POST /:id/submit — submit a DRAFT for approval.
// The only transition out of DRAFT: create and update both leave an automation
// in DRAFT. Approval itself stays a human/admin action, so this lands the
// automation in PENDING_APPROVAL, never ACTIVE.
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
