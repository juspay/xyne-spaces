import { ChannelRole, type RouteBody } from '@xyne/shared';
import type {
  activityAliasesCreate,
  activityAliasesUpdate,
  clientEventsPost,
  clientEventsRemove,
  channelTagsConfigUpdate,
} from '@xyne/shared';
import { db } from '@/database/client';
import { DatabaseClient } from '@/database/client';
import { ChannelParticipantRepository } from '@/database/repositories/channelParticipantRepository';
import { ChannelRepository } from '@/database/repositories/channelRepository';
import { CustomEmojiRepository } from '@/database/repositories/customEmojiRepository';
import { EmailClassificationRepository } from '@/database/repositories/emailClassificationRepository';
import { MessageAttachmentRepository } from '@/database/repositories/messageAttachmentRepository';
import { withWorkspaceScope } from '@/database/tenant/context';
import { ContractError, type AccessCheck } from '@/framework/api';
import { redisService } from '@/services/redisService';
import { assertAttachmentAccess } from '@/services/attachmentAccessService';
import { getStorageService } from '@/services/storage';
import { DESK_EMAIL_SOURCE_TYPE, DEFAULT_DESK_EMAIL_CONFIG, deskEmailConfigKey, invalidateTagConfigCache, tagService } from '@/tags';
import { TagsConfigShapeSchema } from '@/tags';
import type { AuthenticatedUser } from '@/types/express';
import { logger } from '@/utils/logger';
import { transformEmoji } from '@/controllers/customEmojiController';

/**
 * Dashboard settings and admin APIs on the typed framework (activity aliases, client events,
 * custom emojis, a channel's tag-generation config, a file's metadata): no req/res, same
 * answers as the controllers they replace, except that a request that breaks its contract is
 * now the framework's 400 (`code: VALIDATION_ERROR`) rather than each controller's own text.
 */

function requireUser(user: AuthenticatedUser | undefined): AuthenticatedUser {
  if (!user) throw new ContractError(401, { error: 'Authentication required' });
  return user;
}

function internal(error: unknown, logMessage: string, body: { error: string } = { error: 'Internal server error' }): ContractError {
  if (error instanceof ContractError) return error;
  logger.error(logMessage, error);
  return new ContractError(500, body);
}

// ─── Activity aliases ───────────────────────────────────────────────────────

/** GET /activity-aliases */
export async function listAliases() {
  try {
    return { aliases: await db.activityAlias.findMany({ orderBy: { createdAt: 'desc' } }) };
  } catch (error) {
    throw internal(error, '[ACTIVITY-ALIASES] Error fetching aliases:', { error: 'Failed to fetch aliases' });
  }
}

/** POST /activity-aliases */
export async function createAlias(input: { body: RouteBody<typeof activityAliasesCreate> }) {
  try {
    const { eventName, eventCategory, aliasEventName, aliasEventCategory, isBlacklisted } = input.body;
    const existingAlias = await db.activityAlias.findUnique({ where: { eventName_eventCategory: { eventName, eventCategory } } });
    if (existingAlias) throw new ContractError(409, { error: 'Alias already exists for this event. Use PUT to update.' });

    // Create the alias (preserve alias values even when blacklisting)
    const alias = await db.activityAlias.create({
      data: {
        eventName,
        eventCategory,
        aliasEventName: aliasEventName ?? '',
        aliasEventCategory: aliasEventCategory ?? '',
        isBlacklisted,
        createdAt: new Date(),
      },
    });
    logger.info(`[ACTIVITY-ALIASES] Created alias: ${eventName} -> ${aliasEventName}`);
    return { alias };
  } catch (error) {
    throw internal(error, '[ACTIVITY-ALIASES] Error creating alias:', { error: 'Failed to create alias' });
  }
}

