import { Router, type Request, type Response } from 'express';
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
import {
  workflowExecutionToRun,
  AUTOMATION_WORKFLOW_TYPE,
} from '../types/workflow-adapter';
import {
  getAutomationPauseState,
  getExecutionState,
  stitchExecutionStateMany,
} from '@/database/repositories/workflowExecutionStateUtils';

const router = Router();

router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  next();
});

const OPERATOR_METADATA: Record<
  ConditionOperator,
  { label: string; valueType: 'string' | 'number' | 'boolean' | 'none' }
> = {
  [ConditionOperator.EQ]: { label: 'equals', valueType: 'string' },
  [ConditionOperator.NEQ]: { label: 'does not equal', valueType: 'string' },
  [ConditionOperator.CONTAINS]: { label: 'contains', valueType: 'string' },
  [ConditionOperator.GT]: { label: 'is greater than', valueType: 'number' },
  [ConditionOperator.GTE]: { label: 'is greater than or equal to', valueType: 'number' },
  [ConditionOperator.LT]: { label: 'is less than', valueType: 'number' },
  [ConditionOperator.LTE]: { label: 'is less than or equal to', valueType: 'number' },
  [ConditionOperator.EXISTS]: { label: 'exists', valueType: 'none' },
};

router.get('/schema/operators', (_req, res) => {
  const list = Object.entries(OPERATOR_METADATA).map(([value, meta]) => ({ value, ...meta }));
  res.json({ success: true, data: list, timestamp: new Date().toISOString() });
});

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
    const { automationId } = req.params;
    const limitRaw = req.query['limit'];
    const limit = Math.min(Math.max(Number.parseInt(String(limitRaw ?? 50), 10) || 50, 1), 200);
    const cursor = typeof req.query['cursor'] === 'string' ? (req.query['cursor'] as string) : null;
    const statusRaw = req.query['status'];
    const status =
      typeof statusRaw === 'string' && RUN_STATUS_FILTER_VALUES.has(statusRaw) ? statusRaw : null;
    const from = parseEpochMsParam(req.query['from']);
    const to = parseEpochMsParam(req.query['to']);

    const workflow = await db.workflow.findUnique({ where: { id: automationId } });
    if (!workflow || workflow.workflowType !== AUTOMATION_WORKFLOW_TYPE) {
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
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;

    const stitched = await stitchExecutionStateMany(page);

    res.json({
      success: true,
      data: {
        runs: stitched.map(row =>
          workflowExecutionToRun(row, { context: row.context }),
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
    const { executionId } = req.params;

    const execution = await db.workflowExecution.findUnique({ where: { id: executionId } });
    if (!execution || execution.workflowType !== AUTOMATION_WORKFLOW_TYPE) {
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
): Promise<{ seriesId: string } | { error: { status: number; message: string } }> {
  const workflow = await db.workflow.findUnique({ where: { id: automationId } });
  if (!workflow || workflow.workflowType !== AUTOMATION_WORKFLOW_TYPE) {
    return { error: { status: 404, message: 'Automation not found' } };
  }
  return { seriesId: workflow.automationSeriesId ?? workflow.id };
}

// Read-only: the token is shown only once at creation, so this returns just
// whether a secret has been issued (never the token itself).
router.get(
  '/:automationId/webhook',
  async (req: Request<{ automationId: string }>, res: Response) => {
    const resolved = await resolveWebhookAutomation(req.params.automationId);
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
    const resolved = await resolveWebhookAutomation(req.params.automationId);
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
