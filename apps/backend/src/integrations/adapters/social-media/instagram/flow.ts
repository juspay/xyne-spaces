import type { ExternalSource } from '@prisma/client';
import { BaseFlow } from '@/integrations/core/baseFlow';
import type { TestPayloadResult } from '@/integrations/core/types';
import { verifyMetaWebhookSubscription } from '../shared/metaWebhookVerification';
import { decrypt } from '@/services/encryptionService';
import type {
  InstagramCommentValue,
  InstagramCredentials,
  InstagramMentionValue,
  InstagramWebhookComment,
  InstagramWebhookMessaging,
  InstagramWebhookPayload,
} from './types';
import { metaGraphClient } from './metaGraphClient';
import { logger } from '@/utils/logger';

// Module-level dedup cache for own-post @mention double-fire.
// When someone comments "@xyne.spaces" on xyne.spaces's own post, Meta fires BOTH:
//   - changes.comments (→ comment: ticket)
//   - messages template  (→ mention:mid ticket)
// Both arrive simultaneously as separate HTTP requests. Node.js yields at `await getMessage(...)`
// (async I/O) so the synchronous changes.comments request completes first and inserts its key
// here BEFORE getMessage returns. The template mention then sees the key and skips.
// Key uses senderId (app-scoped numeric ID) — always present and consistent across both paths.
// key = `${sourceId}:${senderId}`, value = expiry timestamp (ms)
const _ownPostCommentDedup = new Map<string, number>();
const _DEDUP_TTL_MS = 30_000;

function _markCommentSeen(sourceId: string, senderId: string): void {
  _ownPostCommentDedup.set(`${sourceId}:${senderId}`, Date.now() + _DEDUP_TTL_MS);
  // Prune expired entries on each write to prevent unbounded growth.
  const now = Date.now();
  for (const [k, exp] of _ownPostCommentDedup) {
    if (exp < now) _ownPostCommentDedup.delete(k);
  }
}

function _isCommentDuplicate(sourceId: string, senderId: string): boolean {
  const exp = _ownPostCommentDedup.get(`${sourceId}:${senderId}`);
  if (exp === undefined) return false;
  if (exp < Date.now()) {
    _ownPostCommentDedup.delete(`${sourceId}:${senderId}`);
    return false;
  }
  return true;
}

