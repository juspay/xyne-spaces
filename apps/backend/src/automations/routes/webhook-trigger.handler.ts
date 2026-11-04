import { Router, type Request, type Response } from 'express';
import { WorkflowEventType } from '@xyne/shared';
import { db } from '@/database/client';
import { createAutomationExecutionForWebhook } from '@/bypassAcl/automationServices';
import { logger } from '@/utils/logger';
import { automationQueue } from '../queue/automation.queue';
import { storedSecretMatches } from '../services/webhook-secret.service';
import { assertMatchesSchema } from '../engine/declared-schema';
import { isSensitiveHeader } from '../engine/webhook-step-encryption';
import { AutomationStatus } from '../types/status';
import {
  AUTOMATION_WORKFLOW_TYPE,
  parseAutomationConfig,
  parseAutomationMetadata,
} from '../types/workflow-adapter';
import { WEBHOOK_EVENT } from '../triggers/webhook.trigger';

const router = Router();

const DROPPED_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'forwarded',
  'x-real-ip',
  'x-client-ip',
]);
const DROPPED_HEADER_PREFIXES = ['x-forwarded-', 'x-envoy-', 'x-b3-', 'x-cloud-trace', 'x-goog-'];
const SECRET_LIKE_HEADER = /(token|secret|signature|key|auth|session|password|credential)/i;

function collectHeaders(req: Request, marked: string[] | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    const lower = k.toLowerCase();
    if (DROPPED_HEADERS.has(lower)) continue;
    if (DROPPED_HEADER_PREFIXES.some((p) => lower.startsWith(p))) continue;
    out[k] = isSensitiveHeader(k, marked) || SECRET_LIKE_HEADER.test(lower) ? '[REDACTED]' : v;
  }
  return out;
}

router.post(
  '/:seriesId/:secret',
  async (req: Request<{ seriesId: string; secret: string }>, res: Response): Promise<void> => {
    const { seriesId, secret } = req.params;
    try {
      const workflow = await db.workflow.findFirst({
        where: {
          automationSeriesId: seriesId,
          workflowType: AUTOMATION_WORKFLOW_TYPE,
          eventType: WorkflowEventType.WEBHOOK,
          status: AutomationStatus.ACTIVE,
        },
      });
      // Same answer for an unknown series and a wrong secret, so the URL is not an oracle.
      const secretOk = await storedSecretMatches(seriesId, secret);
      if (!workflow || !secretOk) {
        res.status(401).json({ success: false, error: 'Invalid webhook URL' });
        return;
      }

      const config = parseAutomationConfig(workflow.context);
      const triggerConfig = (config.trigger.config ?? {}) as {
        bodySchema?: Record<string, unknown>;
        headerSchema?: Record<string, unknown>;
      };
      const headerSchema = triggerConfig.headerSchema ?? {};
      const markedSecretHeaders = Object.keys(headerSchema).filter(
        (k) => headerSchema[k] === 'secret'
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

      // Unauthenticated webhook — no HTTP session to derive the tenant from, so open
      // a tenant scope explicitly off the workflow's workspaceId. This stamps
      // workspaceId onto the execution rows (and the downstream job's step writes).
      const execution = await createAutomationExecutionForWebhook({
        workspaceId: workflow.workspaceId,
        workflowId: workflow.id,
        initialContext,
      });

      await automationQueue.enqueueRun(
        { executionId: execution.id },
        metadata.priority ? { priority: 1 } : {}
      );
      logger.info(`[webhook-trigger] automation=${workflow.id} execution=${execution.id} accepted`);

      res.status(202).json({ success: true, executionId: execution.id });
    } catch (err) {
      logger.error('[webhook-trigger] failed', {
        seriesId,
        error: err instanceof Error ? err.message : String(err),
      });
      if (!res.headersSent)
        res.status(500).json({ success: false, error: 'Webhook processing failed' });
    }
  }
);

function lowercaseKeys(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) out[k.toLowerCase()] = v;
  return out;
}

export default router;
