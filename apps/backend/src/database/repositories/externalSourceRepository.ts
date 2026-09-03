/**
 * External Source Repository
 * Database operations for ExternalSource model
 */

import { DatabaseClient } from '../client';
import { WORKSPACE_LEVEL } from '@/integrations/core/sourceScope';
import { encrypt, decrypt } from '@/services/encryptionService';
import type { ExternalSource } from '@prisma/client';

export type CalendarProvider = 'GOOGLE' | 'MICROSOFT';

export interface CalendarSourceCredentials {
  refreshToken: string;
  accessToken?: string;
  accessTokenExpiry?: string;
  resourceId?: string;     // Google Calendar resource id
  channelToken?: string;   // Google Calendar channel token echoed in X-Goog-Channel-Token
  clientState?: string;    // Microsoft Graph client state
  expiration?: string;     // ISO expiration for Google or Microsoft watch/subscription
}

const CALENDAR_SOURCE_TYPES: Record<CalendarProvider, string> = {
  GOOGLE: 'google_calendar',
  MICROSOFT: 'microsoft_calendar',
};
const CALENDAR_EXPIRING_SOURCE_PAGE_SIZE = 500;

export function getCalendarSourceType(provider: CalendarProvider): string {
  return CALENDAR_SOURCE_TYPES[provider];
}

export function parseCalendarCredentials(
  encryptedCredentials: string,
): CalendarSourceCredentials | null {
  if (!encryptedCredentials) return null;
  try {
    return JSON.parse(decrypt(encryptedCredentials)) as CalendarSourceCredentials;
  } catch {
    return null;
  }
}

export function serializeCalendarCredentials(
  credentials: CalendarSourceCredentials,
): string {
  return encrypt(JSON.stringify(credentials));
}

export class ExternalSourceRepository {
  private db = DatabaseClient.getInstance();

  /**
   * Find external source by name
   * Returns raw source with encrypted credentials
   */
  async findByName(name: string) {
    return await this.db.externalSource.findUnique({
      where: { name }
    });
  }

  /**
   * Find every migration source for a Slack channel.
   *
   * Migration source names are `slackMigration-<slackChannelId>-<xyneChannelId>`
   * (one row per Xyne channel the Slack channel was migrated into), plus a legacy
   * unsuffixed `slackMigration-<slackChannelId>`. The trailing `-` anchors the
   * prefix match so `C123` does not also match `C1234`.
   */
  async findSlackMigrationSourcesByChannel(slackChannelId: string) {
    const base = `slackMigration-${slackChannelId}`;
    return await this.db.externalSource.findMany({
      where: {
        OR: [{ name: base }, { name: { startsWith: `${base}-` } }],
      },
    });
  }

  /**
   * Find external source by ID
   * Returns raw source with encrypted credentials
   */
  async findById(id: string) {
    return await this.db.externalSource.findUnique({
      where: { id }
    });
  }

