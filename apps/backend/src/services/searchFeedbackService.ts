import { db } from '@/database/client';
import { logger } from '@/utils/logger';
import { config } from '@/config/env';
import { CacConfigService } from '@/services/cacConfigService';
import { UserRepository } from '@/database/repositories/users';
import { sanitizeForLog } from '@/git-providers/github/apis';
import {
  buildSearchFeedbackText,
  type SearchFeedbackSource,
} from '@/services/searchFeedbackMessage';

/**
 * Superposition (CAC) key for where feedback is posted. Resolved per `workspaceId`, so a
 * workspace override wins and every other workspace gets the default config. Value:
 * `{ "workspaceId", "appId", "userGroupId", "channelName", "groupHandle" }`.
 *
 * `workspaceId` + `appId` identify an incoming webhook: an app installed in the channel's
 * workspace, with a webhook bound to the feedback channel. The webhook's secret is the env var
 * SEARCH_FEEDBACK_WEBHOOK_SECRET, so config only holds ids. The webhook posts as the app, in the
 * channel's own workspace, so the message, the group ping and notifications all resolve there.
 */
const FEEDBACK_TARGET_CAC_KEY = 'search_feedback_target';

interface SearchFeedbackTarget {
  workspaceId?: string;
  appId?: string;
  userGroupId?: string;
  channelName?: string;
  groupHandle?: string;
}

/** Shown in the form's "Posts to #x and tags @y" line when CAC doesn't set the names. */
const FEEDBACK_CHANNEL_NAME = 'xyne-spaces';
const FEEDBACK_GROUP = 'spaces-search';

/** Timezone for the `When:` line. IST, same as recaps and desk metrics. */
const FEEDBACK_TIMEZONE = 'Asia/Kolkata';

/** How long to wait for the webhook before failing the post. */
const WEBHOOK_TIMEOUT_MS = 10_000;

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

/** Feedback isn't set up (or the webhook rejected it). Returned to the client as 409, not a crash. */
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
    // Keep only non-empty strings; anything else in config is ignored, not put in a URL.
    const target: SearchFeedbackTarget = {};
    const fields = ['workspaceId', 'appId', 'userGroupId', 'channelName', 'groupHandle'] as const;
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

  /** Webhook path, or null when CAC or the env secret is missing. */
  private webhookPath(target: SearchFeedbackTarget): string | null {
    const secret = config.searchFeedbackWebhookSecret;
    if (!target.workspaceId || !target.appId || !secret) return null;
    return `/api/apps/webhooks/${encodeURIComponent(target.workspaceId)}/${encodeURIComponent(
      target.appId
    )}/${encodeURIComponent(secret)}`;
  }

  /**
   * Channel and group names for the form's "Posts to #x and tags @y" line. `null` when feedback
   * isn't set up, or when the channel is in another workspace: those users can't see it, so the
   * form shows a general note instead of naming it.
   */
  async getTargetDisplay(
    workspaceId: string
  ): Promise<{ channelName: string | null; groupHandle: string | null }> {
    const target = await this.resolveTarget(workspaceId);
    if (!this.webhookPath(target) || target.workspaceId !== workspaceId) {
      return { channelName: null, groupHandle: null };
    }
    return {
      channelName: target.channelName ?? FEEDBACK_CHANNEL_NAME,
      groupHandle: target.userGroupId ? (target.groupHandle ?? FEEDBACK_GROUP) : null,
    };
  }

  /** Sends the feedback to the configured incoming webhook, tagging the group. */
  async postFeedback(params: PostSearchFeedbackParams): Promise<void> {
    const { userId, workspaceId, query, feedback, filters, sort, source } = params;

    const target = await this.resolveTarget(workspaceId);
    const path = this.webhookPath(target);
    if (!path) {
      logger.warn('[SearchFeedback] Feedback webhook not configured', {
        cacKey: FEEDBACK_TARGET_CAC_KEY,
        hasWorkspaceId: !!target.workspaceId,
        hasAppId: !!target.appId,
        hasSecret: !!config.searchFeedbackWebhookSecret,
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

    // Sent to this backend's own webhook route, the same as any outside system posting to it.
    const response = await fetch(`http://localhost:${config.port}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });

    if (!response.ok) {
      // 400 is the webhook's answer for a wrong or revoked secret/app, i.e. a config problem.
      logger.error('[SearchFeedback] Feedback webhook rejected the post', {
        status: response.status,
        targetWorkspaceId: sanitizeForLog(target.workspaceId ?? ''),
        appId: sanitizeForLog(target.appId ?? ''),
      });
      if (response.status === 400) {
        throw new SearchFeedbackUnavailableError('The search feedback channel is not available');
      }
      throw new Error(`Feedback webhook returned ${response.status}`);
    }

    logger.info('[SearchFeedback] Posted feedback', {
      source: sanitizeForLog(source),
      targetWorkspaceId: sanitizeForLog(target.workspaceId ?? ''),
    });
  }
}

export const searchFeedbackService = new SearchFeedbackService();
