import type { ExternalSource } from '@prisma/client';
import { BaseFlow } from '@/integrations/core/baseFlow';
import type { TestPayloadResult } from '@/integrations/core/types';
import { decrypt } from '@/services/encryptionService';
import { logger } from '@/utils/logger';
import { verifyMetaWebhookSubscription } from '../shared/metaWebhookVerification';
import { facebookGraphClient } from './facebookGraphClient';
import type {
  FacebookCredentials,
  FacebookFeedValue,
  FacebookMentionValue,
  FacebookWebhookComment,
  FacebookWebhookMessaging,
  FacebookWebhookPayload,
} from './types';

const TAG = '[FacebookFlow]';

/** Distinct Page ids in a webhook POST. Meta may batch events for several Pages into one request. */
export function facebookPageIdsInPayload(rawPayload: unknown): string[] {
  const payload = rawPayload as Partial<FacebookWebhookPayload>;
  if (payload?.object !== 'page') return [];
  return [...new Set((payload.entry ?? []).map((entry) => entry.id).filter(Boolean))];
}

const postLink = (postId: string | undefined): string | undefined =>
  postId ? `https://www.facebook.com/${postId}` : undefined;

export class FacebookFlow extends BaseFlow {
  async preprocess(
    rawPayload: unknown,
    source?: ExternalSource,
  ): Promise<(FacebookWebhookMessaging | FacebookWebhookComment)[]> {
    const payload = rawPayload as Partial<FacebookWebhookPayload>;
    if (payload?.object !== 'page') return [];

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
              name: (await facebookGraphClient.getSenderName(pageAccessToken, senderId)) ?? undefined,
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
            text: value.message || '[Comment without text — open Facebook to view]',
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
          // Last resort for a post: its id is "{authorId}_{postId}".
          const senderId =
            value.sender_id ??
            mentioning?.from?.id ??
            (isComment ? undefined : value.post_id.split('_')[0]);
          if (senderId === pageId) continue;
          const senderName =
            value.sender_name ??
            mentioning?.from?.name ??
            (senderId ? await facebookGraphClient.getSenderName(pageAccessToken, senderId) : null) ??
            'Facebook user';

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

  getSourceNameFromDB(payload: unknown): string | undefined {
    const [pageId] = facebookPageIdsInPayload(payload);
    return pageId ? `facebook-${pageId}` : undefined;
  }

  isTestQueryParam(query: Record<string, string | undefined>): TestPayloadResult {
    return verifyMetaWebhookSubscription(query);
  }
}