export class InstagramFlow extends BaseFlow {
  async preprocess(
    rawPayload: unknown,
    source?: ExternalSource
  ): Promise<(InstagramWebhookMessaging | InstagramWebhookComment)[]> {
    const payload = rawPayload as Partial<InstagramWebhookPayload>;

    if (payload?.object !== 'instagram') return [];

    logger.debug('[InstagramFlow] Webhook received', {
      entryCount: payload.entry?.length ?? 0,
      messagingCount: payload.entry?.reduce((n, e) => n + (e.messaging?.length ?? 0), 0) ?? 0,
    });

    // Decrypt credentials so we can fetch message content and sender profile.
    let accessToken: string | undefined;
    let businessIgsid: string | undefined; // IGSID — for API calls
    let businessIgUserId: string | undefined; // IGSID = webhook entry.id — for B2 filter
    if (source?.credentials) {
      try {
        const creds = JSON.parse(decrypt(source.credentials)) as InstagramCredentials;
        accessToken = creds.accessToken;
        businessIgsid = creds.igsid ?? creds.igUserId;
        businessIgUserId = creds.igUserId; // IGSID = webhook entry.id
      } catch (err) {
        // Corrupt credentials: without businessIgUserId the B2 filter would be disabled,
        // meaning events from OTHER IG accounts could be mis-attributed to this source.
        // Fail closed — return empty to avoid cross-account data corruption.
        logger.error(
          '[InstagramFlow] Failed to decrypt credentials — returning empty to preserve B2 filter',
          { sourceId: source.id, error: err }
        );
        return [];
      }
    } else {
      logger.warn('[InstagramFlow] preprocess called with no source credentials', {
        sourceId: source?.id,
      });
    }

    const messages: InstagramWebhookMessaging[] = [];
    const mentionComments: InstagramWebhookComment[] = [];
    for (const entry of payload.entry ?? []) {
      if (businessIgUserId && entry.id !== businessIgUserId) {
        logger.warn(
          '[InstagramFlow] B2 filter: DROPPING entry — entry.id does not match stored igUserId',
          {
            sourceId: source?.id,
            storedBusinessIgUserId: businessIgUserId,
            webhookEntryId: entry.id,
          }
        );
        continue;
      }

      for (const messaging of (entry.messaging ?? []) as unknown as Array<
        Record<string, unknown>
      >) {
        // Standard message event — text is included directly in the payload.
        const msg = messaging.message as InstagramWebhookMessaging['message'] | undefined;
        if (msg?.mid) {
          if (msg.is_echo) {
            logger.debug('[InstagramFlow] Skipping echo (outbound from business account)', {
              mid: msg.mid,
            });
            continue;
          }
          // Skip share-only notifications — Instagram sends these as a side-channel echo
          // when someone comments or mentions this account. The real content arrives via
          // changes.comments / changes.mentions and gets its own separate ticket.
          // Without this filter the share shows up as "[Attachment received]" in the DM thread.
          const attachments = msg.attachments as Array<{ type: string; payload?: unknown }> | undefined;
          if (attachments?.length) {
            logger.debug('[InstagramFlow] Message has attachments', {
              mid: msg.mid,
              hasText: !!msg.text,
              attachmentTypes: attachments.map((a) => a.type),
            });
          }
          if (!msg.text && attachments?.length) {
            const isTemplate = attachments.some((a) => a.type === 'template');
            if (isTemplate) {
              // IG Login delivers @mention-in-comment notifications as template messages with no text.
              // Only template attachments are echoes from comments/mentions — skip them.
              // Non-template attachments (image, video, audio) are real customer DMs and fall through.
              if (accessToken) {
                // await here yields the event loop — a concurrent changes.comments request for the
                // same action (own-post comment with @mention) runs to completion and marks itself
                // in _ownPostCommentDedup before getMessage returns.
                const full = await metaGraphClient.getMessage(accessToken, msg.mid);
                if (full?.from?.id) {
                  // If changes.comments already processed for this sender (own-post comment),
                  // skip — the comment ticket covers it.
                  if (source && _isCommentDuplicate(source.id, full.from.id)) {
                    logger.info('[InstagramFlow] Skipping template mention — own-post comment already processed', {
                      mid: msg.mid,
                      senderId: full.from.id,
                    });
                    continue;
                  }
                  const senderUsername = full.from.username ?? full.from.id;
                  logger.info('[InstagramFlow] Incoming mention via template message', {
                    mid: msg.mid,
                    senderUsername,
                    senderId: full.from.id,
                  });
                  mentionComments.push({
                    type: 'mention',
                    senderUsername,
                    senderId: full.from.id,
                    text: `@${senderUsername} mentioned you on Instagram — open Instagram to view the comment`,
                    mid: msg.mid,
                    timestamp: (messaging.timestamp as number | undefined) ?? Date.now(),
                  });
                  continue;
                }
              }
              logger.info('[InstagramFlow] Skipping template-only notification (comment/mention echo)', {
                mid: msg.mid,
                attachmentTypes: attachments.map((a) => a.type),
              });
              continue;
            }
            // Non-template attachment (image, video, audio, etc.) — fall through to DM processing below.
            logger.info('[InstagramFlow] Processing attachment-only DM', {
              mid: msg.mid,
              attachmentTypes: attachments.map((a) => a.type),
            });
          }
          logger.info('[InstagramFlow] Incoming DM', {
            mid: msg.mid,
            sender: (messaging.sender as { id?: string } | undefined)?.id,
            entryId: entry.id,
          });
          const built = messaging as unknown as InstagramWebhookMessaging;
          if (accessToken && businessIgsid && built.sender.id) {
            built.sender.username =
              (await metaGraphClient.getSenderUsername(
                accessToken,
                businessIgsid,
                built.sender.id
              )) ?? undefined;
          }
          messages.push(built);
          continue;
        }

        // message_edit event — fired when a customer edits a DM they previously sent.
        // num_edit=0 can arrive as a duplicate of a message event when both 'messages'
        // and 'message_edits' are subscribed; skip it to avoid double-processing.
        // num_edit > 0 is a real customer edit — update the ticket body with the new text.
        const edit = messaging.message_edit as
          | { mid?: string; num_edit?: number; text?: string }
          | undefined;
        if (edit?.mid !== undefined) {
          if (edit.num_edit === 0) continue;
          // messaging.timestamp is Unix ms from Meta; fall back to Date.now() (also ms) if absent.
          const tsRaw = (messaging.timestamp as number | undefined) ?? Date.now();

          // Prefer sender + text inline from the webhook payload — the message_edit event
          // always includes sender.id and the new text. Avoid the getMessage API round-trip
          // which empirically returns {} for recently-edited messages.
          const inlineSenderId = (messaging.sender as { id?: string } | undefined)?.id;
          const inlineText = edit.text;
          if (inlineSenderId && inlineText !== undefined) {
            if (businessIgUserId && inlineSenderId === businessIgUserId) continue;
            messages.push({
              sender: { id: inlineSenderId },
              recipient: {
                id: (messaging.recipient as { id?: string } | undefined)?.id ?? entry.id,
              },
              timestamp: tsRaw,
              message: { mid: edit.mid, text: inlineText },
              isContentUpdate: true,
            });
          } else {
            // Fallback: fetch via API when sender/text are absent from the webhook.
            type FetchedMessage = Awaited<ReturnType<typeof metaGraphClient.getMessage>>;
            const fetched: FetchedMessage = accessToken
              ? await metaGraphClient.getMessage(accessToken, edit.mid)
              : null;
            if (fetched?.message !== undefined && fetched.from?.id) {
              const senderId = fetched.from.id;
              if (businessIgUserId && senderId === businessIgUserId) continue;
              messages.push({
                sender: { id: senderId },
                recipient: { id: fetched.to?.data?.[0]?.id ?? entry.id },
                timestamp: tsRaw,
                message: { mid: fetched.id, text: fetched.message },
                isContentUpdate: true,
              });
            }
          }
        }
      }
      // --- Mentions (Case 1 & 2) and Comments on own posts (Case 3) ---
      for (const change of entry.changes ?? []) {
        if (change.field === 'mentions') {
          // Case 1: mention in a comment; Case 2: mention in a caption
          const value = change.value as InstagramMentionValue;
          if (!value?.media_id) continue;

          if (value.comment_id) {
            // Case 1 — fetch comment text; try getCommentDetails first (returns text + username
            // in one call), fall back to getMentionedComment if that fails.
            logger.info('[InstagramFlow] Incoming mention in comment', {
              commentId: value.comment_id,
              mediaId: value.media_id,
              entryId: entry.id,
            });
            const details = accessToken
              ? await metaGraphClient.getCommentDetails(accessToken, value.comment_id)
              : null;

            let commentText = details?.text ?? '';
            const senderUsername = details?.username ?? '';
            let ts = details?.timestamp ? new Date(details.timestamp).getTime() : 0;

            if (!commentText && accessToken && businessIgsid) {
              // Fallback: use the mentioned_comment endpoint
              const mentionResp = await metaGraphClient.getMentionedComment(
                accessToken,
                businessIgsid,
                value.comment_id
              );
              const mc = mentionResp?.mentioned_comment;
              if (mc) {
                commentText = mc.text ?? '';
                if (mc.timestamp) ts = new Date(mc.timestamp).getTime();
              } else {
                logger.warn('[InstagramFlow] Both getCommentDetails and getMentionedComment returned no data', {
                  commentId: value.comment_id,
                });
              }
            }

            mentionComments.push({
              type: 'mention',
              senderUsername: senderUsername || value.comment_id,
              senderId: details?.id ?? value.comment_id,
              text: commentText,
              commentId: value.comment_id,
              mediaId: value.media_id,
              timestamp: ts || Date.now(),
            });
          } else {
            // Case 2 — mention in a caption; fetch media details to get caption and owner
            logger.info('[InstagramFlow] Incoming caption mention', {
              mediaId: value.media_id,
              entryId: entry.id,
            });
            const mediaResp =
              accessToken && businessIgsid
                ? await metaGraphClient.getMentionedMedia(
                    accessToken,
                    businessIgsid,
                    value.media_id
                  )
                : null;
            const mm = mediaResp?.mentioned_media;
            if (!mm) {
              logger.warn('[InstagramFlow] getMentionedMedia returned no data', {
                mediaId: value.media_id,
              });
              continue;
            }
            // Try to resolve owner username via the profile API
            let senderUsername = mm.owner?.id ?? value.media_id;
            if (accessToken && businessIgsid && mm.owner?.id) {
              senderUsername =
                (await metaGraphClient.getSenderUsername(
                  accessToken,
                  businessIgsid,
                  mm.owner.id
                )) ?? senderUsername;
            }
            const ts = mm.timestamp ? new Date(mm.timestamp).getTime() : Date.now();
            mentionComments.push({
              type: 'mention',
              senderUsername,
              senderId: mm.owner?.id ?? '',
              text: mm.caption ?? '',
              mediaId: value.media_id,
              timestamp: ts,
            });
          }
        } else if (change.field === 'comments') {
          // Case 3 — someone commented on the business account's own post
          const value = change.value as InstagramCommentValue;
          if (!value?.id || !value?.text) continue;

          // Skip comments posted by the business account itself (echoes from our own replies)
          const commenterId = value.from?.id;
          if (commenterId && (commenterId === businessIgsid || commenterId === businessIgUserId)) {
            logger.debug('[InstagramFlow] Skipping own-account comment echo', {
              commentId: value.id,
            });
            continue;
          }

          // Meta doesn't include parent_id in the webhook payload, so fetch it via API.
          // This tells us whether this comment is a reply — if so, thread it under the
          // parent comment's ticket instead of creating a new one.
          let parentId: string | undefined;
          if (accessToken) {
            const details = await metaGraphClient.getCommentDetails(accessToken, value.id);
            parentId = details?.parent_id;
          }
          const threadCommentId = parentId ?? value.id;

          logger.info('[InstagramFlow] Incoming comment on own post', {
            commentId: value.id,
            parentId: parentId ?? null,
            threadCommentId,
            isReply: !!parentId,
            senderId: commenterId,
            entryId: entry.id,
          });
          // Mark this sender so any concurrent template mention (fired by Meta for the same
          // @mention action) is skipped. Use senderId — always the same app-scoped numeric ID
          // in both this path and the getMessage response in the template mention path.
          if (source && commenterId) {
            _markCommentSeen(source.id, commenterId);
          }

          // Meta sends comment timestamps as ISO strings; convert to ms
          const ts =
            typeof value.timestamp === 'number'
              ? value.timestamp * 1000
              : value.timestamp
                ? new Date(value.timestamp).getTime()
                : Date.now();

          mentionComments.push({
            type: 'comment',
            senderUsername: value.from?.username ?? commenterId ?? 'unknown',
            senderId: commenterId ?? '',
            text: value.text,
            commentId: threadCommentId,   // parent_id for replies → same thread as parent
            rawCommentId: value.id,       // actual id → unique externalId per reply
            mediaId: value.media?.id ?? '',
            timestamp: ts,
          });
        }
      }
    }
    return [...messages, ...mentionComments];
  }

  getSourceNameFromDB(payload: unknown): string | undefined {
    const body = payload as Record<string, unknown>;
    const entries = body?.entry as Array<Record<string, unknown>> | undefined;
    const entry = entries?.[0];
    const igUserId = entry?.id as string | undefined;
    if (!igUserId) {
      logger.warn('[InstagramFlow] getSourceNameFromDB: entry.id is missing from webhook payload');
      return undefined;
    }
    const sourceName = `instagram-${igUserId}`;

    // Warn if Meta batched entries for more than one account — only the first is
    // processed here. If this warning fires in production, implement per-account dispatch.
    const distinctIds = new Set(entries?.map((e) => e.id).filter(Boolean) ?? []);
    if (distinctIds.size > 1) {
      logger.warn(
        '[InstagramFlow] Webhook contains entries for multiple IG accounts — only first processed',
        {
          accounts: [...distinctIds],
        }
      );
    }

    return sourceName;
  }

  isTestQueryParam(query: Record<string, string | undefined>): TestPayloadResult {
    return verifyMetaWebhookSubscription(query);
  }
}
