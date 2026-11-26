import { Prisma } from '@prisma/client';
import { ChannelType, deskTypeForChannelType, EmailMergeMode } from '@xyne/shared';
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

/** Workspace-wide routing from before desk settings, as it lands on one desk. */
export interface LegacyDeskCallSettings {
  channelId: string;
  channelType: string;
  isDefault?: boolean;
  routingKeys?: string[];
  ticketRules?: DeskCallTicketRules;
  phoneFieldNames?: string[];
}

const MAX_SUBJECT_TEMPLATE_LENGTH = 300;

/** The desk's email_channel_preferences columns that hold its call settings. */
const CALL_SETTINGS_SELECT = {
  channelId: true,
  callConnectionId: true,
  callIsDefault: true,
  callSettings: true,
} satisfies Prisma.EmailChannelPreferenceSelect;

type CallSettingsRow = Prisma.EmailChannelPreferenceGetPayload<{ select: typeof CALL_SETTINGS_SELECT }>;
type ConfiguredRow = CallSettingsRow & { callConnectionId: string };

const NO_CALL_SETTINGS = {
  callConnectionId: null,
  callIsDefault: false,
  callSettings: Prisma.DbNull,
} satisfies Prisma.EmailChannelPreferenceUpdateManyMutationInput;

/** The callSettings JSON: CALL desks keep routingKeys and ticketRules, APP desks phoneFieldNames. */
type StoredCallSettings = Pick<DeskCallSettingsView, 'routingKeys' | 'ticketRules' | 'phoneFieldNames'>;

function uniqueTrimmed(values: readonly unknown[]): string[] {
  const trimmed = values
    .map(value => (typeof value === 'string' ? value.trim() : ''))
    .filter(value => value.length > 0);
  return [...new Set(trimmed)];
}