/** PUT /activity-aliases/:id */
export async function updateAlias(input: { params: { id: string }; body: RouteBody<typeof activityAliasesUpdate> }) {
  try {
    const { id } = input.params;
    const { aliasEventName, aliasEventCategory, isBlacklisted } = input.body;
    const existingAlias = await db.activityAlias.findUnique({ where: { id } });
    if (!existingAlias) throw new ContractError(404, { error: 'Alias not found' });

    // If not blacklisted, alias names are required
    const newIsBlacklisted = isBlacklisted ?? existingAlias.isBlacklisted;
    if (!newIsBlacklisted && (!aliasEventName || !aliasEventCategory)) {
      throw new ContractError(400, { error: 'aliasEventName and aliasEventCategory are required when not blacklisted' });
    }
    // Keep alias values even when blacklisting
    const alias = await db.activityAlias.update({
      where: { id },
      data: {
        aliasEventName: aliasEventName ?? existingAlias.aliasEventName,
        aliasEventCategory: aliasEventCategory ?? existingAlias.aliasEventCategory,
        isBlacklisted: newIsBlacklisted,
      },
    });
    logger.info(`[ACTIVITY-ALIASES] Updated alias: ${existingAlias.eventName}`);
    return { alias };
  } catch (error) {
    throw internal(error, '[ACTIVITY-ALIASES] Error updating alias:', { error: 'Failed to update alias' });
  }
}

/** DELETE /activity-aliases/:id: answers 204 with no body. */
export async function deleteAlias(input: { params: { id: string } }) {
  try {
    const { id } = input.params;
    const existingAlias = await db.activityAlias.findUnique({ where: { id } });
    if (!existingAlias) throw new ContractError(404, { error: 'Alias not found' });
    await db.activityAlias.delete({ where: { id } });
    logger.info(`[ACTIVITY-ALIASES] Deleted alias: ${existingAlias.eventName}`);
    return null;
  } catch (error) {
    throw internal(error, '[ACTIVITY-ALIASES] Error deleting alias:', { error: 'Failed to delete alias' });
  }
}

// ─── Client events and header overrides ─────────────────────────────────────

const MAX_TOTAL_SIZE = 4096;
const DEFAULT_LOADING_SECONDS = 3;
// Clients apply these as request headers and as cookies on the app's domain, so only the
// routing override the edge and CAC act on is accepted: x-route-env picks a dashboard-edge
// lane and the CAC environment.
const ALLOWED_HEADERS = new Set(['x-route-env']);
const ALLOWED_VALUE = /^[a-z0-9-]{1,32}$/;

const invalidRequest = (message: string) => new ContractError(400, { error: 'Invalid request', message });

function validateHeaders(headers: unknown): Record<string, string> {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
    throw invalidRequest('payload.headers must be an object of name/value string pairs');
  }
  const normalized: Record<string, string> = {};
  let totalSize = 0;
  for (const [rawName, value] of Object.entries(headers as Record<string, unknown>)) {
    if (typeof value !== 'string') throw invalidRequest(`Value for header ${rawName} must be a string`);
    const name = rawName.toLowerCase();
    if (!ALLOWED_HEADERS.has(name)) throw invalidRequest(`Header not allowed: ${rawName}`);
    if (!ALLOWED_VALUE.test(value)) throw invalidRequest(`Value for header ${rawName} must match ${ALLOWED_VALUE}`);
    totalSize += name.length + value.length;
    normalized[name] = value;
  }
  if (totalSize > MAX_TOTAL_SIZE) throw invalidRequest(`headers too large: at most ${MAX_TOTAL_SIZE} chars in total`);
  return normalized;
}

/** The ids that belong to the caller's workspace. */
async function filterToCallerWorkspace(user: AuthenticatedUser | undefined, userIds: string[]): Promise<Set<string>> {
  const workspaceId = user?.workspaceId;
  if (!workspaceId || userIds.length === 0) return new Set();
  const users = await withWorkspaceScope(() =>
    DatabaseClient.getInstance().user.findMany({ where: { id: { in: userIds }, workspaceId }, select: { id: true } }),
  );
  return new Set(users.map((u) => u.id));
}

