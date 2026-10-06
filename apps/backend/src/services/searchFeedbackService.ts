import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { CacConfigService } from '@/services/cacConfigService';
import {
  formatGroupMention,
  formatUserMention,
} from '@/bots/implementations/qa-alert-bot/alert-formatting';
import { buildUserQueryContext } from '@/utils/queryContext';
import {
  countFeedbackGroupMembers,
  findFeedbackChannelById,
  findFeedbackGroupByHandle,
  findFeedbackGroupById,
  findFeedbackWorkspaceName,
  notifyFeedbackPosted,
  postFeedbackMessage,
} from '@/bypassAcl/searchFeedbackServices';
import { UserRepository } from '@/database/repositories/users';
import { sanitizeForLog } from '@/git-providers/github/apis';
import {
  buildSearchFeedbackContent,
  type SearchFeedbackSource,
} from '@/services/searchFeedbackMessage';

/**
 * Superposition (CAC) key for where feedback is posted.
 * Value: `{ "channelId": "...", "userGroupId": "..." }`. Resolved per `workspaceId`, so a
 * workspace override wins and every other workspace gets the default config.
 */
const FEEDBACK_TARGET_CAC_KEY = 'search_feedback_target';

interface SearchFeedbackTarget {
  channelId?: string;
  userGroupId?: string;
}

/**
 * Fallback names, looked up in the reporter's workspace when CAC has no config
 * (e.g. local dev) or can't be reached.
 */
const FEEDBACK_CHANNEL_NAME = 'xyne-spaces';
const FEEDBACK_GROUP = 'spaces-search';

/** Timezone for the `When:` line. IST, same as recaps and desk metrics. */
const FEEDBACK_TIMEZONE = 'Asia/Kolkata';

export interface PostSearchFeedbackParams {
  /** Reporter. The message is posted as this user and mentions them. */
  userId: string;
  workspaceId: string;
  /** Search query on screen when Feedback was opened. */
  query: string;
  /** Comment from the user; may be empty if a query was given. */
  feedback: string;
  /** Active filter labels as shown in the UI, e.g. `@Ch`, `from:alice`, `"ab"`. */
  filters: string[];
  /** Sort label. Only the full-page search has one; Cmd+K doesn't. */
  sort?: string;
  source: SearchFeedbackSource;
}

export interface PostSearchFeedbackResult {
  channelId: string;
  conversationId: string;
  messageId: string;
}

/** No feedback channel could be resolved. Returned to the client as 409 (config issue, not a crash). */
export class SearchFeedbackUnavailableError extends Error {}

export class SearchFeedbackService {
  private userRepository = new UserRepository();

  /** Reads the CAC destination for this workspace. Returns `{}` if unset or CAC is unreachable. */
  private async resolveTarget(workspaceId: string): Promise<SearchFeedbackTarget> {
    const raw = await CacConfigService.fetch(FEEDBACK_TARGET_CAC_KEY, { workspaceId });
    if (raw && typeof raw === 'object') {
      // Keep only non-empty string ids; anything else in config is ignored, not passed to the DB.
      const { channelId, userGroupId } = raw as Record<string, unknown>;
      const target: SearchFeedbackTarget = {};
      if (typeof channelId === 'string' && channelId.trim()) target.channelId = channelId.trim();
      if (typeof userGroupId === 'string' && userGroupId.trim()) {
        target.userGroupId = userGroupId.trim();
      }
      if ((channelId != null && !target.channelId) || (userGroupId != null && !target.userGroupId)) {
        logger.warn('[SearchFeedback] CAC target has a non-string id; ignoring it', {
          cacKey: FEEDBACK_TARGET_CAC_KEY,
          workspaceId: sanitizeForLog(workspaceId),
        });
      }
      return target;
    }
    if (raw !== null) {
      logger.warn('[SearchFeedback] CAC target is not an object; ignoring', {
        cacKey: FEEDBACK_TARGET_CAC_KEY,
        workspaceId: sanitizeForLog(workspaceId),
      });
    }
    return {};
  }

  /**
   * Channel to post into, plus the workspace it belongs to.
   *
   * The configured id is read across workspaces (see bypassAcl/searchFeedbackServices), since
   * one shared default channel can serve every workspace. The id only ever comes from CAC, never
   * the request. Without a configured id, falls back to `#xyne-spaces` in the reporter's workspace.
   */
  private async resolveChannel(
    workspaceId: string,
    target: SearchFeedbackTarget
  ): Promise<{ id: string; name: string; workspaceId: string } | null> {
    if (target.channelId) {
      const byId = await findFeedbackChannelById(target.channelId);
      if (byId) return byId;
      logger.error(
        '[SearchFeedback] Configured channel missing or archived; falling back to default',
        {
          cacKey: FEEDBACK_TARGET_CAC_KEY,
          channelId: sanitizeForLog(target.channelId ?? ''),
          fallbackChannelName: FEEDBACK_CHANNEL_NAME,
          workspaceId: sanitizeForLog(workspaceId),
        }
      );
    }
    // Public and not archived only: this path skips the membership check that the normal
    // message API does, so it must not post into a private channel the reporter isn't in.
    return db.channel.findFirst({
      where: {
        workspaceId,
        name: { equals: FEEDBACK_CHANNEL_NAME, mode: 'insensitive' },
        visibility: 'PUBLIC',
        isArchived: false,
      },
      select: { id: true, name: true, workspaceId: true },
    });
  }

