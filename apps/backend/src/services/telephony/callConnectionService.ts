import { randomBytes } from 'node:crypto';
import type { ExternalSource, Prisma } from '@prisma/client';
import { ChannelType } from '@xyne/shared';
import { findWorkspaceDeskIds } from '@/bypassAcl/callConnectionServices';
import { config } from '@/config/env';
import { db } from '@/database/client';
import { WORKSPACE_LEVEL } from '@/integrations/core/sourceScope';
import { decrypt, encrypt } from '@/services/encryptionService';
import { logger } from '@/utils/logger';
import { CallConfigError, type CallProvider, type CallProviderCredentials } from './callProvider';
import { CALL_PROVIDER_IDS } from './callProviderIds';
import { getCallProvider } from './callProviderRegistry';
import type { DeskCallTicketRules } from './deskCallSettingsService';

const TAG = '[CallConnection]';
const MAX_NAME_LENGTH = 80;

export type CallAgentMapping = Record<string, { agentId: string; skill?: string }>;

/** A workspace call-provider connection: one workspace-level ExternalSource row. */
export interface CallConnection {
  id: string;
  workspaceId: string;
  provider: CallProvider;
  name: string;
  /** ExternalSource.name and the webhook path segment, so it contains the webhook secret. */
  sourceName: string;
  webhookSecret: string;
  agentMapping: CallAgentMapping;
  /** The provider's own fields. */
  credentials: CallProviderCredentials;
}

/** Workspace-wide routing saved before desk settings existed; moved to desk_call_settings on first read. */
interface LegacyTicketRules {
  defaultChannelId?: string;
  campaignRouting?: Record<string, string>;
  createTicketOnEvent?: string;
  createTicketOnInbound?: boolean;
  createTicketOnManual?: boolean;
  createTicketOnPreview?: boolean;
  createTicketOnProgressive?: boolean;
  createTicketOnPredictive?: boolean;
  ticketSubjectTemplate?: string;
  phoneFieldNames?: string[];
  customerPhoneFieldName?: string;
}

type StoredCredentials = CallProviderCredentials & {
  webhookSecret?: string;
  agentMapping?: CallAgentMapping;
  ticketRules?: LegacyTicketRules;
};

const LEGACY_CALL_TYPE_FLAGS = [
  ['inbound', 'createTicketOnInbound'],
  ['manual', 'createTicketOnManual'],
  ['preview', 'createTicketOnPreview'],
  ['progressive', 'createTicketOnProgressive'],
  ['predictive', 'createTicketOnPredictive'],
] as const;

const CALL_SOURCE_WHERE = {
  ...WORKSPACE_LEVEL,
  isActive: true,
  sourceType: { in: [...CALL_PROVIDER_IDS] },
};

function sourceNameFor(providerId: string, workspaceId: string, webhookSecret: string): string {
  return `${providerId}-${workspaceId}-${webhookSecret}`;
}