async function requireInCallerWorkspace(user: AuthenticatedUser | undefined, userIds: string[]): Promise<void> {
  const allowed = await filterToCallerWorkspace(user, userIds);
  if (!userIds.every((id) => allowed.has(id))) {
    throw new ContractError(403, { error: 'Forbidden', message: 'All userIds must belong to your workspace' });
  }
}

async function publishClientCommand(
  userId: string,
  event: 'header_update' | 'reload',
  payload: Record<string, unknown>,
  options: { force: boolean; loadingSeconds: number },
): Promise<boolean> {
  try {
    await redisService.broadcastUserEvent(userId, {
      type: 'client_command',
      userId,
      data: { event, payload, force: options.force, loadingSeconds: options.loadingSeconds },
      timestamp: new Date(),
    });
    return true;
  } catch (error) {
    logger.error(`[CLIENT-EVENT] Failed to publish ${event} for user ${userId}:`, error);
    return false;
  }
}

function clientEventFailure(error: unknown, logMessage: string): ContractError {
  if (error instanceof ContractError) return error;
  logger.error(logMessage, error);
  return new ContractError(500, { error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' });
}

/** GET /client-events/me: the caller's own overrides; ones saved before the allowlist existed are not handed back. */
export async function myHeaderOverrides(input: { user: AuthenticatedUser | undefined }) {
  try {
    const user = requireUser(input.user);
    const stored = await redisService.getUserHeaderOverrides(user.id);
    return Object.fromEntries(
      Object.entries(stored ?? {}).filter(
        ([name, value]) => ALLOWED_HEADERS.has(name.toLowerCase()) && typeof value === 'string' && ALLOWED_VALUE.test(value),
      ),
    ) as Record<string, string>;
  } catch (error) {
    throw clientEventFailure(error, '[CLIENT-EVENT] Failed to get own header overrides:');
  }
}

/** GET /client-events: every override of users in the caller's workspace. */
export async function allHeaderOverrides(input: { user: AuthenticatedUser | undefined }) {
  try {
    const overrides = await redisService.getAllUserHeaderOverrides();
    const allowed = await filterToCallerWorkspace(input.user, Object.keys(overrides));
    return Object.fromEntries(Object.entries(overrides).filter(([userId]) => allowed.has(userId)));
  } catch (error) {
    throw clientEventFailure(error, '[CLIENT-EVENT] Failed to get header overrides:');
  }
}

/** POST /client-events: push a command (header_update or reload) to users' browsers. */
export async function postClientEvent(input: { body: RouteBody<typeof clientEventsPost>; user: AuthenticatedUser | undefined }) {
  try {
    const { userIds, event, payload } = input.body;
    const force = input.body.force === true;
    const loadingSeconds = input.body.loadingSeconds ?? DEFAULT_LOADING_SECONDS;
    const rawPayload = payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
    await requireInCallerWorkspace(input.user, userIds);

    const options = { force, loadingSeconds };
    const results: Array<{ userId: string; published: boolean }> = [];
    if (event === 'header_update') {
      const normalized = validateHeaders(rawPayload.headers);
      logger.info(`[CLIENT-EVENT] Admin ${input.user?.id} header_update for ${userIds.length} user(s) (force=${force}, loadingSeconds=${loadingSeconds}):`, normalized);
      for (const userId of userIds) {
        const merged = await redisService.setUserHeaderOverrides(userId, normalized);
        results.push({ userId, published: await publishClientCommand(userId, 'header_update', { headers: merged }, options) });
      }
    } else {
      logger.info(`[CLIENT-EVENT] Admin ${input.user?.id} ${event} for ${userIds.length} user(s) (force=${force}, loadingSeconds=${loadingSeconds})`);
      for (const userId of userIds) {
        results.push({ userId, published: await publishClientCommand(userId, event, rawPayload, options) });
      }
    }
    return { success: true as const, event, results };
  } catch (error) {
    throw clientEventFailure(error, '[CLIENT-EVENT] Failed to push client event:');
  }
}

/** DELETE /client-events: remove header overrides (all, or the named ones) and tell the users' browsers. */
export async function removeHeaderOverrides(input: { body: RouteBody<typeof clientEventsRemove>; user: AuthenticatedUser | undefined }) {
  try {
    const { userIds, headerNames } = input.body;
    const options = { force: input.body.force === true, loadingSeconds: input.body.loadingSeconds ?? DEFAULT_LOADING_SECONDS };
    await requireInCallerWorkspace(input.user, userIds);
    logger.info(
      `[CLIENT-EVENT] Admin ${input.user?.id} removing ${headerNames ? headerNames.join(', ') : 'ALL'} for ${userIds.length} user(s) (force=${options.force}, loadingSeconds=${options.loadingSeconds})`,
    );
    const results: Array<{ userId: string; headers: Record<string, string>; published: boolean }> = [];
    for (const userId of userIds) {
      const remaining = await redisService.removeUserHeaderOverrides(userId, headerNames);
      results.push({ userId, headers: remaining, published: await publishClientCommand(userId, 'header_update', { headers: remaining }, options) });
    }
    return { success: true as const, results };
  } catch (error) {
    throw clientEventFailure(error, '[CLIENT-EVENT] Failed to remove header overrides:');
  }
}

// ─── Custom emojis ──────────────────────────────────────────────────────────

const customEmojiRepository = new CustomEmojiRepository();

/** GET /emojis */
export async function listEmojis() {
  try {
    return { success: true as const, emojis: (await customEmojiRepository.findAll()).map(transformEmoji) };
  } catch (error) {
    throw internal(error, 'Error fetching custom emojis:');
  }
}

/** GET /emojis/:emojiId */
export async function getEmoji(input: { params: { emojiId: string } }) {
  try {
    const emoji = await customEmojiRepository.findById(input.params.emojiId);
    if (!emoji) throw new ContractError(404, { error: 'Emoji not found' });
    return { success: true as const, emoji: transformEmoji(emoji) };
  } catch (error) {
    throw internal(error, 'Error fetching custom emoji:');
  }
}

/** DELETE /emojis/:emojiId: the creator only. */
export async function deleteEmoji(input: { params: { emojiId: string }; user: AuthenticatedUser | undefined }) {
  try {
    const user = requireUser(input.user);
    const { emojiId } = input.params;
    const emoji = await customEmojiRepository.findById(emojiId);
    if (!emoji) throw new ContractError(404, { error: 'Emoji not found' });
    // Check if user is the creator (or add admin check if needed)
    if (emoji.createdBy !== user.id) throw new ContractError(403, { error: 'You do not have permission to delete this emoji' });
    try {
      await getStorageService().deleteFile(emoji.url);
    } catch (error) {
      logger.warn(`Failed to delete emoji file from GCS: ${emoji.url}`, error);
      // Continue with emoji deletion even if file deletion fails
    }
    await customEmojiRepository.delete(emojiId);
    logger.info(`Custom emoji deleted: ${emoji.name} by user ${user.id}`);
    return { success: true as const, message: 'Custom emoji deleted successfully' };
  } catch (error) {
    throw internal(error, 'Error deleting custom emoji:');
  }
}

// ─── A channel's desk tag-generation config ─────────────────────────────────

const channelParticipantRepo = new ChannelParticipantRepository();
const channelRepo = new ChannelRepository();
const classificationRepo = new EmailClassificationRepository();

/**
 * Access to a channel's tag-generation config, as the controller's assertAccess: a member of the
 * channel; with `manage`, also the channel's admin or creator or the desk owner. Hands the
 * handler the caller's id and workspace.
 */
export function deskTagsAccess(options: { manage: boolean }): AccessCheck<{ userId: string; workspaceId: string }> {
  return async ({ params, user }) => {
    const channelId = (params as { channelId: string }).channelId;
    const userId = user?.id;
    const workspaceId = user?.workspaceId;
    if (!userId || !workspaceId) throw new ContractError(401, { error: 'Unauthorized' });

    const channel = await channelRepo.findById(channelId);
    if (!channel || channel.workspaceId !== workspaceId) throw new ContractError(404, { error: 'Channel not found' });

    // Single query gives membership + role together
    const participant = await channelParticipantRepo.findParticipant(channelId, userId);
    if (!participant) throw new ContractError(403, { error: 'Not a member of this channel' });

    if (options.manage) {
      const allowed =
        participant.role === ChannelRole.ADMIN || // channel admin
        channel.createdBy === userId || // channel creator
        (await classificationRepo.findRawPreferenceByChannelId(channelId))?.ownerUserId === userId; // desk owner
      if (!allowed) {
        throw new ContractError(403, { error: 'Only the desk owner or a channel admin can manage tag generation config' });
      }
    }
    return { userId, workspaceId };
  };
}

/** GET /channels/:channelId/tags-config: the desk-email tag-generation categories (the default when none is saved). */
export async function getChannelTagsConfig(input: { params: { channelId: string } }) {
  const { channelId } = input.params;
  try {
    const config = await tagService.getConfig(deskEmailConfigKey(channelId));
    if (!config) return { categories: DEFAULT_DESK_EMAIL_CONFIG.categories, isDefault: true };
    const parsed = TagsConfigShapeSchema.safeParse(config.config);
    return { categories: parsed.success ? parsed.data.categories : {}, isDefault: false };
  } catch (error) {
    throw internal(error, '[DESK-TAGS-CONFIG] Failed to get config', { error: 'Failed to get tag generation config' });
  }
}

/** PATCH /channels/:channelId/tags-config: replace the categories. */
export async function updateChannelTagsConfig(input: {
  params: { channelId: string };
  body: RouteBody<typeof channelTagsConfigUpdate>;
  caller: { userId: string; workspaceId: string };
}) {
  const { channelId } = input.params;
  try {
    const configKey = deskEmailConfigKey(channelId);
    await tagService.upsertConfig(configKey, DESK_EMAIL_SOURCE_TYPE, input.caller.workspaceId, input.body, input.caller.userId);
    // Evict the worker-side Redis cache so the pipeline picks up the new config on the very next
    // job rather than waiting for the TTL to expire.
    await invalidateTagConfigCache(configKey);
    return { categories: input.body.categories };
  } catch (error) {
    throw internal(error, '[DESK-TAGS-CONFIG] Failed to update config', { error: 'Failed to update tag generation config' });
  }
}

// ─── A file's metadata (Xyne Apps, bot token) ───────────────────────────────

const messageAttachmentRepository = new MessageAttachmentRepository();

/** GET /apps/files/info/:attachmentId */
export async function fileInfo(input: { params: { attachmentId: string }; user: AuthenticatedUser | undefined }) {
  try {
    const user = requireUser(input.user);
    const attachment = await messageAttachmentRepository.findById(input.params.attachmentId);
    if (!attachment) throw new ContractError(404, { error: 'Attachment not found', code: 'NOT_FOUND' });
    const access = await assertAttachmentAccess(attachment, user.id, user.workspaceId);
    if (!access.ok) throw new ContractError(access.status, access.body as { error: string });
    return {
      id: attachment.id,
      originalFilename: attachment.originalFilename,
      mimetype: attachment.mimetype,
      size: attachment.size,
      width: attachment.width,
      height: attachment.height,
      thumbnailUrl: attachment.thumbnailUrl,
      createdAt: attachment.createdAt,
      conversationId: attachment.conversationId,
    };
  } catch (error) {
    throw internal(error, 'Error fetching file info:');
  }
}
