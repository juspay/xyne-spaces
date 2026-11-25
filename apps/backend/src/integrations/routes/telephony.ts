import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { AccessType } from '@xyne/shared';
import { z } from 'zod';
import { db } from '@/database/client';
import { authorizeAppDeskManager } from '@/integrations/routes/app-desk';
import { authorize } from '@/middleware/authorize';
import { redisService } from '@/services/redisService';
import {
  callConnectionService,
  type CallConnection,
} from '@/services/telephony/callConnectionService';
import { CallConfigError, type CallProvider } from '@/services/telephony/callProvider';
import { listCallProviders } from '@/services/telephony/callProviderRegistry';
import {
  deskCallSettingsService,
  type DeskCallSettingsView,
} from '@/services/telephony/deskCallSettingsService';
import { logger } from '@/utils/logger';

const router = Router();
router.use(express.json());

const supportAdminAuth = authorize('SUPPORT', AccessType.ADMIN);
const supportReadAuth = authorize('SUPPORT', AccessType.READ);

const agentMappingSchema = z.record(
  z.string(),
  z.object({ agentId: z.string().trim().min(1), skill: z.string().optional() }),
);
const credentialsSchema = z.record(z.string(), z.string());

const createConnectionSchema = z.object({
  provider: z.string().min(1),
  name: z.string(),
  credentials: credentialsSchema.default({}),
  agentMapping: agentMappingSchema.default({}),
});

const updateConnectionSchema = z.object({
  name: z.string().optional(),
  credentials: credentialsSchema.optional(),
  agentMapping: agentMappingSchema.optional(),
});

const deskSettingsSchema = z.object({
  connectionId: z.string().min(1),
  isDefault: z.boolean().optional(),
  routingKeys: z.array(z.string()).max(500).optional(),
  ticketRules: z
    .object({
      createTicketOnEvent: z.enum(['new_call', 'agent_answered']).optional(),
      callTypes: z.array(z.string()).optional(),
      subjectTemplate: z.string().max(300).optional(),
    })
    .optional(),
  phoneFieldNames: z.array(z.string()).max(20).optional(),
});

const linkCallSchema = z.object({
  connectionId: z.string().min(1),
  ticketId: z.string().min(1),
  monitorUcid: z.string().min(1),
  ucid: z.string().optional(),
});

type Handler = (req: Request, res: Response, workspaceId: string) => Promise<void>;

// Express 4 does not catch async errors: known ones become responses, the rest go to the error handler.
function handle(fn: Handler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const workspaceId = req.user?.workspaceId;
    if (!req.user?.id || !workspaceId) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    fn(req, res, workspaceId).catch(error => {
      if (error instanceof CallConfigError) {
        res.status(error.statusCode).json({
          error: error.message,
          ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
        });
        return;
      }
      next(error);
    });
  };
}

function invalidRequest(res: Response, error: z.ZodError): void {
  const flat = error.flatten();
  res.status(400).json({
    error: flat.formErrors[0] ?? 'Invalid request',
    fieldErrors: flat.fieldErrors,
  });
}

function providerView(provider: CallProvider): Record<string, unknown> {
  return {
    id: provider.id,
    displayName: provider.displayName,
    fields: provider.fields,
    callTypes: provider.callTypes,
    ...(provider.routingKeyLabel ? { routingKeyLabel: provider.routingKeyLabel } : {}),
    supportsSubscribe: !!provider.subscribeEvents,
    supportsRoutingKeys: !!provider.listRoutingKeys,
  };
}

/** Desks the viewer can't see are only counted, so their ids and campaigns aren't exposed. */
function summaryView(
  connection: CallConnection,
  desks: DeskCallSettingsView[],
  visibleDeskIds: ReadonlySet<string>,
): Record<string, unknown> {
  const bound = desks.filter(desk => desk.connectionId === connection.id);
  const visible = bound.filter(desk => visibleDeskIds.has(desk.channelId));
  return {
    id: connection.id,
    provider: connection.provider.id,
    providerName: connection.provider.displayName,
    name: connection.name,
    hasSoftphone: callConnectionService.softphoneUrl(connection) !== null,
    desks: visible.map(desk => ({
      channelId: desk.channelId,
      isDefault: desk.isDefault,
      routingKeys: desk.routingKeys,
    })),
    privateDeskCount: bound.length - visible.length,
  };
}

