import type { ExternalSource } from '@prisma/client';
import { BaseFlow } from '@/integrations/core/baseFlow';
import type { IngestionOptions, TestPayloadResult } from '@/integrations/core/types';
import { db } from '@/database/client';
import { decrypt } from '@/services/encryptionService';
import { logger } from '@/utils/logger';
import { verifyMetaWebhookSubscription } from '../shared/metaWebhookVerification';
import { FACEBOOK_TEXTLESS_COMMENT, FACEBOOK_UNKNOWN_AUTHOR } from './constants';
import { facebookGraphClient, isFacebookTokenRejected } from './facebookGraphClient';
import { fetchFacebookHistory } from './historyFetcher';
import { commentExternalId, dmExternalId } from './transformer';
import type {
  FacebookCredentials,
  FacebookFeedValue,
  FacebookMentionValue,
  FacebookWebhookComment,
  FacebookWebhookMessaging,
  FacebookWebhookPayload,
} from './types';

const TAG = '[FacebookFlow]';

type FacebookItem = FacebookWebhookMessaging | FacebookWebhookComment;

// A post with thousands of comments can make one batch large; keep each id lookup bounded.
const STORED_LOOKUP_CHUNK = 1000;

// Window for a manual fetch that names no range.
const DEFAULT_FETCH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// Hourly catch-up (facebookCatchUpWorker). It resumes from the last run, re-reading a little
// before it, and leaves the newest few minutes alone so it never races a webhook that is still
// on its way. The overlap must stay larger than the grace period.
const CATCH_UP_FIRST_RUN_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const CATCH_UP_OVERLAP_MS = 30 * 60 * 1000;
const CATCH_UP_GRACE_MS = 10 * 60 * 1000;

function catchUpRange(source: ExternalSource, now: Date): { startDate: Date; endDate: Date } {
  const cursor = source.lastSyncCursor ? Date.parse(source.lastSyncCursor) : Number.NaN;
  const start = Number.isFinite(cursor)
    ? cursor - CATCH_UP_OVERLAP_MS
    : now.getTime() - CATCH_UP_FIRST_RUN_LOOKBACK_MS;
  // Never import activity from before the Page was connected on its own.
  return {
    startDate: new Date(Math.max(start, source.createdAt.getTime())),
    endDate: new Date(now.getTime() - CATCH_UP_GRACE_MS),
  };
}

/** Distinct Page ids in a webhook POST. Meta may batch events for several Pages into one request. */
export function facebookPageIdsInPayload(rawPayload: unknown): string[] {
  const payload = rawPayload as Partial<FacebookWebhookPayload>;
  if (payload?.object !== 'page') return [];
  return [...new Set((payload.entry ?? []).map((entry) => entry.id).filter(Boolean))];
}

const postLink = (postId: string | undefined): string | undefined =>
  postId ? `https://www.facebook.com/${postId}` : undefined;

/**
 * For a Page whose token Meta rejected: the same state as a manual disconnect, so desk settings
 * show it as Disconnected with a Reconnect button. Incoming webhooks are skipped until then.
 */
export async function disconnectSourceWithDeadToken(sourceId: string): Promise<void> {
  await db.externalSource.update({
    where: { id: sourceId },
    data: { isActive: false, credentials: '' },
  });
  logger.warn(`${TAG} Page token rejected by Meta — source marked disconnected`, { sourceId });
}