function asRecord(value: unknown): Record<string, unknown> {
  return (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
}

function readCallSettings(value: Prisma.JsonValue | null): StoredCallSettings {
  const raw = asRecord(value);
  return {
    routingKeys: Array.isArray(raw.routingKeys) ? uniqueTrimmed(raw.routingKeys) : [],
    ticketRules: parseTicketRules(raw.ticketRules),
    phoneFieldNames: Array.isArray(raw.phoneFieldNames) ? uniqueTrimmed(raw.phoneFieldNames) : [],
  };
}

/** Only the keys given are stored; reads default the rest. */
function callSettingsJson(settings: {
  routingKeys?: string[] | undefined;
  ticketRules?: DeskCallTicketRules | undefined;
  phoneFieldNames?: string[] | undefined;
}): Prisma.InputJsonObject {
  return {
    ...(settings.routingKeys ? { routingKeys: settings.routingKeys } : {}),
    ...(settings.ticketRules ? { ticketRules: settings.ticketRules } : {}),
    ...(settings.phoneFieldNames ? { phoneFieldNames: settings.phoneFieldNames } : {}),
  };
}

function parseTicketRules(value: unknown): DeskCallTicketRules {
  const raw = asRecord(value);
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

function isConfigured(row: CallSettingsRow): row is ConfiguredRow {
  return row.callConnectionId !== null;
}

function toView(row: ConfiguredRow): DeskCallSettingsView {
  return {
    channelId: row.channelId,
    connectionId: row.callConnectionId,
    isDefault: row.callIsDefault,
    ...readCallSettings(row.callSettings),
  };
}

/** Desks get their preferences row when created; this covers an older desk without one. */
function newPreferenceRow(workspaceId: string, channelId: string, channelType: string) {
  return {
    channelId,
    workspaceId,
    deskType: deskTypeForChannelType(channelType),
    // As desk creation sets it for call and app desks.
    emailMergeMode: EmailMergeMode.DISABLED,
  };
}

/** Rejects routing another desk on the same connection already holds. */
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

  const rows = await db.emailChannelPreference.findMany({
    where: { workspaceId, callConnectionId: connectionId, NOT: { channelId } },
    select: CALL_SETTINGS_SELECT,
  });
  const others = rows.map(row => ({
    channelId: row.channelId,
    isDefault: row.callIsDefault,
    routingKeys: readCallSettings(row.callSettings).routingKeys,
  }));
  const wanted = new Set(routingKeys);
  const contenders = others.filter(
    other => (isDefault && other.isDefault) || other.routingKeys.some(key => wanted.has(key)),
  );
  const other = contenders[0];
  if (!other) return;

  // Request-scoped, so a private desk the caller isn't in stays unnamed.
  const desk = await db.channel.findFirst({
    where: { workspaceId, id: other.channelId },
    select: { name: true },
  });
  const deskName = desk?.name ? `"${desk.name}"` : 'another desk';
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

/** A desk's call settings live on its email_channel_preferences row (the call* columns). */
export const deskCallSettingsService = {
  async get(workspaceId: string, channelId: string): Promise<DeskCallSettingsView | null> {
    const row = await db.emailChannelPreference.findFirst({
      where: { workspaceId, channelId },
      select: CALL_SETTINGS_SELECT,
    });
    return row && isConfigured(row) ? toView(row) : null;
  },

  async listForConnection(workspaceId: string, connectionId: string): Promise<DeskCallSettingsView[]> {
    const rows = await db.emailChannelPreference.findMany({
      where: { workspaceId, callConnectionId: connectionId },
      select: CALL_SETTINGS_SELECT,
    });
    return rows.filter(isConfigured).map(toView);
  },

  /** Desks on any connection in the workspace. */
  async listForWorkspace(workspaceId: string): Promise<DeskCallSettingsView[]> {
    const rows = await db.emailChannelPreference.findMany({
      where: { workspaceId, callConnectionId: { not: null } },
      select: CALL_SETTINGS_SELECT,
    });
    return rows.filter(isConfigured).map(toView);
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
      callConnectionId: connection.id,
      callIsDefault: isDefault,
      callSettings: isCallDesk
        ? callSettingsJson({ routingKeys, ticketRules: normalizeTicketRules(input.ticketRules, provider) })
        : callSettingsJson({ phoneFieldNames: uniqueTrimmed(input.phoneFieldNames ?? []) }),
    };
    try {
      const row = await db.emailChannelPreference.upsert({
        where: { channelId },
        create: { ...newPreferenceRow(workspaceId, channelId, channel.type), ...data },
        update: data,
        select: CALL_SETTINGS_SELECT,
      });
      return toView({ ...row, callConnectionId: connection.id });
    } catch (error) {
      // email_channel_preferences_one_default_call_desk: another desk became the default after the check above.
      if (isDefault && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new CallConfigError('Another desk is already the default desk for this connection', 409);
      }
      throw error;
    }
  },

  /** For a desk about to be created: the routing clash save() would reject, before anything exists. */
  async assertNewDeskRoutingFree(
    workspaceId: string,
    connectionId: string,
    input: { routingKeys?: string[]; isDefault?: boolean },
    routingKeyLabel = 'Routing key',
  ): Promise<void> {
    await assertRoutingFree({
      workspaceId,
      channelId: '', // no desk yet
      connectionId,
      routingKeys: uniqueTrimmed(input.routingKeys ?? []),
      isDefault: input.isDefault === true,
      routingKeyLabel,
    });
  },

  async remove(workspaceId: string, channelId: string): Promise<void> {
    await db.emailChannelPreference.updateMany({
      where: { workspaceId, channelId },
      data: NO_CALL_SETTINGS,
    });
  },

  /** Gives old workspace routing to desks with no call connection yet; desks set up since keep theirs. */
  async adoptLegacyRouting(
    workspaceId: string,
    connectionId: string,
    desks: LegacyDeskCallSettings[],
  ): Promise<void> {
    if (desks.length === 0) return;
    // One default per connection: skipped if a desk already holds it.
    const hasDefault =
      (await db.emailChannelPreference.count({
        where: { workspaceId, callConnectionId: connectionId, callIsDefault: true },
      })) > 0;

    await Promise.all(
      desks.map(async desk => {
        const data = {
          callConnectionId: connectionId,
          callIsDefault: !hasDefault && desk.isDefault === true,
          callSettings: callSettingsJson({
            routingKeys: desk.routingKeys,
            ticketRules: desk.ticketRules,
            phoneFieldNames: desk.phoneFieldNames,
          }),
        };
        const { count } = await db.emailChannelPreference.updateMany({
          where: { workspaceId, channelId: desk.channelId, callConnectionId: null },
          data,
        });
        if (count > 0) return;
        // No row yet. An existing row here is a desk set up since, which createMany skips.
        await db.emailChannelPreference.createMany({
          data: [{ ...newPreferenceRow(workspaceId, desk.channelId, desk.channelType), ...data }],
          skipDuplicates: true,
        });
      }),
    );
  },
};
