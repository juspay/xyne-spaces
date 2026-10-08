import type { Response } from 'express';
import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { CacConfigService } from '@/services/cacConfigService';
import { UserRepository } from '@/database/repositories/users';
import { sanitizeForLog } from '@/git-providers/github/apis';
import { processSlackIncoming } from '@/bypassAcl/appServices';
import type { WebhookContext } from '@/apps/controllers/incomingWebhookController';
import {
  buildSearchFeedbackText,
  type SearchFeedbackSource,
} from '@/services/searchFeedbackMessage';

/**
 * Superposition (CAC) key for where feedback is posted. Resolved per `workspaceId`, so a
 * workspace override wins and every other workspace gets the default config. Value, ids only:
 * `{ "workspaceId", "channelId", "appUserId", "userGroupId" }`.
 *
 * - `workspaceId` / `channelId`: the feedback channel (one channel can serve every workspace).
 * - `appUserId`: the user of an app installed in that workspace (`installed_apps.userId`). The
 *   message is posted as this app, so the sender, mentions and notifications resolve in the
 *   channel's workspace even when the reporter is elsewhere.
 * - `userGroupId`: group to tag. Optional.
 */
const FEEDBACK_TARGET_CAC_KEY = 'search_feedback_target';

interface SearchFeedbackTarget {
  workspaceId?: string;
  channelId?: string;
  appUserId?: string;
  userGroupId?: string;
}

/** Fields `processSlackIncoming` reads from the webhook context; the rest of it is unused. */
type FeedbackPostContext = Pick<WebhookContext, 'workspaceId' | 'appId' | 'channelId' | 'body'> & {
  installedApp: Pick<WebhookContext['installedApp'], 'userId'>;
};

/** Stands in for the webhook's app id in `processSlackIncoming`'s logs. */
const FEEDBACK_LOG_APP_ID = 'search-feedback';

/** Timezone for the `When:` line. IST, same as recaps and desk metrics. */
const FEEDBACK_TIMEZONE = 'Asia/Kolkata';

export interface PostSearchFeedbackParams {
  /** Reporter. Named in the message. */
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

/** Feedback isn't set up, or the post was rejected. Returned to the client as 409, not a crash. */
export class SearchFeedbackUnavailableError extends Error {}

export class SearchFeedbackService {
  private userRepository = new UserRepository();

  /** Reads the CAC target for this workspace. Returns `{}` if unset or CAC is unreachable. */
  private async resolveTarget(workspaceId: string): Promise<SearchFeedbackTarget> {
    const raw = await CacConfigService.fetch(FEEDBACK_TARGET_CAC_KEY, { workspaceId });
    if (!raw || typeof raw !== 'object') {
      if (raw !== null) {
        logger.warn('[SearchFeedback] CAC target is not an object; ignoring', {
          cacKey: FEEDBACK_TARGET_CAC_KEY,
          workspaceId: sanitizeForLog(workspaceId),
        });
      }
      return {};
    }
    // Keep only non-empty strings; anything else in config is ignored.
    const target: SearchFeedbackTarget = {};
    const fields = ['workspaceId', 'channelId', 'appUserId', 'userGroupId'] as const;
    for (const field of fields) {
      const value = (raw as Record<string, unknown>)[field];
      if (typeof value === 'string' && value.trim()) {
        target[field] = value.trim();
      } else if (value != null) {
        logger.warn('[SearchFeedback] CAC target field is not a string; ignoring it', {
          cacKey: FEEDBACK_TARGET_CAC_KEY,
          field,
          workspaceId: sanitizeForLog(workspaceId),
        });
      }
    }
    return target;
  }

  private isConfigured(target: SearchFeedbackTarget): boolean {
    return !!(target.workspaceId && target.channelId && target.appUserId);
  }

