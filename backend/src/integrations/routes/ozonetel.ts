import express, { Router, type Request, type Response } from 'express';
import { AccessType } from '@prisma/client';
import { z } from 'zod';
import { config } from '@/config/env';
import { authorize } from '@/middleware/authorize';
import { OzonetelConfigValidationError, ozonetelConfigService } from '@/services/ozonetel/ozonetelConfigService';
import { OzonetelError, ozonetelService } from '@/services/ozonetel/ozonetelService';
import { logger } from '@/utils/logger';

const router = Router();
router.use(express.json());

const supportAdminAuth = authorize('SUPPORT', AccessType.ADMIN);
const supportReadAuth = authorize('SUPPORT', AccessType.READ);

const agentMappingSchema = z.record(
  z.string(),
  z.object({ agentId: z.string().min(1), skill: z.string().optional() }),
);

const saveConfigSchema = z.object({
  channelId: z.string().optional(),
  apiKey: z.preprocess(
    value => (typeof value === 'string' ? value.trim() : value),
    z.string().optional(),
  ),
  apiUser: z.string().min(1),
  baseUrl: z.string().url(),
  toolbarUrl: z.string().url().optional(),
  agentMapping: agentMappingSchema.default({}),
  ticketRules: z.object({
    defaultChannelId: z.string().optional(),
    campaignRouting: z.record(z.string(), z.string()).optional(),
    createTicketOnEvent: z.enum(['new_call', 'agent_answered']).optional(),
    createTicketOnInbound: z.boolean().optional(),
    createTicketOnManual: z.boolean().optional(),
    createTicketOnPreview: z.boolean().optional(),
    createTicketOnProgressive: z.boolean().optional(),
    createTicketOnPredictive: z.boolean().optional(),
    ticketSubjectTemplate: z.string().optional(),
  }).optional(),
});

function resolveAutoSubscribePublicBaseUrl(): string {
  const configured = String(config.backendUrl ?? '').trim().replace(/\/$/, '');
  if (!configured) {
    throw new Error('Cannot build Ozonetel callback URLs without BACKEND_URL');
  }
  return configured;
}

function buildPostCallWebhookUrl(sourceName: string): string {
  const publicBaseUrl = resolveAutoSubscribePublicBaseUrl();
  return `${publicBaseUrl}/api/external-source-sync/${sourceName}/ingest`;
}

async function autoSubscribeWorkspaceTelephony(params: {
  workspaceId: string;
  sourceName: string;
}): Promise<{
  ok: true;
  message: string;
  subscribeBaseUrl: string;
}> {
  const callEventsURL = buildPostCallWebhookUrl(params.sourceName);
  const result = await ozonetelService.subscribeEvents({
    workspaceId: params.workspaceId,
    callEventsURL,
  });

  logger.info('[telephony] auto_subscribe_success', {
    workspaceId: params.workspaceId,
    subscribeBaseUrl: result.subscribeBaseUrl,
    callEventsURL,
  });

  return {
    ok: true,
    message: result.message,
    subscribeBaseUrl: result.subscribeBaseUrl,
  };
}

function buildOzonetelMutationResponse(
  subscribeResult: { message: string } | null,
): {
  ok: true;
  subscribeMessage?: string;
} {
  return subscribeResult
    ? {
        ok: true,
        subscribeMessage: subscribeResult.message,
      }
    : { ok: true };
}

function getWorkspaceId(req: Request): string | null {
  return req.user?.workspaceId ?? null;
}

function respondUnauthorized(res: Response): true {
  res.status(401).json({ error: 'unauthorized' });
  return true;
}

function ensureWorkspaceId(req: Request, res: Response): string | null {
  const workspaceId = getWorkspaceId(req);
  if (!workspaceId) {
    respondUnauthorized(res);
    return null;
  }
  return workspaceId;
}

async function ensureConfiguredWorkspace(
  workspaceId: string,
  res: Response,
): Promise<boolean> {
  const cfg = await ozonetelConfigService.getConfig(workspaceId);
  if (!cfg) {
    res.status(400).json({ message: 'Ozonetel is not configured for this workspace.' });
    return false;
  }
  return true;
}

async function tryAutoSubscribe(params: {
  workspaceId: string;
  reason: 'save';
  channelId?: string;
}): Promise<
  | { ok: true; message: string; subscribeBaseUrl: string }
  | null
