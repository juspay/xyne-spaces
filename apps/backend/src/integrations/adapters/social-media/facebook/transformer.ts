import type { ExternalSource } from '@prisma/client';
import { EmailType, FormFieldType } from '@xyne/shared';
import { BaseTransformer } from '@/integrations/core/baseTransformer';
import type { NormalizedData, ParseResult } from '@/integrations/core/types';
import { SOCIAL_MEDIA_INTERACTION_TYPES } from '@/integrations/social-media/constants';
import { ExternalMessageRepository } from '@/database/repositories/externalMessageRepository';
import {
  FACEBOOK_LINK_FIELD,
} from './constants';
import { metaDmBody, toDownloadableMetaAttachments } from '../shared/metaDmAttachments';
import { resolveMetaDmThread } from '../shared/metaDmThread';
import { paceHistoryWrite } from './historyFetcher';
import type { FacebookWebhookComment, FacebookWebhookMessaging } from './types';

// The ids below are also used by the manual fetch (flow.ts) to skip items already stored.

export const dmExternalId = (sourceId: string, mid: string): string => `${sourceId}:${mid}`;

/**
 * A post id is "{ownerId}_{postId}" and Meta spells the owner differently in webhooks and in
 * the Graph API, so a post is keyed by the part after the underscore.
 */
const postKey = (postId: string): string => postId.split('_').pop() ?? postId;

export function commentExternalId(sourceId: string, comment: FacebookWebhookComment): string | null {
  const key = comment.rawCommentId ?? (comment.postId ? postKey(comment.postId) : undefined);
  return key ? `${sourceId}:${comment.type}:${key}` : null;
}

export class FacebookTransformer extends BaseTransformer<unknown, NormalizedData[]> {
  private externalMessageRepo = new ExternalMessageRepository();

  async transform(
    payload: unknown,
    source?: ExternalSource,
  ): Promise<ParseResult<NormalizedData[]>> {
    // Core writes each item right after this returns, so pacing here caps fetched writes.
    if ((payload as { fromFetch?: boolean } | undefined)?.fromFetch) await paceHistoryWrite();

    const maybeComment = payload as FacebookWebhookComment;
    if (maybeComment?.type === 'mention' || maybeComment?.type === 'comment') {
      return this.transformComment(maybeComment, source);
    }

    const messaging = payload as FacebookWebhookMessaging;
    if (!source || !messaging?.message?.mid || !messaging?.sender?.id) {
      return { success: false, error: 'Invalid Facebook message payload' };
    }

    const psid = messaging.sender.id;
    const senderName = messaging.sender.name ?? psid;
    const mid = messaging.message.mid;
    const rawAttachments = messaging.message.attachments ?? [];
    const attachments = toDownloadableMetaAttachments(rawAttachments);
    const text = metaDmBody(messaging.message.text, rawAttachments, attachments.length, 'Facebook');

    if (messaging.isContentUpdate) {
      const existing = await this.externalMessageRepo.findByExternalId(
        source.id,
        dmExternalId(source.id, mid),
      );
      // The original was never ingested (sent before the Page was connected). Failing here
      // would 500 the whole webhook and make Meta redeliver it forever, so drop the edit.
      if (!existing?.externalThreadId) {
        return { success: true, data: [] };
      }
      return {
        success: true,
        data: [
          {
            externalId: dmExternalId(source.id, mid),
            externalThreadId: existing.externalThreadId,
            author: { name: senderName, externalId: psid },
            content: text,
            emailData: {
              // subject/from omitted so the update keeps the stored sender name.
              to: [],
              type: EmailType.DEFAULT,
              skipBlockingCheck: true,
              updateExisting: true,
            },
            metadata: {
              eventType: SOCIAL_MEDIA_INTERACTION_TYPES.DM,
              timestamp: new Date(messaging.timestamp),
              source: 'social-media',
            },
          },
        ],
      };
    }

    const { externalThreadId, windowExpired } = await resolveMetaDmThread(
      this.externalMessageRepo,
      source.id,
      psid,
      messaging.timestamp,
    );

    return {
      success: true,
      data: [
        {
          externalId: dmExternalId(source.id, mid),
          externalThreadId,
          author: { name: senderName, externalId: psid },
          content: text,
          ...(attachments.length > 0 && { attachments }),
          emailData: {
            subject: `Facebook message from ${senderName}`,
            from: senderName,
            to: source.displayName ? [source.displayName] : [],
            type: EmailType.DEFAULT,
            skipBlockingCheck: true,
          },
          metadata: {
            eventType: SOCIAL_MEDIA_INTERACTION_TYPES.DM,
            timestamp: new Date(messaging.timestamp),
            source: 'social-media',
            windowExpired: windowExpired.toString(),
            fromEmailAddress: senderName,
          },
        },
      ],
    };
  }

  private transformComment(
    comment: FacebookWebhookComment,
    source?: ExternalSource,
  ): ParseResult<NormalizedData[]> {
    if (!source) {
      return { success: false, error: 'Missing source for comment/mention transform' };
    }
    const externalId = commentExternalId(source.id, comment);
    if (!externalId) {
      return { success: false, error: 'Facebook comment/mention has no comment or post id' };
    }

    // comment:/post: prefixes let replySender tell these apart from DM threads (psid:timestamp).
    const externalThreadId = comment.commentId
      ? `comment:${comment.commentId}`
      : `post:${postKey(comment.postId ?? '')}`;
    const subjectVerb =
      comment.type === 'comment' ? 'comment' : comment.commentId ? 'mention' : 'post mention';

    return {
      success: true,
      data: [
        {
          externalId,
          externalThreadId,
          author: { name: comment.senderName, externalId: comment.senderId || undefined },
          content: comment.text,
          emailData: {
            subject: `Facebook ${subjectVerb} by ${comment.senderName}`,
            from: comment.senderName,
            to: source.displayName ? [source.displayName] : [],
            type: EmailType.DEFAULT,
            skipBlockingCheck: true,
          },
          metadata: {
            eventType: SOCIAL_MEDIA_INTERACTION_TYPES.MENTION,
            timestamp: new Date(comment.timestamp),
            source: 'social-media',
            fromEmailAddress: comment.senderName,
            ...(comment.commentId ? { commentId: comment.commentId } : {}),
            ...(comment.postId ? { postId: comment.postId } : {}),
          },
          ...(comment.permalink && {
            ticketCustomFields: [
              {
                fieldName: FACEBOOK_LINK_FIELD,
                fieldType: FormFieldType.STRING,
                value: comment.permalink,
              },
            ],
          }),
        },
      ],
    };
  }
}