/** Admin view: no secrets, plus the webhook URL (which carries the webhook secret). */
function detailsView(connection: CallConnection): Record<string, unknown> {
  let webhookUrl: string | null = null;
  try {
    webhookUrl = callConnectionService.webhookUrl(connection);
  } catch {
    webhookUrl = null;
  }
  return {
    id: connection.id,
    provider: connection.provider.id,
    name: connection.name,
    credentials: connection.provider.publicCredentials(connection.credentials),
    agentMapping: connection.agentMapping,
    webhookUrl,
  };
}

/** Registers the webhook after a save; a failure is reported to the admin, not thrown. */
async function trySubscribe(
  connection: CallConnection,
): Promise<{ ok: boolean; message: string } | null> {
  if (!connection.provider.subscribeEvents) return null;
  try {
    const message = await callConnectionService.subscribe(connection);
    logger.info('[telephony] auto_subscribe_success', {
      workspaceId: connection.workspaceId,
      connectionId: connection.id,
    });
    return { ok: true, message: message || 'Subscribed' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Subscription failed';
    logger.warn('[telephony] auto_subscribe_failed', {
      workspaceId: connection.workspaceId,
      connectionId: connection.id,
      error: message,
    });
    return { ok: false, message };
  }
}

async function requireConnection(workspaceId: string, connectionId: string): Promise<CallConnection> {
  const connection = await callConnectionService.get(workspaceId, connectionId);
  if (!connection) throw new CallConfigError('Call connection not found', 404);
  return connection;
}

/** A provider API failure is the provider's, not ours: answer 502 with its message. */
async function fromProvider<T>(connection: CallConnection, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof CallConfigError) throw error;
    throw new CallConfigError(
      error instanceof Error ? error.message : `${connection.provider.displayName} request failed`,
      502,
    );
  }
}

router.get(
  '/providers',
  supportReadAuth,
  handle(async (_req, res) => {
    res.json({ providers: listCallProviders().map(providerView) });
  }),
);

router.get(
  '/connections',
  supportReadAuth,
  handle(async (_req, res, workspaceId) => {
    const [connections, desks] = await Promise.all([
      callConnectionService.list(workspaceId),
      deskCallSettingsService.listForWorkspace(workspaceId),
    ]);
    // Request-scoped, so only desks the caller can see.
    const visibleDesks = desks.length
      ? await db.channel.findMany({
          where: { workspaceId, id: { in: desks.map(desk => desk.channelId) } },
          select: { id: true },
        })
      : [];
    const visibleDeskIds = new Set(visibleDesks.map(desk => desk.id));
    res.json({
      connections: connections.map(connection => summaryView(connection, desks, visibleDeskIds)),
    });
  }),
);

router.post(
  '/connections',
  supportAdminAuth,
  handle(async (req, res, workspaceId) => {
    const parsed = createConnectionSchema.safeParse(req.body);
    if (!parsed.success) return invalidRequest(res, parsed.error);
    const connection = await callConnectionService.create(workspaceId, parsed.data);
    const subscribe = await trySubscribe(connection);
    res.status(201).json({ connection: detailsView(connection), subscribe });
  }),
);

router.get(
  '/connections/:connectionId',
  supportAdminAuth,
  handle(async (req, res, workspaceId) => {
    const connection = await requireConnection(workspaceId, String(req.params.connectionId));
    res.json({ connection: detailsView(connection) });
  }),
);

router.patch(
  '/connections/:connectionId',
  supportAdminAuth,
  handle(async (req, res, workspaceId) => {
    const parsed = updateConnectionSchema.safeParse(req.body);
    if (!parsed.success) return invalidRequest(res, parsed.error);
    const { connection, credentialsChanged } = await callConnectionService.update(
      workspaceId,
      String(req.params.connectionId),
      parsed.data,
    );
    // The webhook URL never changes, so only new credentials need registering again.
    const subscribe = credentialsChanged ? await trySubscribe(connection) : null;
    res.json({ connection: detailsView(connection), subscribe });
  }),
);

router.delete(
  '/connections/:connectionId',
  supportAdminAuth,
  handle(async (req, res, workspaceId) => {
    await callConnectionService.remove(workspaceId, String(req.params.connectionId));
    res.json({ ok: true });
  }),
);

router.post(
  '/connections/:connectionId/subscribe',
  supportAdminAuth,
  handle(async (req, res, workspaceId) => {
    const connection = await requireConnection(workspaceId, String(req.params.connectionId));
    if (!connection.provider.subscribeEvents) {
      throw new CallConfigError(`${connection.provider.displayName} has no live-event subscription`);
    }
    const message = await fromProvider(connection, () => callConnectionService.subscribe(connection));
    logger.info('[telephony] subscribe_success', { workspaceId, connectionId: connection.id });
    res.json({ ok: true, message: message || 'Subscribed' });
  }),
);