export class FacebookFlow extends BaseFlow {
  async preprocess(
    rawPayload: unknown,
    source?: ExternalSource,
    options?: IngestionOptions,
  ): Promise<FacebookItem[]> {
    // No payload means a manual fetch (socialMediaService.syncSource), not a webhook.
    const isManualFetch = rawPayload === undefined;
    const payload = rawPayload as Partial<FacebookWebhookPayload>;
    if (!isManualFetch && payload?.object !== 'page') return [];

    if (!source?.credentials) {
      logger.warn(`${TAG} preprocess called with no source credentials`, { sourceId: source?.id });
      return [];
    }
    let creds: FacebookCredentials;
    try {
      creds = JSON.parse(decrypt(source.credentials)) as FacebookCredentials;
    } catch (error) {
      // Without the pageId we cannot tell which entries belong to this source — fail closed.
      logger.error(`${TAG} Failed to decrypt credentials`, { sourceId: source.id, error });
      return [];
    }
    const { pageId, pageAccessToken } = creds;

    if (isManualFetch) {
      const now = new Date();
      // A fetch started by a person carries a range or ignoreSyncCursor; the scheduled
      // catch-up carries neither and only looks at recent posts.
      const isCatchUp = !options?.backfill && !options?.ignoreSyncCursor;
      const range =
        options?.backfill ??
        (isCatchUp
          ? catchUpRange(source, now)
          : { startDate: new Date(now.getTime() - DEFAULT_FETCH_WINDOW_MS), endDate: now });
      return this.newHistoryItems(
        source.id,
        fetchFacebookHistory(creds, range, { recentPostsOnly: isCatchUp }),
      );
    }

    const messages: FacebookWebhookMessaging[] = [];
    const comments: FacebookWebhookComment[] = [];

    for (const entry of payload.entry ?? []) {
      // Entries for other Pages in the same POST are ingested against their own source by the route.
      if (entry.id !== pageId) continue;

      for (const messaging of entry.messaging ?? []) {
        const senderId = (messaging.sender as { id?: string } | undefined)?.id;
        if (!senderId || senderId === pageId) continue;
        const timestamp = (messaging.timestamp as number | undefined) ?? Date.now();

        const msg = messaging.message as FacebookWebhookMessaging['message'] | undefined;
        if (msg?.mid) {
          if (msg.is_echo) continue;
          logger.info(`${TAG} Incoming DM`, { mid: msg.mid, sender: senderId, pageId });
          messages.push({
            sender: {
              id: senderId,
              name:
                (await facebookGraphClient.getSenderName(pageAccessToken, pageId, senderId)) ??
                undefined,
            },
            recipient: { id: pageId },
            timestamp,
            message: msg,
          });
          continue;
        }

        // message_edit: the customer edited a DM they already sent. num_edit=0 duplicates the
        // original message event, so only real edits update the ticket body.
        const edit = messaging.message_edit as
          | { mid?: string; num_edit?: number; text?: string }
          | undefined;
        if (edit?.mid && edit.num_edit !== 0 && edit.text !== undefined) {
          messages.push({
            sender: { id: senderId },
            recipient: { id: pageId },
            timestamp,
            message: { mid: edit.mid, text: edit.text },
            isContentUpdate: true,
          });
        }
      }

      for (const change of entry.changes ?? []) {
        if (change.field === 'feed') {
          const value = change.value as FacebookFeedValue;
          if (value.item !== 'comment' || value.verb !== 'add') continue;
          if (!value.comment_id) continue;
          // Skip the Page's own comments (echoes of replies sent from the desk).
          if (value.from?.id === pageId) continue;

          // parent_id is the post for a top-level comment and the parent comment for a reply;
          // replies thread under the parent comment's ticket.
          const isReply = !!value.parent_id && value.parent_id !== value.post_id;
          logger.info(`${TAG} Incoming comment on own post`, {
            commentId: value.comment_id,
            isReply,
            pageId,
          });
          comments.push({
            type: 'comment',
            senderName: value.from?.name ?? value.from?.id ?? 'unknown',
            senderId: value.from?.id ?? '',
            // Photo, GIF and sticker comments arrive with no message.
            text: value.message || FACEBOOK_TEXTLESS_COMMENT,
            commentId: isReply ? value.parent_id : value.comment_id,
            rawCommentId: value.comment_id,
            postId: value.post_id,
            permalink:
              (await facebookGraphClient.getPostOrComment(pageAccessToken, value.comment_id))
                ?.permalink_url ?? postLink(value.post_id),
            timestamp: value.created_time ? value.created_time * 1000 : Date.now(),
          });
        } else if (change.field === 'mention') {
          const value = change.value as FacebookMentionValue;
          if (value.verb && value.verb !== 'add') continue;
          if (!value.post_id) continue;

          const isComment = value.item === 'comment' && !!value.comment_id;
          // A comment on this Page's own post also arrives through `feed`, which threads it
          // correctly; taking the mention too would open a second ticket for the same comment.
          if (isComment && value.post_id.startsWith(`${pageId}_`)) continue;

          // The mention webhook often carries no sender_id/sender_name, but the Graph API
          // returns the author and permalink of the post or comment that did the mentioning.
          const mentioning = await facebookGraphClient.getPostOrComment(
            pageAccessToken,
            isComment && value.comment_id ? value.comment_id : value.post_id,
          );
          // When Meta gives neither (it hides authors for privacy), the author stays unknown:
          // the first half of a post id is the timeline it sits on, not who wrote it.
          const senderId = value.sender_id ?? mentioning?.from?.id;
          if (senderId === pageId) continue;
          const senderName = value.sender_name ?? mentioning?.from?.name ?? FACEBOOK_UNKNOWN_AUTHOR;

          logger.info(`${TAG} Incoming mention`, {
            item: value.item,
            postId: value.post_id,
            commentId: value.comment_id,
            pageId,
          });
          comments.push({
            type: 'mention',
            senderName,
            senderId: senderId ?? '',
            text: value.message ?? '',
            ...(isComment && { commentId: value.comment_id, rawCommentId: value.comment_id }),
            postId: value.post_id,
            permalink: mentioning?.permalink_url ?? postLink(value.post_id),
            timestamp: value.created_time ? value.created_time * 1000 : Date.now(),
          });
        }
      }
    }

    return [...messages, ...comments];
  }

