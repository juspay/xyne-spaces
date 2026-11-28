import { ContractError, type AccessCheck } from '@/framework/api';
import { logger } from '@/utils/logger';
import { ChannelValidationSchema, checkChannelAccess, resolveBotDmChannelId } from './middelware/channelValidation';

/**
 * Access checks for typed Xyne Apps routes (a controller's `checks`). They run after the body is
 * checked against its contract and answer exactly as the middlewares they replace
 * (requirePermission, validateChannelAccessForPost, validateChannelAccessForPostWithDm).
 */

/** The app's install must hold `permission` (e.g. `chat:write`). Same 403 as requirePermission. */
export function appPermission(permission: string): AccessCheck<void> {
  return async ({ app }) => {
    const granted = app?.permissions ?? [];
    if (granted.includes(permission)) return;
    const stale = app?.permissionsStale === true;
    logger.warn(`[appPermission] Access denied – missing scope: ${permission}`, { required: permission, granted, stale });
    throw new ContractError(403, {
      error: 'missing_permission',
      required: permission,
      granted,
      ...(stale && {
        reason: 'permissions_stale',
        message: 'App permissions have changed. Please re-install your app permissions to continue.',
      }),
    });
  };
}

/** The channel the bot posts into, as `botChannel` resolved it. */
export type BotChannel = {
  channelId: string;
  /** `channelId` named a user, and this is the bot's DM with them (opened if it did not exist). */
  dm: boolean;
};

const failedToValidate = () =>
  new ContractError(500, { error: 'Internal Server Error', message: 'Failed to validate channel access' });

/**
 * The bot must be a participant of the channel the body names (channelId, else channelName,
 * else conversationId). With `allowDm`, a `channelId` that names a user of the bot's workspace
 * is the bot's DM with that user (chat/postMessage, like the Slack adapter's chat.postMessage);
 * the participant check is skipped for it, the bot is in its own DM by construction.
 */
export function botChannel(options: { allowDm: boolean }): AccessCheck<BotChannel> {
  return async ({ body, user }) => {
    const { channelId, channelName, conversationId } = (body ?? {}) as {
      channelId?: string;
      channelName?: string;
      conversationId?: string;
    };

    if (options.allowDm) {
      let dmChannelId: string | null;
      try {
        dmChannelId = await resolveBotDmChannelId(channelId?.trim(), user?.id ?? '', user?.workspaceId);
      } catch (error) {
        logger.error('[CHANNEL-VALIDATION] Failed to resolve DM target:', error);
        throw failedToValidate();
      }
      if (dmChannelId) return { channelId: dmChannelId, dm: true };
    }

    const validated = ChannelValidationSchema.safeParse({ channelId, channelName, conversationId, userId: user?.id });
    if (!validated.success) {
      throw new ContractError(400, { error: 'Bad Request', message: 'Validation error' });
    }

    let result;
    try {
      result = await checkChannelAccess(
        validated.data.channelId,
        validated.data.channelName,
        validated.data.conversationId,
        validated.data.userId,
      );
    } catch (error) {
      logger.error('[CHANNEL-VALIDATION] Unexpected error in channel access check:', error);
      throw failedToValidate();
    }
    if (!result.ok) {
      throw new ContractError(result.status, { error: result.error, message: result.message });
    }
    return { channelId: result.channelId, dm: false };
  };
}

/** The bot's workspace: whose key a bot route's encrypted fields are stored under (`encryption`). */
export const encryptUnderBotWorkspace = {
  resolveWorkspaceId: async (req: { user?: { workspaceId: string } }) => req.user!.workspaceId,
};
