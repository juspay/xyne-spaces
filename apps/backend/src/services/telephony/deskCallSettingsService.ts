import { Prisma, type DeskCallSettings } from '@prisma/client';
import { ChannelType } from '@xyne/shared';
import { findWorkspaceDeskIds } from '@/bypassAcl/callConnectionServices';
import { db } from '@/database/client';
import { WORKSPACE_LEVEL } from '@/integrations/core/sourceScope';
import { CallConfigError, type CallProvider } from './callProvider';
import { CALL_PROVIDER_IDS } from './callProviderIds';
import { getCallProvider } from './callProviderRegistry';

export type CreateTicketOnEvent = 'new_call' | 'agent_answered';

export type DeskCallTicketRules = {
  createTicketOnEvent: CreateTicketOnEvent;
  /** Provider call types that create tickets on this desk. */
  callTypes: string[];
  subjectTemplate?: string;
};

export interface DeskCallSettingsView {
  channelId: string;
  connectionId: string;
  provider: string;
  isDefault: boolean;
  routingKeys: string[];
  ticketRules: DeskCallTicketRules;
  phoneFieldNames: string[];
}

export interface DeskCallSettingsInput {
  connectionId: string;
  isDefault?: boolean;
  routingKeys?: string[];
  ticketRules?: Partial<DeskCallTicketRules>;
  phoneFieldNames?: string[];
}

const MAX_SUBJECT_TEMPLATE_LENGTH = 300;

function uniqueTrimmed(values: readonly unknown[]): string[] {
  const trimmed = values
    .map(value => (typeof value === 'string' ? value.trim() : ''))
    .filter(value => value.length > 0);
  return [...new Set(trimmed)];
}

function parseTicketRules(value: Prisma.JsonValue | null): DeskCallTicketRules {
  const raw = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<
    string,
    unknown
  >;
  const subjectTemplate =
    typeof raw.subjectTemplate === 'string' ? raw.subjectTemplate.trim() : '';
  return {
    createTicketOnEvent: raw.createTicketOnEvent === 'agent_answered' ? 'agent_answered' : 'new_call',
    callTypes: Array.isArray(raw.callTypes) ? uniqueTrimmed(raw.callTypes) : [],
    ...(subjectTemplate ? { subjectTemplate } : {}),
  };
}

/** Unset callTypes means every call type the provider has, so a new desk receives calls. */
function normalizeTicketRules(
  input: Partial<DeskCallTicketRules> | undefined,
  provider: CallProvider,
): DeskCallTicketRules {
  const known = provider.callTypes.map(callType => callType.id);
  const callTypes =
    input?.callTypes === undefined
      ? known
      : uniqueTrimmed(input.callTypes).filter(callType => known.includes(callType));
  const subjectTemplate = input?.subjectTemplate?.trim().slice(0, MAX_SUBJECT_TEMPLATE_LENGTH);
  return {
    createTicketOnEvent: input?.createTicketOnEvent === 'agent_answered' ? 'agent_answered' : 'new_call',
    callTypes,
    ...(subjectTemplate ? { subjectTemplate } : {}),
  };
}

function toView(row: DeskCallSettings): DeskCallSettingsView {
  return {
    channelId: row.channelId,
    connectionId: row.connectionId,
    provider: row.provider,
    isDefault: row.isDefault,
    routingKeys: row.routingKeys ?? [],
    ticketRules: parseTicketRules(row.ticketRules),
    phoneFieldNames: row.phoneFieldNames ?? [],
  };
}

/** Rejects routing another desk on the same connection already holds; drops rows of deleted desks. */
async function assertRoutingFree(params: {
  workspaceId: string;
  channelId: string;
  connectionId: string;
  routingKeys: string[];
  isDefault: boolean;
  routingKeyLabel: string;
}): Promise<void> {
  const { workspaceId, channelId, connectionId, routingKeys, isDefault, routingKeyLabel } = params;
  if (routingKeys.length === 0 && !isDefault) return;

  const others = await db.deskCallSettings.findMany({
    where: { workspaceId, connectionId, NOT: { channelId } },
  });
  const wanted = new Set(routingKeys);
  const contenders = others.filter(
    other => (isDefault && other.isDefault) || other.routingKeys.some(key => wanted.has(key)),
  );
  if (contenders.length === 0) return;

  // Existence is checked workspace-wide; names only for desks the caller can see.
  const contenderIds = contenders.map(other => other.channelId);
  const [existingIds, visibleDesks] = await Promise.all([
    findWorkspaceDeskIds(workspaceId, { ids: contenderIds }),
    db.channel.findMany({
      where: { workspaceId, id: { in: contenderIds } },
      select: { id: true, name: true },
    }),
  ]);
  const existing = new Set(existingIds);
  const names = new Map(visibleDesks.map(desk => [desk.id, desk.name]));
  const stale = contenderIds.filter(id => !existing.has(id));
  if (stale.length > 0) {
    await db.deskCallSettings.deleteMany({ where: { workspaceId, channelId: { in: stale } } });
  }

  for (const other of contenders) {
    if (!existing.has(other.channelId)) continue;
    const name = names.get(other.channelId);
    const deskName = name ? `"${name}"` : 'another desk';
    const clash = other.routingKeys.find(key => wanted.has(key));
    if (clash) {
      throw new CallConfigError(`${routingKeyLabel} "${clash}" already routes to ${deskName}`, 409, {
        routingKeys: [`"${clash}" already routes to ${deskName}`],
      });
    }
    throw new CallConfigError(`${deskName} is already the default desk for this connection`, 409, {
      isDefault: [`${deskName} is already the default desk for this connection`],
    });
  }
}