  /**
   * User group to tag. Same rules as `resolveChannel`. `workspaceId` here is the channel's
   * workspace, so the tag goes to the team that owns the channel. The fallback checks alias
   * then name, since many groups have no alias set.
   */
  private async resolveGroup(
    workspaceId: string,
    target: SearchFeedbackTarget
  ): Promise<{ id: string; name: string; alias: string | null } | null> {
    if (target.userGroupId) {
      const byId = await findFeedbackGroupById(target.userGroupId);
      if (byId) return byId;
      logger.error(
        '[SearchFeedback] Configured user group does not exist; falling back to default',
        {
          cacKey: FEEDBACK_TARGET_CAC_KEY,
          userGroupId: sanitizeForLog(target.userGroupId ?? ''),
          fallbackGroup: FEEDBACK_GROUP,
          workspaceId: sanitizeForLog(workspaceId),
        }
      );
    }
    return findFeedbackGroupByHandle(FEEDBACK_GROUP, workspaceId);
  }

  /**
   * Channel and group names for the form's "Posts to #x and tags @y" line. Uses the same
   * resolution as `postFeedback`, so the UI shows where the post will actually go.
   * `null` means not resolvable.
   */
  async getTargetDisplay(
    workspaceId: string
  ): Promise<{ channelName: string | null; groupHandle: string | null }> {
    const target = await this.resolveTarget(workspaceId);
    const channel = await this.resolveChannel(workspaceId, target);
    const group = channel ? await this.resolveGroup(channel.workspaceId, target) : null;
    return {
      channelName: channel?.name ?? null,
      // Same label formatGroupMention uses: alias if set, else name.
      groupHandle: group ? (group.alias ?? group.name) : null,
    };
  }

  /** Posts the feedback message to the resolved channel as the reporter, tagging the group. */
  async postFeedback(params: PostSearchFeedbackParams): Promise<PostSearchFeedbackResult> {
    const { userId, workspaceId, query, feedback, filters, sort, source } = params;

    const target = await this.resolveTarget(workspaceId);

    const channel = await this.resolveChannel(workspaceId, target);
    if (!channel) {
      logger.warn('[SearchFeedback] Feedback channel not found', {
        channelName: FEEDBACK_CHANNEL_NAME,
        workspaceId: sanitizeForLog(workspaceId),
      });
      throw new SearchFeedbackUnavailableError(
        `Feedback channel #${FEEDBACK_CHANNEL_NAME} is not available in this workspace`
      );
    }

    // Independent lookups, run together. Everything that can fail runs before the message is
    // saved, so an error never leaves a posted message behind for the user to retry into a
    // duplicate.
    // - group: tagged in the channel's workspace
    // - reporterWorkspace: for the `Workspace:` line (the channel can be shared)
    // - reporter: for the headline mention, read before switching workspace
    // - ctx: for the notification step after the save
    const [group, reporterWorkspaceName, reporter, ctx] = await Promise.all([
      this.resolveGroup(channel.workspaceId, target),
      findFeedbackWorkspaceName(workspaceId),
      this.userRepository.findById(userId),
      buildUserQueryContext(userId),
    ]);

    // If the group can't be found, still post the feedback, just without the tag.
    let groupMentionHtml: string | null = null;
    if (group) {
      const memberCount = await countFeedbackGroupMembers(group.id);
      groupMentionHtml = formatGroupMention(group.id, group.name, group.alias, memberCount);
    } else {
      logger.warn('[SearchFeedback] User group not found; posting without a mention', {
        group: FEEDBACK_GROUP,
        workspaceId: sanitizeForLog(channel.workspaceId),
      });
    }

    const reporterName = reporter?.name || 'a teammate';
    const reporterMentionHtml = reporter
      ? formatUserMention(reporter.id, reporter.name, {
          email: reporter.email,
          picture: reporter.picture,
        })
      : null;

    const content = buildSearchFeedbackContent({
      groupMentionHtml,
      reporterMentionHtml,
      reporterName,
      query,
      feedback,
      filters,
      ...(sort ? { sort } : {}),
      source,
      workspaceName: reporterWorkspaceName ?? '',
      when: new Date(),
      timeZone: FEEDBACK_TIMEZONE,
    });

    // Written in the channel's workspace, which may differ from the reporter's.
    const result = await postFeedbackMessage(userId, channel, content);

    // Notifications (incl. the group ping), in the channel's workspace. Not awaited: the
    // message is already posted, and failures are logged inside.
    void notifyFeedbackPosted(ctx, channel.workspaceId, result.message.messageId);

    logger.info('[SearchFeedback] Posted feedback', {
      source: sanitizeForLog(source),
      channelId: channel.id,
      conversationId: sanitizeForLog(result.conversation.conversationId),
    });

    return {
      channelId: channel.id,
      conversationId: result.conversation.conversationId,
      messageId: result.message.messageId,
    };
  }
}

export const searchFeedbackService = new SearchFeedbackService();