> {
  try {
    const sourceName = await ozonetelConfigService.getSourceName(params.workspaceId);
    if (!sourceName) {
      throw new Error(`Ozonetel source name missing after ${params.reason}`);
    }
    return await autoSubscribeWorkspaceTelephony({
      workspaceId: params.workspaceId,
      sourceName,
    });
  } catch (error) {
    logger.warn(`[telephony] auto_subscribe_after_${params.reason}_failed`, {
      workspaceId: params.workspaceId,
      ...(params.channelId ? { channelId: params.channelId } : {}),
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function respondOzonetelError(res: Response, error: unknown): boolean {
  if (error instanceof OzonetelError) {
    res.status(400).json({ message: error.message });
    return true;
  }
  return false;
}

function respondConfigValidationError(res: Response, error: unknown): boolean {
  if (error instanceof OzonetelConfigValidationError) {
    res.status(400).json({
      error: 'invalid config',
      details: { formErrors: [], fieldErrors: error.details.fieldErrors },
    });
    return true;
  }
  return false;
}

router.get('/toolbar', supportReadAuth, async (req: Request, res: Response): Promise<void> => {
  const workspaceId = ensureWorkspaceId(req, res);
  if (!workspaceId) return;

  const cfg = await ozonetelConfigService.getConfig(workspaceId);
  res.json({
    configured: !!cfg,
    toolbarUrl: cfg?.toolbarUrl ?? null,
  });
});

router.get('/config', supportAdminAuth, async (req: Request, res: Response): Promise<void> => {
  const workspaceId = ensureWorkspaceId(req, res);
  if (!workspaceId) return;

  const channelId = typeof req.query.channelId === 'string' ? req.query.channelId.trim() : '';
  const cfg = await ozonetelConfigService.getConfig(workspaceId);
  if (!cfg) {
    res.json({ configured: false });
    return;
  }

  const sourceName = await ozonetelConfigService.getSourceName(workspaceId);
  if (!sourceName) {
    res.json({ configured: false });
    return;
  }

  const postCallWebhookURL = buildPostCallWebhookUrl(sourceName);
  const defaultChannelId = cfg.ticketRules?.defaultChannelId?.trim() || '';
  const campaignRouting = cfg.ticketRules?.campaignRouting ?? {};
  const mappedCampaigns =
    channelId
      ? Object.entries(campaignRouting)
          .filter(([, mappedChannelId]) => mappedChannelId.trim() === channelId)
          .map(([campaignName]) => campaignName)
      : [];

  res.json({
    configured: true,
    apiUser: cfg.apiUser,
    baseUrl: cfg.baseUrl,
    toolbarUrl: cfg.toolbarUrl ?? null,
    postCallWebhookURL,
    agentMapping: cfg.agentMapping,
    ticketRules: cfg.ticketRules ?? {},
    ...(channelId
      ? {
          channelRouting: {
            usesChannel:
              defaultChannelId === channelId ||
              mappedCampaigns.length > 0,
            isDefaultChannel: defaultChannelId === channelId,
            mappedCampaigns,
          },
        }
      : {}),
  });
});

router.get('/campaigns', supportAdminAuth, async (req: Request, res: Response): Promise<void> => {
  const workspaceId = ensureWorkspaceId(req, res);
  if (!workspaceId) return;
  if (!(await ensureConfiguredWorkspace(workspaceId, res))) return;

  try {
    const result = await ozonetelService.listAvailableCampaigns({ workspaceId });
    res.json({
      ok: true,
      campaigns: result.campaigns,
      raw: result.data,
    });
  } catch (error) {
    if (respondOzonetelError(res, error)) return;
    throw error;
  }
});

router.post('/config', supportAdminAuth, async (req: Request, res: Response): Promise<void> => {
  const workspaceId = ensureWorkspaceId(req, res);
  if (!workspaceId) return;

  const parsed = saveConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid config', details: parsed.error.flatten() });
    return;
  }

  const existing = await ozonetelConfigService.getConfig(workspaceId);
  const currentChannelId = parsed.data.channelId?.trim() || '';
  const apiKey = parsed.data.apiKey || existing?.apiKey;
  if (!apiKey) {
    res.status(400).json({
      error: 'invalid config',
      details: { formErrors: [], fieldErrors: { apiKey: ['API key is required'] } },
    });
    return;
  }

  try {
    await ozonetelConfigService.saveConfig(workspaceId, {
      ...parsed.data,
      apiKey,
      ticketRules: {
        ...(existing?.ticketRules ?? {}),
        ...parsed.data.ticketRules,
        ...(currentChannelId &&
        !(parsed.data.ticketRules?.defaultChannelId?.trim() || existing?.ticketRules?.defaultChannelId?.trim())
          ? { defaultChannelId: currentChannelId }
          : {}),
      },
      webhookSecret: existing?.webhookSecret,
    });
    const subscribeResult = await tryAutoSubscribe({ workspaceId, reason: 'save' });
    res.json(buildOzonetelMutationResponse(subscribeResult));
  } catch (error) {
    if (respondConfigValidationError(res, error)) return;
    throw error;
  }
});

router.post('/subscribe-live-events', supportAdminAuth, async (req: Request, res: Response): Promise<void> => {
  const workspaceId = ensureWorkspaceId(req, res);
  if (!workspaceId) return;
  if (!(await ensureConfiguredWorkspace(workspaceId, res))) return;

  try {
    const sourceName = await ozonetelConfigService.getSourceName(workspaceId);
    if (!sourceName) {
      res.status(400).json({ message: 'Ozonetel is not configured for this workspace.' });
      return;
    }
    const result = await autoSubscribeWorkspaceTelephony({
      workspaceId,
      sourceName,
    });
    res.json(buildOzonetelMutationResponse(result));
  } catch (error) {
    if (respondOzonetelError(res, error)) return;
    throw error;
  }
});

export default router;
