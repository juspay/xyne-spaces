import { randomBytes } from 'node:crypto';
import { DatabaseClient } from '@/database/client';
import { encrypt, decrypt } from '@/services/encryptionService';

export interface OzonetelAgent {
  agentId: string;
  skill?: string;
}

export interface OzonetelTicketRules {
  defaultChannelId?: string;
  campaignRouting?: Record<string, string>;
  createTicketOnEvent?: 'new_call' | 'agent_answered';
  createTicketOnInbound?: boolean;
  createTicketOnManual?: boolean;
  createTicketOnPreview?: boolean;
  createTicketOnProgressive?: boolean;
  createTicketOnPredictive?: boolean;
  ticketSubjectTemplate?: string;
}

export interface OzonetelConfig {
  apiKey: string;
  apiUser: string;
  baseUrl: string;
  agentMapping: Record<string, OzonetelAgent>;
  webhookSecret: string;
  toolbarUrl?: string;
  ticketRules?: OzonetelTicketRules;
}

const SOURCE_TYPE = 'ozonetel';

type SaveConfigInput = Omit<OzonetelConfig, 'webhookSecret'> & { webhookSecret?: string };

function buildSourceName(workspaceId: string, webhookSecret: string): string {
  return `ozonetel-${workspaceId}-${webhookSecret}`;
}

export class OzonetelConfigValidationError extends Error {
  constructor(
    message: string,
    public readonly details: { fieldErrors: Record<string, string[]> },
  ) {
    super(message);
    this.name = 'OzonetelConfigValidationError';
  }
}

function normalizeTicketRules(
  input?: OzonetelTicketRules | null,
): OzonetelTicketRules | undefined {
  if (!input) return undefined;

  const defaultChannelId = input.defaultChannelId?.trim() || undefined;
  const campaignRouting = Object.fromEntries(
    Object.entries(input.campaignRouting ?? {})
      .map(([campaignName, channelId]) => [campaignName.trim(), channelId.trim()])
      .filter(([campaignName, channelId]) => campaignName.length > 0 && channelId.length > 0),
  );

  const normalized: OzonetelTicketRules = {
    ...input,
    ...(defaultChannelId ? { defaultChannelId } : {}),
    ...(Object.keys(campaignRouting).length > 0 ? { campaignRouting } : {}),
  };

  if (!defaultChannelId) {
    delete normalized.defaultChannelId;
  }
  if (Object.keys(campaignRouting).length === 0) {
    delete normalized.campaignRouting;
  }

  return normalized;
}

async function validateRoutingChannels(
  workspaceId: string,
  rules?: OzonetelTicketRules,
): Promise<void> {
  const referencedChannelIds = new Set<string>();
  const defaultChannelId = rules?.defaultChannelId?.trim();
  if (defaultChannelId) referencedChannelIds.add(defaultChannelId);

  for (const channelId of Object.values(rules?.campaignRouting ?? {})) {
    const trimmed = channelId.trim();
    if (trimmed) referencedChannelIds.add(trimmed);
  }

  if (referencedChannelIds.size === 0) return;

  const db = DatabaseClient.getInstance();
  const channels = await db.channel.findMany({
    where: {
      workspaceId,
      id: { in: Array.from(referencedChannelIds) },
      type: 'CALL',
    },
    select: { id: true },
  });
  const validIds = new Set(channels.map(channel => channel.id));
  const invalid = Array.from(referencedChannelIds).filter(channelId => !validIds.has(channelId));

  if (invalid.length > 0) {
    throw new OzonetelConfigValidationError('Invalid Ozonetel routing configuration', {
      fieldErrors: {
        ticketRules: ['Every default or campaign route must point to a call desk in this workspace.'],
      },
    });
  }
}

async function validateOzonetelConfig(
  workspaceId: string,
  config: SaveConfigInput,
): Promise<void> {
  await validateRoutingChannels(workspaceId, config.ticketRules);
}

export const ozonetelConfigService = {
  async getConfig(workspaceId: string): Promise<OzonetelConfig | null> {
    const db = DatabaseClient.getInstance();
    const source = await db.externalSource.findUnique({
      where: { workspaceId_sourceType: { workspaceId, sourceType: SOURCE_TYPE } },
    });
    if (!source || !source.isActive) return null;
    const config = JSON.parse(decrypt(source.credentials)) as OzonetelConfig;
    const normalizedTicketRules = normalizeTicketRules(config.ticketRules);
    if (normalizedTicketRules) {
      config.ticketRules = normalizedTicketRules;
    }
    const expectedName = buildSourceName(workspaceId, config.webhookSecret);

    if (source.name !== expectedName) {
      await db.externalSource.update({
        where: { id: source.id },
        data: { name: expectedName },
      });
    }

    return config;
  },

  async getSourceName(workspaceId: string): Promise<string | null> {
    const cfg = await this.getConfig(workspaceId);
    if (!cfg) return null;
    return buildSourceName(workspaceId, cfg.webhookSecret);
  },

  async saveConfig(workspaceId: string, config: SaveConfigInput): Promise<OzonetelConfig> {
    const ticketRules = normalizeTicketRules(config.ticketRules);
    await validateOzonetelConfig(workspaceId, { ...config, ...(ticketRules ? { ticketRules } : {}) });
    const full: OzonetelConfig = {
      ...config,
      ...(ticketRules ? { ticketRules } : {}),
      webhookSecret: config.webhookSecret ?? randomBytes(24).toString('hex'),
    };
    const credentials = encrypt(JSON.stringify(full));
    const name = buildSourceName(workspaceId, full.webhookSecret);
    await DatabaseClient.getInstance().externalSource.upsert({
      where: { workspaceId_sourceType: { workspaceId, sourceType: SOURCE_TYPE } },
      create: {
        name,
        sourceType: SOURCE_TYPE,
        displayName: 'Ozonetel',
        workspaceId,
        credentials,
        isActive: true,
      },
      update: { credentials, isActive: true },
    });
    return full;
  },

  resolveTargetChannelId(
    ticketRules: OzonetelTicketRules | null | undefined,
    metadata: Record<string, unknown> | null | undefined,
  ): string | null {
    const campaignName =
      typeof metadata?.campaignName === 'string' ? metadata.campaignName.trim() : '';
    if (campaignName) {
      const routedChannelId = ticketRules?.campaignRouting?.[campaignName]?.trim();
      if (routedChannelId) return routedChannelId;
    }

    const defaultChannelId = ticketRules?.defaultChannelId?.trim();
    return defaultChannelId || null;
  },
};