// Read access: desk owners pick campaigns for their desk without being support admins.
router.get(
  '/connections/:connectionId/routing-keys',
  supportReadAuth,
  handle(async (req, res, workspaceId) => {
    const connection = await requireConnection(workspaceId, String(req.params.connectionId));
    const listRoutingKeys = connection.provider.listRoutingKeys?.bind(connection.provider);
    const routingKeys = listRoutingKeys
      ? await fromProvider(connection, () => listRoutingKeys(connection.credentials))
      : [];
    res.json({ routingKeys });
  }),
);

router.get(
  '/desks/:channelId/call-settings',
  handle(async (req, res, workspaceId) => {
    const channelId = String(req.params.channelId);
    if (!(await authorizeAppDeskManager(channelId, req.user!.id, workspaceId, res))) return;
    res.json({ settings: await deskCallSettingsService.get(workspaceId, channelId) });
  }),
);

router.put(
  '/desks/:channelId/call-settings',
  handle(async (req, res, workspaceId) => {
    const channelId = String(req.params.channelId);
    const parsed = deskSettingsSchema.safeParse(req.body);
    if (!parsed.success) return invalidRequest(res, parsed.error);
    if (!(await authorizeAppDeskManager(channelId, req.user!.id, workspaceId, res))) return;
    const settings = await deskCallSettingsService.save(workspaceId, channelId, parsed.data);
    logger.info('[telephony] desk_call_settings_saved', {
      workspaceId,
      channelId,
      userId: req.user!.id,
      connectionId: settings.connectionId,
      isDefault: settings.isDefault,
      routingKeys: settings.routingKeys.length,
    });
    res.json({ settings });
  }),
);

router.delete(
  '/desks/:channelId/call-settings',
  handle(async (req, res, workspaceId) => {
    const channelId = String(req.params.channelId);
    if (!(await authorizeAppDeskManager(channelId, req.user!.id, workspaceId, res))) return;
    await deskCallSettingsService.remove(workspaceId, channelId);
    logger.info('[telephony] desk_call_settings_removed', { workspaceId, channelId, userId: req.user!.id });
    res.json({ ok: true });
  }),
);

/** Softphones the viewer can open; the desk's own connection and phone fields when it has them. */
router.get(
  '/softphone',
  supportReadAuth,
  handle(async (req, res, workspaceId) => {
    const channelId = typeof req.query.channelId === 'string' ? req.query.channelId.trim() : '';
    const connections = await callConnectionService.list(workspaceId);
    // Only for a desk the viewer can see.
    const desk = channelId
      ? await db.channel.findFirst({ where: { id: channelId, workspaceId }, select: { id: true } })
      : null;
    const settings = desk ? await deskCallSettingsService.get(workspaceId, desk.id) : null;
    res.json({
      connections: connections.flatMap(connection => {
        const url = callConnectionService.softphoneUrl(connection);
        return url
          ? [{ id: connection.id, name: connection.name, provider: connection.provider.id, url }]
          : [];
      }),
      deskConnectionId: settings?.connectionId ?? null,
      phoneFieldNames: settings?.phoneFieldNames ?? [],
    });
  }),
);

// Softphone-dialled calls carry no ticket id, so the page records which ticket a call belongs to.
router.post(
  '/link-call',
  supportReadAuth,
  handle(async (req, res, workspaceId) => {
    const parsed = linkCallSchema.safeParse(req.body);
    if (!parsed.success) return invalidRequest(res, parsed.error);
    const { connectionId, ticketId, monitorUcid, ucid } = parsed.data;

    const [ticket, connection] = await Promise.all([
      db.ticket.findFirst({ where: { id: ticketId, workspaceId }, select: { id: true } }),
      callConnectionService.get(workspaceId, connectionId),
    ]);
    if (!ticket) throw new CallConfigError('Ticket not found', 404);
    if (!connection) throw new CallConfigError('Call connection not found', 404);

    // The webhook keys on monitorUCID but falls back to ucid, so store both.
    const callIds = new Set([monitorUcid, ucid?.trim()].filter((id): id is string => !!id));
    await Promise.all(
      [...callIds].map(callId => redisService.setCallTicketLink(connection.id, callId, ticket.id)),
    );
    logger.info('[telephony] call_linked_to_ticket', {
      workspaceId,
      connectionId,
      ticketId,
      monitorUcid,
      ucid,
    });
    res.json({ ok: true });
  }),
);

export default router;