export const deskCallSettingsService = {
  async get(workspaceId: string, channelId: string): Promise<DeskCallSettingsView | null> {
    const row = await db.deskCallSettings.findFirst({ where: { workspaceId, channelId } });
    return row ? toView(row) : null;
  },

  async listForConnection(workspaceId: string, connectionId: string): Promise<DeskCallSettingsView[]> {
    const rows = await db.deskCallSettings.findMany({ where: { workspaceId, connectionId } });
    return rows.map(toView);
  },

  async listForWorkspace(workspaceId: string): Promise<DeskCallSettingsView[]> {
    const rows = await db.deskCallSettings.findMany({ where: { workspaceId } });
    return rows.map(toView);
  },

  /** The desk a call goes to: the one routing its key, else the connection's default desk. */
  pickDesk(
    settings: DeskCallSettingsView[],
    routingKey: string | null | undefined,
  ): DeskCallSettingsView | null {
    const key = routingKey?.trim();
    return (
      (key ? settings.find(desk => desk.routingKeys.includes(key)) : undefined) ??
      settings.find(desk => desk.isDefault) ??
      null
    );
  },

  async save(
    workspaceId: string,
    channelId: string,
    input: DeskCallSettingsInput,
    updatedBy: string,
  ): Promise<DeskCallSettingsView> {
    const [channel, connection] = await Promise.all([
      db.channel.findFirst({ where: { id: channelId, workspaceId }, select: { type: true } }),
      db.externalSource.findFirst({
        where: {
          id: input.connectionId,
          workspaceId,
          ...WORKSPACE_LEVEL,
          isActive: true,
          sourceType: { in: [...CALL_PROVIDER_IDS] },
        },
        select: { id: true, sourceType: true },
      }),
    ]);
    if (!channel) throw new CallConfigError('Desk not found', 404);
    if (channel.type !== ChannelType.CALL && channel.type !== ChannelType.APP) {
      throw new CallConfigError('Only call and app desks can use a call connection');
    }
    const provider = getCallProvider(connection?.sourceType);
    if (!connection || !provider) {
      throw new CallConfigError('Call connection not found', 404, {
        connectionId: ['Choose a call connection'],
      });
    }

    // Call desks route and create tickets; app desks only dial out from their tickets.
    const isCallDesk = channel.type === ChannelType.CALL;
    const routingKeys = isCallDesk ? uniqueTrimmed(input.routingKeys ?? []) : [];
    const isDefault = isCallDesk && input.isDefault === true;
    if (isCallDesk) {
      await assertRoutingFree({
        workspaceId,
        channelId,
        connectionId: connection.id,
        routingKeys,
        isDefault,
        routingKeyLabel: provider.routingKeyLabel ?? 'Routing key',
      });
    }

    const data = {
      connectionId: connection.id,
      provider: provider.id,
      isDefault,
      routingKeys,
      ticketRules: isCallDesk ? normalizeTicketRules(input.ticketRules, provider) : Prisma.DbNull,
      phoneFieldNames: isCallDesk ? [] : uniqueTrimmed(input.phoneFieldNames ?? []),
      updatedBy,
    };
    try {
      const row = await db.deskCallSettings.upsert({
        where: { channelId },
        create: { channelId, workspaceId, ...data },
        update: data,
      });
      return toView(row);
    } catch (error) {
      // desk_call_settings_one_default: another desk became the default after the check above.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new CallConfigError('Another desk is already the default desk for this connection', 409);
      }
      throw error;
    }
  },

  async remove(workspaceId: string, channelId: string): Promise<void> {
    await db.deskCallSettings.deleteMany({ where: { workspaceId, channelId } });
  },
};