function readStored(source: ExternalSource): StoredCredentials | null {
  try {
    const parsed = JSON.parse(decrypt(source.credentials)) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as StoredCredentials)
      : null;
  } catch (error) {
    logger.error(`${TAG} unreadable credentials`, {
      connectionId: source.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function encryptStored(
  credentials: CallProviderCredentials,
  webhookSecret: string,
  agentMapping: CallAgentMapping,
): string {
  return encrypt(JSON.stringify({ ...credentials, webhookSecret, agentMapping }));
}

function normalizeName(raw: string): string {
  const name = raw.trim();
  if (!name) throw new CallConfigError('Name is required', 400, { name: ['Name is required'] });
  if (name.length > MAX_NAME_LENGTH) {
    throw new CallConfigError('Name is too long', 400, {
      name: [`Use at most ${MAX_NAME_LENGTH} characters`],
    });
  }
  return name;
}

function safeAccountKey(provider: CallProvider, credentials: CallProviderCredentials): string | null {
  try {
    return provider.accountKey(credentials);
  } catch {
    return null;
  }
}

function uniqueTrimmed(values: readonly unknown[]): string[] {
  const trimmed = values
    .map(value => (typeof value === 'string' ? value.trim() : ''))
    .filter(value => value.length > 0);
  return [...new Set(trimmed)];
}

/** Moves pre-desk-settings routing onto the desks, then drops it from the credentials. Safe to repeat. */
async function migrateLegacyTicketRules(
  source: ExternalSource,
  provider: CallProvider,
  stored: StoredCredentials,
  rules: LegacyTicketRules,
): Promise<void> {
  const subjectTemplate = rules.ticketSubjectTemplate?.trim();
  const ticketRules: DeskCallTicketRules = {
    createTicketOnEvent: rules.createTicketOnEvent === 'agent_answered' ? 'agent_answered' : 'new_call',
    callTypes: LEGACY_CALL_TYPE_FLAGS.filter(([, flag]) => rules[flag] === true).map(([id]) => id),
    ...(subjectTemplate ? { subjectTemplate } : {}),
  };

  const callDesks = new Map<string, { isDefault: boolean; routingKeys: string[] }>();
  const deskFor = (channelId: string): { isDefault: boolean; routingKeys: string[] } => {
    const desk = callDesks.get(channelId) ?? { isDefault: false, routingKeys: [] };
    callDesks.set(channelId, desk);
    return desk;
  };
  const defaultChannelId = rules.defaultChannelId?.trim();
  if (defaultChannelId) deskFor(defaultChannelId).isDefault = true;
  for (const [campaign, channelId] of Object.entries(rules.campaignRouting ?? {})) {
    if (campaign.trim() && typeof channelId === 'string' && channelId.trim()) {
      deskFor(channelId.trim()).routingKeys.push(campaign.trim());
    }
  }

  // Every app desk had the toolbar call button while the workspace had a toolbar URL.
  const hadSoftphone = provider.softphoneUrl(stored) !== null;
  const [validCallDesks, appDesks] = await Promise.all([
    callDesks.size > 0
      ? findWorkspaceDeskIds(source.workspaceId, { type: ChannelType.CALL, ids: [...callDesks.keys()] })
      : Promise.resolve([]),
    hadSoftphone
      ? findWorkspaceDeskIds(source.workspaceId, { type: ChannelType.APP })
      : Promise.resolve([]),
  ]);

  const phoneFieldNames = uniqueTrimmed([...(rules.phoneFieldNames ?? []), rules.customerPhoneFieldName]);
  const base = { workspaceId: source.workspaceId, connectionId: source.id, provider: provider.id };
  const rows: Prisma.DeskCallSettingsCreateManyInput[] = [
    ...validCallDesks.map(id => ({
      ...base,
      channelId: id,
      isDefault: callDesks.get(id)?.isDefault ?? false,
      routingKeys: uniqueTrimmed(callDesks.get(id)?.routingKeys ?? []),
      ticketRules,
    })),
    ...appDesks.map(id => ({ ...base, channelId: id, phoneFieldNames })),
  ];
  if (rows.length > 0) {
    // Desks configured since keep their settings.
    await db.deskCallSettings.createMany({ data: rows, skipDuplicates: true });
  }

  const rest: StoredCredentials = { ...stored };
  delete rest.ticketRules;
  await db.externalSource.update({
    where: { id: source.id },
    data: { credentials: encrypt(JSON.stringify(rest)) },
  });
  logger.info(`${TAG} moved workspace routing to desk settings`, {
    connectionId: source.id,
    workspaceId: source.workspaceId,
    callDesks: validCallDesks.length,
    appDesks: appDesks.length,
  });
}

export const callConnectionService = {
  /** Decrypts an active call connection; null for other or unreadable sources. */
  async fromSource(source: ExternalSource): Promise<CallConnection | null> {
    const provider = getCallProvider(source.sourceType);
    if (!provider || !source.isActive) return null;
    const stored = readStored(source);
    const webhookSecret = typeof stored?.webhookSecret === 'string' ? stored.webhookSecret : '';
    if (!stored || !webhookSecret) return null;

    const { agentMapping, ticketRules } = stored;
    const credentials: CallProviderCredentials = { ...stored };
    delete credentials.webhookSecret;
    delete credentials.agentMapping;
    delete credentials.ticketRules;
    if (ticketRules) {
      try {
        await migrateLegacyTicketRules(source, provider, stored, ticketRules);
      } catch (error) {
        // The rules stay in the credentials, so the next read retries.
        logger.error(`${TAG} moving workspace routing to desk settings failed`, {
          connectionId: source.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const sourceName = sourceNameFor(provider.id, source.workspaceId, webhookSecret);
    if (source.name !== sourceName) {
      await db.externalSource.update({ where: { id: source.id }, data: { name: sourceName } });
    }

    return {
      id: source.id,
      workspaceId: source.workspaceId,
      provider,
      name: source.displayName,
      sourceName,
      webhookSecret,
      agentMapping: agentMapping && typeof agentMapping === 'object' ? agentMapping : {},
      credentials,
    };
  },

  async getBySourceId(sourceId: string): Promise<CallConnection | null> {
    const source = await db.externalSource.findUnique({ where: { id: sourceId } });
    return source ? this.fromSource(source) : null;
  },

  async get(workspaceId: string, connectionId: string): Promise<CallConnection | null> {
    const source = await db.externalSource.findFirst({
      where: { id: connectionId, workspaceId, ...CALL_SOURCE_WHERE },
    });
    return source ? this.fromSource(source) : null;
  },

  async list(workspaceId: string): Promise<CallConnection[]> {
    const sources = await db.externalSource.findMany({
      where: { workspaceId, ...CALL_SOURCE_WHERE },
      orderBy: { createdAt: 'asc' },
    });
    const connections = await Promise.all(sources.map(source => this.fromSource(source)));
    return connections.filter((connection): connection is CallConnection => connection !== null);
  },

  /** Names must be unique, and one provider account backs at most one connection. */
  async assertUnique(
    workspaceId: string,
    provider: CallProvider,
    credentials: CallProviderCredentials,
    name: string,
    exceptId?: string,
  ): Promise<void> {
    const others = (await this.list(workspaceId)).filter(connection => connection.id !== exceptId);
    if (others.some(connection => connection.name.toLowerCase() === name.toLowerCase())) {
      throw new CallConfigError(`A connection named "${name}" already exists`, 409, {
        name: ['This name is already used'],
      });
    }
    const accountKey = safeAccountKey(provider, credentials);
    const clash = others.find(
      connection =>
        connection.provider.id === provider.id &&
        accountKey !== null &&
        safeAccountKey(connection.provider, connection.credentials) === accountKey,
    );
    if (clash) {
      throw new CallConfigError(
        `This ${provider.displayName} account is already connected as "${clash.name}"`,
        409,
      );
    }
  },

  async create(
    workspaceId: string,
    input: {
      provider: string;
      name: string;
      credentials: Record<string, unknown>;
      agentMapping: CallAgentMapping;
    },
  ): Promise<CallConnection> {
    const provider = getCallProvider(input.provider);
    if (!provider) {
      throw new CallConfigError('Unknown call provider', 400, { provider: ['Choose a call provider'] });
    }
    const name = normalizeName(input.name);
    const credentials = provider.parseCredentials(input.credentials);
    await this.assertUnique(workspaceId, provider, credentials, name);

    const webhookSecret = randomBytes(24).toString('hex');
    const source = await db.externalSource.create({
      data: {
        name: sourceNameFor(provider.id, workspaceId, webhookSecret),
        sourceType: provider.id,
        displayName: name,
        workspaceId,
        credentials: encryptStored(credentials, webhookSecret, input.agentMapping),
        isActive: true,
      },
    });
    logger.info(`${TAG} created`, { workspaceId, connectionId: source.id, provider: provider.id });
    return {
      id: source.id,
      workspaceId,
      provider,
      name,
      sourceName: source.name,
      webhookSecret,
      agentMapping: input.agentMapping,
      credentials,
    };
  },

  /** Keeps the webhook secret, so the provider-side webhook URL stays valid. */
  async update(
    workspaceId: string,
    connectionId: string,
    input: {
      name?: string;
      credentials?: Record<string, unknown>;
      agentMapping?: CallAgentMapping;
    },
  ): Promise<CallConnection> {
    const existing = await this.get(workspaceId, connectionId);
    if (!existing) throw new CallConfigError('Call connection not found', 404);

    const name = input.name === undefined ? existing.name : normalizeName(input.name);
    const credentials = input.credentials
      ? existing.provider.parseCredentials(input.credentials, existing.credentials)
      : existing.credentials;
    const agentMapping = input.agentMapping ?? existing.agentMapping;
    await this.assertUnique(workspaceId, existing.provider, credentials, name, existing.id);

    await db.externalSource.update({
      where: { id: existing.id },
      data: {
        displayName: name,
        credentials: encryptStored(credentials, existing.webhookSecret, agentMapping),
      },
    });
    logger.info(`${TAG} updated`, { workspaceId, connectionId });
    return { ...existing, name, credentials, agentMapping };
  },

  /** Deactivates the connection; refused while a desk still uses it. */
  async remove(workspaceId: string, connectionId: string): Promise<void> {
    const existing = await this.get(workspaceId, connectionId);
    if (!existing) throw new CallConfigError('Call connection not found', 404);
    const desks = await db.deskCallSettings.count({ where: { workspaceId, connectionId } });
    if (desks > 0) {
      throw new CallConfigError(
        `${desks} desk${desks === 1 ? ' uses' : 's use'} this connection. Move ${desks === 1 ? 'it' : 'them'} to another connection first.`,
        409,
      );
    }
    await db.externalSource.update({ where: { id: existing.id }, data: { isActive: false } });
    logger.info(`${TAG} removed`, { workspaceId, connectionId });
  },

  webhookUrl(connection: CallConnection): string {
    const base = String(config.backendUrl ?? '').trim().replace(/\/$/, '');
    if (!base) throw new CallConfigError('Cannot build the webhook URL without BACKEND_URL', 500);
    return `${base}/api/external-source-sync/${connection.sourceName}/ingest`;
  },

  /** Registers the webhook with the provider; null when the provider has no subscription API. */
  async subscribe(connection: CallConnection): Promise<string | null> {
    if (!connection.provider.subscribeEvents) return null;
    return connection.provider.subscribeEvents(connection.credentials, this.webhookUrl(connection));
  },

  softphoneUrl(connection: CallConnection): string | null {
    try {
      return connection.provider.softphoneUrl(connection.credentials);
    } catch {
      return null;
    }
  },
};
