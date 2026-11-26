import { ChannelRole, type RouteBody } from '@xyne/shared';
import type { channelTagsConfigUpdate } from '@xyne/shared';
import { ChannelParticipantRepository } from '@/database/repositories/channelParticipantRepository';
import { ChannelRepository } from '@/database/repositories/channelRepository';
import { EmailClassificationRepository } from '@/database/repositories/emailClassificationRepository';
import { ContractError, type AccessCheck } from '@/framework/api';
import { DESK_EMAIL_SOURCE_TYPE, DEFAULT_DESK_EMAIL_CONFIG, deskEmailConfigKey, invalidateTagConfigCache, tagService } from '@/tags';
import { TagsConfigShapeSchema } from '@/tags';
import { internal } from '../../settings.helpers';

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