  /** Reads the fetched history a page of Meta results at a time, keeping only what is new. */
  private async newHistoryItems(
    sourceId: string,
    batches: AsyncGenerator<FacebookItem[]>,
  ): Promise<FacebookItem[]> {
    const items: FacebookItem[] = [];
    try {
      for await (const batch of batches) items.push(...(await this.withoutStored(sourceId, batch)));
    } catch (error) {
      // Every fetch (manual or hourly) reads with the Page token, so this is where a dead one
      // shows up. The fetch still fails; the Page is left ready to reconnect.
      if (isFacebookTokenRejected(error)) await disconnectSourceWithDeadToken(sourceId);
      throw error;
    }
    return items;
  }

  /**
   * Drops items already ingested. Core would detect them as duplicates too, but only after
   * re-downloading their attachments and re-running postprocess, which re-opens resolved tickets.
   */
  private async withoutStored(sourceId: string, items: FacebookItem[]): Promise<FacebookItem[]> {
    const idOf = (item: FacebookItem): string | null =>
      'message' in item ? dmExternalId(sourceId, item.message.mid) : commentExternalId(sourceId, item);
    const ids = items.map(idOf).filter((id): id is string => !!id);
    const storedIds = new Set<string>();
    for (let i = 0; i < ids.length; i += STORED_LOOKUP_CHUNK) {
      const stored = await db.externalMessage.findMany({
        where: { externalSourceId: sourceId, externalId: { in: ids.slice(i, i + STORED_LOOKUP_CHUNK) } },
        select: { externalId: true },
      });
      for (const message of stored) storedIds.add(message.externalId);
    }
    return items.filter((item) => {
      const id = idOf(item);
      return !!id && !storedIds.has(id);
    });
  }

  getSourceNameFromDB(payload: unknown): string | undefined {
    const [pageId] = facebookPageIdsInPayload(payload);
    return pageId ? `facebook-${pageId}` : undefined;
  }

  isTestQueryParam(query: Record<string, string | undefined>): TestPayloadResult {
    return verifyMetaWebhookSubscription(query);
  }
}