  /** Find the most recently updated active source of a type owned by a user. */
  async findActiveByOwnerAndSourceType(ownerUserId: string, sourceType: string) {
    return await this.db.externalSource.findFirst({
      where: { ownerUserId, sourceType, isActive: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /**
   * Create external source
   * @param data.credentials - Encrypted credentials string (use encrypt() from encryptionService)
   * @param data.boardId - Optional target board for ticket creation
   */
  async create(data: {
    name: string;
    sourceType: string;
    displayName: string;
    channelId?: string;
    externalIdentifier?: string;
    boardId?: string; // Target board for ticket creation
    credentials: string; // Encrypted credentials
    ownerUserId?: string; // Owner for user-scoped integrations (calendar, gmail search)
    workspaceId?: string;
    isActive?: boolean;
    lastSyncCursor?: string | null;
  }) {
    // workspaceId is a required tenant key — every row must carry one. Prefer the
    // explicit value, then denormalize from whichever parent the caller supplied:
    // the channel for channel-bound sources, or the owner for user-scoped ones
    // (calendar watches, which have no channel).
    let workspaceId = data.workspaceId;
    if (!workspaceId && data.channelId) {
      const channel = await this.db.channel.findUniqueOrThrow({
        where: { id: data.channelId },
        select: { workspaceId: true },
      });
      workspaceId = channel.workspaceId;
    }
    if (!workspaceId && data.ownerUserId) {
      const owner = await this.db.user.findUniqueOrThrow({
        where: { id: data.ownerUserId },
        select: { workspaceId: true },
      });
      workspaceId = owner.workspaceId;
    }
    if (!workspaceId) {
      throw new Error(
        'externalSource create requires a workspaceId, or a channelId/ownerUserId to derive it from',
      );
    }

    return await this.db.externalSource.create({
      data: {
        name: data.name,
        sourceType: data.sourceType,
        displayName: data.displayName,
        channelId: data.channelId,
        externalIdentifier: data.externalIdentifier,
        boardId: data.boardId,
        credentials: data.credentials,
        ownerUserId: data.ownerUserId,
        workspaceId,
        isActive: data.isActive ?? true,
        lastSyncCursor: data.lastSyncCursor,
      }
    });
  }

  /**
   * Update external source
   */
  async update(id: string, data: {
    name?: string;
    displayName?: string;
    channelId?: string | null;
    externalIdentifier?: string | null;
    boardId?: string;
    isActive?: boolean;
    credentials?: string;
    lastSyncCursor?: string | null;
    ownerUserId?: string;
    workspaceId?: string;
  }) {
    return await this.db.externalSource.update({
      where: { id },
      data
    });
  }

  /**
   * Delete external source
   */
  async delete(id: string) {
    return await this.db.externalSource.delete({
      where: { id }
    });
  }

  /**
   * List all external sources
   */
  async findAll(filter?: {
    sourceType?: string | { in: string[] };
    isActive?: boolean;
  }) {
    return await this.db.externalSource.findMany({
      where: filter,
      orderBy: { createdAt: 'desc' }
    });
  }

  /**
   * Count messages for a source
   */
  async getMessageCount(sourceId: string): Promise<number> {
    return await this.db.externalMessage.count({
      where: { externalSourceId: sourceId }
    });
  }

  /**
   * Find external source by channel ID
   */
  async findByChannelId(channelId: string) {
    return await this.db.externalSource.findFirst({
      where: { channelId },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
    });
  }

  /**
   * Find external source by external identifier
   */
  async findByExternalIdentifier(externalIdentifier: string) {
    return await this.db.externalSource.findFirst({
      where: { externalIdentifier }
    });
  }

  /**
   * Find active email external source (Google/Microsoft) for a workspace.
   */
  async findEmailSourceByWorkspaceId(workspaceId: string) {
    return await this.db.externalSource.findFirst({
      where: { workspaceId, ...WORKSPACE_LEVEL, sourceType: { in: ['google', 'microsoft'] }, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Find a Google-backed source by the connected mailbox address.
   * Prefers the separate channel-email source over the legacy desk source.
   */
  async findGoogleSourceByDisplayEmail(displayEmail: string) {
    const normalized = displayEmail.trim().toLowerCase();
    const channelEmailSource = await this.db.externalSource.findFirst({
      where: {
        displayName: { equals: normalized, mode: 'insensitive' },
        sourceType: 'google-channel-email',
        isActive: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (channelEmailSource) {
      return channelEmailSource;
    }

    return await this.db.externalSource.findFirst({
      where: {
        displayName: { equals: normalized, mode: 'insensitive' },
        sourceType: 'google',
        isActive: true,
      },
      orderBy: { createdAt: 'desc' },
      });
  }


  // ========================================================================
  // Calendar integration helpers
  // ========================================================================

  private calendarName(ownerUserId: string, provider: CalendarProvider): string {
    const suffix = provider === 'GOOGLE' ? 'google' : 'microsoft';
    return `calendar-${suffix}-${ownerUserId}`;
  }

  /**
   * Fully disconnect a calendar source: clears the stored refresh/access
   * tokens (not just the watch channel) and marks it inactive. Used by the
   * "Disconnect" action in Calendar preferences so a subsequent reconnect
   * goes through Google's/Microsoft's OAuth consent screen again from
   * scratch — required to pick up newly-added scopes (e.g. calendar.events)
   * that an existing token grant wouldn't otherwise include.
   */
  async disconnectCalendarSource(id: string): Promise<void> {
    await this.update(id, {
      externalIdentifier: null,
      isActive: false,
      credentials: serializeCalendarCredentials({ refreshToken: '' }),
    });
  }

  async findCalendarSourceByOwner(
    ownerUserId: string,
    provider: CalendarProvider,
  ): Promise<ExternalSource | null> {
    return this.db.externalSource.findFirst({
      where: {
        sourceType: getCalendarSourceType(provider),
        ownerUserId,
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findCalendarSourceByExternalIdentifier(
    externalIdentifier: string,
  ): Promise<ExternalSource | null> {
    return this.db.externalSource.findFirst({
      where: {
        externalIdentifier,
        sourceType: { in: ['google_calendar', 'microsoft_calendar'] },
      },
    });
  }

  async upsertGoogleCalendarWatch(params: {
    email: string;
    ownerUserId: string;
    channelId: string;
    resourceId: string;
    channelToken: string;
    expiration: Date;
    refreshToken: string;
    accessToken?: string;
    accessTokenExpiry?: Date;
  }): Promise<ExternalSource> {
    const sourceType = getCalendarSourceType('GOOGLE');
    const existing = await this.findCalendarSourceByOwner(params.ownerUserId, 'GOOGLE');
    const existingCreds = existing
      ? parseCalendarCredentials(existing.credentials)
      : null;

    const credentials: CalendarSourceCredentials = {
      refreshToken: params.refreshToken,
      accessToken: params.accessToken ?? existingCreds?.accessToken,
      accessTokenExpiry: params.accessTokenExpiry
        ? params.accessTokenExpiry.toISOString()
        : existingCreds?.accessTokenExpiry,
      resourceId: params.resourceId,
      channelToken: params.channelToken,
      expiration: params.expiration.toISOString(),
    };

    if (existing) {
      return this.update(existing.id, {
        name: this.calendarName(params.ownerUserId, 'GOOGLE'),
        displayName: params.email,
        ownerUserId: params.ownerUserId,
        externalIdentifier: params.channelId,
        isActive: true,
        credentials: serializeCalendarCredentials(credentials),
      });
    }

    return this.create({
      name: this.calendarName(params.ownerUserId, 'GOOGLE'),
      sourceType,
      displayName: params.email,
      ownerUserId: params.ownerUserId,
      externalIdentifier: params.channelId,
      credentials: serializeCalendarCredentials(credentials),
      isActive: true,
    });
  }

  async upsertMicrosoftCalendarSubscription(params: {
    email: string;
    ownerUserId: string;
    subscriptionId: string;
    expiration: Date;
    clientState: string;
    refreshToken: string;
    accessToken?: string;
    accessTokenExpiry?: Date;
  }): Promise<ExternalSource> {
    const sourceType = getCalendarSourceType('MICROSOFT');
    const existing = await this.findCalendarSourceByOwner(params.ownerUserId, 'MICROSOFT');
    const existingCreds = existing
      ? parseCalendarCredentials(existing.credentials)
      : null;

    const credentials: CalendarSourceCredentials = {
      refreshToken: params.refreshToken,
      accessToken: params.accessToken ?? existingCreds?.accessToken,
      accessTokenExpiry: params.accessTokenExpiry
        ? params.accessTokenExpiry.toISOString()
        : existingCreds?.accessTokenExpiry,
      clientState: params.clientState,
      expiration: params.expiration.toISOString(),
    };

    if (existing) {
      return this.update(existing.id, {
        name: this.calendarName(params.ownerUserId, 'MICROSOFT'),
        displayName: params.email,
        ownerUserId: params.ownerUserId,
        externalIdentifier: params.subscriptionId,
        isActive: true,
        credentials: serializeCalendarCredentials(credentials),
      });
    }

    return this.create({
      name: this.calendarName(params.ownerUserId, 'MICROSOFT'),
      sourceType,
      displayName: params.email,
      ownerUserId: params.ownerUserId,
      externalIdentifier: params.subscriptionId,
      credentials: serializeCalendarCredentials(credentials),
      isActive: true,
    });
  }

  async revokeGoogleCalendarWatchById(id: string): Promise<void> {
    const existing = await this.findById(id);
    if (!existing) return;

    const creds = parseCalendarCredentials(existing.credentials);
    const updated: CalendarSourceCredentials = {
      refreshToken: creds?.refreshToken ?? '',
      accessToken: creds?.accessToken,
      accessTokenExpiry: creds?.accessTokenExpiry,
    };

    await this.update(existing.id, {
      externalIdentifier: null,
      isActive: false,
      credentials: serializeCalendarCredentials(updated),
    });
  }

  async revokeMicrosoftCalendarSubscriptionById(id: string): Promise<void> {
    const existing = await this.findById(id);
    if (!existing) return;

    const creds = parseCalendarCredentials(existing.credentials);
    const updated: CalendarSourceCredentials = {
      refreshToken: creds?.refreshToken ?? '',
      accessToken: creds?.accessToken,
      accessTokenExpiry: creds?.accessTokenExpiry,
    };

    await this.update(existing.id, {
      externalIdentifier: null,
      isActive: false,
      credentials: serializeCalendarCredentials(updated),
    });
  }

  async updateCalendarSyncStateById(
    id: string,
    params: {
      syncToken?: string | null;
      isActive?: boolean;
    },
  ): Promise<void> {
    const existing = await this.findById(id);
    if (!existing) return;

    await this.update(existing.id, {
      isActive: params.isActive ?? existing.isActive,
      lastSyncCursor: params.syncToken,
    });
  }

  async markCalendarError(id: string): Promise<void> {
    await this.update(id, { isActive: false });
  }

  async markMicrosoftSubscriptionExpired(id: string): Promise<void> {
    await this.update(id, {
      externalIdentifier: null,
      isActive: false,
    });
  }

  async clearMicrosoftSubscriptionFields(id: string): Promise<void> {
    const existing = await this.findById(id);
    if (!existing) return;

    const creds = parseCalendarCredentials(existing.credentials);
    const updated: CalendarSourceCredentials = {
      refreshToken: creds?.refreshToken ?? '',
      accessToken: creds?.accessToken,
      accessTokenExpiry: creds?.accessTokenExpiry,
    };

    await this.update(existing.id, {
      externalIdentifier: null,
      credentials: serializeCalendarCredentials(updated),
    });
  }

  async renewMicrosoftSubscription(id: string, expiration: Date): Promise<void> {
    const existing = await this.findById(id);
    if (!existing) return;

    const creds = parseCalendarCredentials(existing.credentials);
    const updated: CalendarSourceCredentials = {
      refreshToken: creds?.refreshToken ?? '',
      accessToken: creds?.accessToken,
      accessTokenExpiry: creds?.accessTokenExpiry,
      clientState: creds?.clientState,
      expiration: expiration.toISOString(),
    };

    await this.update(existing.id, {
      isActive: true,
      credentials: serializeCalendarCredentials(updated),
    });
  }

  async findExpiringCalendarSources(
    beforeDate: Date,
    provider: CalendarProvider,
  ): Promise<ExternalSource[]> {
    const expiring: ExternalSource[] = [];
    let cursor: string | undefined;

    while (true) {
      const sources = await this.db.externalSource.findMany({
        where: {
          sourceType: getCalendarSourceType(provider),
          isActive: true,
        },
        orderBy: { id: 'asc' },
        take: CALENDAR_EXPIRING_SOURCE_PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      if (sources.length === 0) break;

      for (const source of sources) {
        const creds = parseCalendarCredentials(source.credentials);
        if (!creds?.expiration || new Date(creds.expiration) <= beforeDate) {
          expiring.push(source);
        }
      }

      if (sources.length < CALENDAR_EXPIRING_SOURCE_PAGE_SIZE) break;
      cursor = sources[sources.length - 1]!.id;
    }

    return expiring;
  }
}
