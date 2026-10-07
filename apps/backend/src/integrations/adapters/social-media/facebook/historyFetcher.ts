import { logger } from '@/utils/logger';
import { FACEBOOK_TEXTLESS_COMMENT, FACEBOOK_UNKNOWN_AUTHOR } from './constants';
import { facebookGraphClient } from './facebookGraphClient';
import type {
  FacebookCredentials,
  FacebookWebhookComment,
  FacebookWebhookMessaging,
} from './types';

const TAG = '[FacebookHistory]';

type HistoryItem = FacebookWebhookMessaging | FacebookWebhookComment;

/**
 * Manual fetch and hourly catch-up: reads the Page's Messenger conversations, post comments and
 * tagged posts for a time range, in the same shape flow.ts produces from webhooks. Yields one
 * batch per page read from Meta, so the caller can filter out stored items a page at a time.
 * Each batch is oldest first: DM threading reads the customer's previously stored message, and a reply should
 * land after the comment it answers. The Page's own messages and comments are left out —
 * replies sent from the desk are already stored under the ids Meta returned on send.
 */
export async function* fetchFacebookHistory(
  creds: FacebookCredentials,
  range: { startDate: Date; endDate: Date },
  // The hourly catch-up scans only the newest posts for comments, to keep its API cost small.
  { recentPostsOnly = false }: { recentPostsOnly?: boolean } = {},
): AsyncGenerator<HistoryItem[]> {
  const { pageId, pageAccessToken } = creds;
  const start = range.startDate.getTime();
  const end = range.endDate.getTime();
  const inRange = (timestamp: number): boolean => timestamp >= start && timestamp <= end;
  const oldestFirst = (items: HistoryItem[]): HistoryItem[] =>
    items.sort((a, b) => a.timestamp - b.timestamp);
  let total = 0;

  const conversationPages = facebookGraphClient.conversationPages(
    pageAccessToken,
    pageId,
    range.startDate,
  );
  for await (const conversations of conversationPages) {
    const items: HistoryItem[] = [];
    for (const conversation of conversations) {
      for (const message of conversation.messages) {
        const timestamp = Date.parse(message.created_time);
        if (!message.from?.id || message.from.id === pageId || !inRange(timestamp)) continue;
        items.push({
          sender: { id: message.from.id, name: message.from.name },
          recipient: { id: pageId },
          timestamp,
          message: {
            mid: message.id,
            text: message.message || undefined,
            attachments: (message.attachments?.data ?? []).map((attachment) => ({
              type: attachment.mime_type?.split('/')[0] ?? 'file',
              payload: {
                url:
                  attachment.image_data?.url ?? attachment.video_data?.url ?? attachment.file_url,
              },
            })),
          },
        });
      }
    }
    total += items.length;
    yield oldestFirst(items);
  }

  for await (const posts of facebookGraphClient.postPages(pageAccessToken, pageId, recentPostsOnly)) {
    const items: HistoryItem[] = [];
    for (const post of posts) {
      for (const comment of post.comments) {
        const timestamp = Date.parse(comment.created_time);
        if (comment.from?.id === pageId || !inRange(timestamp)) continue;
        items.push({
          type: 'comment',
          senderName: comment.from?.name ?? comment.from?.id ?? FACEBOOK_UNKNOWN_AUTHOR,
          senderId: comment.from?.id ?? '',
          text: comment.message || FACEBOOK_TEXTLESS_COMMENT,
          commentId: comment.parent?.id ?? comment.id,
          rawCommentId: comment.id,
          postId: post.id,
          permalink: comment.permalink_url,
          timestamp,
        });
      }
    }
    total += items.length;
    yield oldestFirst(items);
  }

  // Only posts that tag the Page can be listed; mentions made inside comments elsewhere
  // arrive by webhook only.
  const tagged = await facebookGraphClient.listTaggedPosts(pageAccessToken, pageId, range.startDate);
  const mentions: HistoryItem[] = [];
  for (const post of tagged) {
    const timestamp = Date.parse(post.created_time);
    if (post.from?.id === pageId || !inRange(timestamp)) continue;
    mentions.push({
      type: 'mention',
      senderName: post.from?.name ?? FACEBOOK_UNKNOWN_AUTHOR,
      senderId: post.from?.id ?? '',
      text: post.message ?? '',
      postId: post.id,
      permalink: post.permalink_url,
      timestamp,
    });
  }
  total += mentions.length;
  yield oldestFirst(mentions);

  logger.info(`${TAG} Fetched history`, { pageId, itemsInRange: total });
}