  /**
   * What the form needs: `enabled` decides whether the Feedback buttons show at all (same check
   * as posting, so removing `channelId` or `appUserId` from CAC turns feedback off). The channel
   * and group names fill the "Posts to #x and tags @y" line, only for users in the channel's
   * workspace, read under their own access; anyone else (or anyone who can't see the channel)
   * gets `null` names, and the form shows a general note instead.
   */
  async getTargetDisplay(
    workspaceId: string
  ): Promise<{ enabled: boolean; channelName: string | null; groupHandle: string | null }> {
    const target = await this.resolveTarget(workspaceId);
    const enabled = this.isConfigured(target);
    if (!enabled || target.workspaceId !== workspaceId) {
      return { enabled, channelName: null, groupHandle: null };
    }
    const [channel, group] = await Promise.all([
      db.channel.findFirst({
        where: { id: target.channelId, isArchived: false },
        select: { name: true },
      }),
      target.userGroupId
        ? db.userGroup.findFirst({
            where: { id: target.userGroupId },
            select: { name: true, alias: true },
          })
        : null,
    ]);
    if (!channel) return { enabled, channelName: null, groupHandle: null };
    return {
      enabled,
      channelName: channel.name,
      // Same label the group mention shows: alias if set, else name.
      groupHandle: group ? (group.alias ?? group.name) : null,
    };
  }

  /** Posts the feedback to the configured channel as the configured app, tagging the group. */
  async postFeedback(params: PostSearchFeedbackParams): Promise<void> {
    const { userId, workspaceId, query, feedback, filters, sort, source } = params;

    const target = await this.resolveTarget(workspaceId);
    if (!this.isConfigured(target)) {
      logger.warn('[SearchFeedback] Feedback target not configured', {
        cacKey: FEEDBACK_TARGET_CAC_KEY,
        hasWorkspaceId: !!target.workspaceId,
        hasChannelId: !!target.channelId,
        hasAppUserId: !!target.appUserId,
        workspaceId: sanitizeForLog(workspaceId),
      });
      throw new SearchFeedbackUnavailableError('Search feedback is not set up for this workspace');
    }

    // Both are the reporter's own rows, read under their normal request scope.
    const [reporter, reporterWorkspace] = await Promise.all([
      this.userRepository.findById(userId),
      db.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } }),
    ]);

    const text = buildSearchFeedbackText({
      userGroupId: target.userGroupId ?? null,
      // Tag the reporter only when they're in the channel's workspace; elsewhere the mention
      // can't resolve, so they're named in plain text instead.
      reporterMentionId: reporter && target.workspaceId === workspaceId ? reporter.id : null,
      reporterName: reporter?.name || 'a teammate',
      reporterEmail: reporter?.email ?? null,
      query,
      feedback,
      filters,
      ...(sort ? { sort } : {}),
      source,
      workspaceName: reporterWorkspace?.name ?? '',
      when: new Date(),
      timeZone: FEEDBACK_TIMEZONE,
    });

    // Post through the incoming-webhook pipeline, in-process: it opens its own scope in the
    // channel's workspace, resolves the mentions there and posts as the app.
    const context: FeedbackPostContext = {
      workspaceId: target.workspaceId!,
      appId: FEEDBACK_LOG_APP_ID,
      channelId: target.channelId!,
      installedApp: { userId: target.appUserId! },
      body: { text },
    };
    // processSlackIncoming answers through an Express response (`res.status(code).send(...)`);
    // this records the status code instead. It's 200 when the message was posted.
    let status = 0;
    const res = {
      status(code: number) {
        status = code;
        return { send: (): void => undefined };
      },
    };
    await processSlackIncoming(context as WebhookContext, res as unknown as Response);

    if (status !== 200) {
      logger.error('[SearchFeedback] Feedback post was rejected', {
        status,
        targetWorkspaceId: sanitizeForLog(target.workspaceId ?? ''),
      });
      throw new SearchFeedbackUnavailableError('The search feedback channel is not available');
    }

    logger.info('[SearchFeedback] Posted feedback', {
      source: sanitizeForLog(source),
      targetWorkspaceId: sanitizeForLog(target.workspaceId ?? ''),
    });
  }
}

export const searchFeedbackService = new SearchFeedbackService();
