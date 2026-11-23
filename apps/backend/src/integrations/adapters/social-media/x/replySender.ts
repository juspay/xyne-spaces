import { EmailType, MessageDirection } from '@xyne/shared';
import {
  BaseInteractionReplySender,
  InteractionReplyContext,
  InteractionReplyValidationError,
} from '@/integrations/core/baseInteractionReplySender';
import type { NormalizedData } from '@/integrations/core/types';
import { SOCIAL_MEDIA_INTERACTION_TYPES } from '@/integrations/social-media/constants';
import { db } from '@/database/client';
import { isXCreditsDepleted, isXRateLimited, isXReplyNotPermitted, xApiClient, type XApiClient } from './client';
import { X_DM_THREAD_PREFIX, X_MAX_DM_LENGTH, X_MAX_POST_LENGTH, X_POST_THREAD_PREFIX } from './constants';
import { dmCounterparty } from './normalizer';
import { parseXCredentials, XConnectionLostError, xchatAccountFor, xTokenService, type XTokenService } from './tokenService';
import { xDmExternalId, xPostExternalId, xPostUrl } from './transformer';
import { isXChatMessageId, xchatService, type XChatService } from './xchat';

/**
 * The Post to answer: the newest inbound Post in the thread. `inboundExternalIds` are
 * `${sourceId}:post:${postId}`; Post ids are time-ordered snowflakes, so the largest is newest —
 * safer than row createdAt, which is ingest time and is out of order for polled backfill.
 */
export function pickReplyTargetPostId(sourceId: string, inboundExternalIds: string[]): string | undefined {
  const prefix = `${sourceId}:post:`;
  let best: bigint | undefined;
  for (const id of inboundExternalIds) {
    if (!id.startsWith(prefix)) continue;
    const raw = id.slice(prefix.length);
    if (!/^\d+$/.test(raw)) continue;
    const n = BigInt(raw);
    if (best === undefined || n > best) best = n;
  }
  return best?.toString();
}

/** X weights some characters double; this is the conservative code-point count. */
const postLength = (text: string) => Array.from(text).length;

function toReplyError(error: unknown): never {
  if (error instanceof XConnectionLostError) throw new InteractionReplyValidationError(error.message);
  if (isXReplyNotPermitted(error)) {
    throw new InteractionReplyValidationError(
      'X only allows replying to posts that mention this account or that it wrote — respond on X directly',
    );
  }
  if (isXCreditsDepleted(error)) {
    throw new InteractionReplyValidationError(
      'The X developer account for this desk is out of credits — top up in the X Developer Console, then try again',
    );
  }
  if (isXRateLimited(error)) throw new InteractionReplyValidationError('X rate limit reached — try again in a few minutes');
  throw error;
}

export class XReplySender extends BaseInteractionReplySender {
  constructor(
    private readonly client: XApiClient = xApiClient,
    private readonly tokens: XTokenService = xTokenService,
    private readonly xchat: XChatService = xchatService,
  ) {
    super();
  }

  async sendReply(context: InteractionReplyContext): Promise<NormalizedData> {
    const { source, externalThreadId, subject, body, userId, authorName } = context;
    if (!source.channelId) throw new InteractionReplyValidationError('X account is not bound to a desk');
    if (!source.isActive || !source.credentials) {
      throw new InteractionReplyValidationError('X account is disconnected — reconnect it in desk settings');
    }
    const creds = parseXCredentials(source.credentials);
    const fromName = creds.username ? `@${creds.username}` : authorName;

    const reply = (externalId: string, url?: string): NormalizedData => ({
      externalId,
      externalThreadId,
      author: { name: fromName, externalId: creds.xUserId },
      content: body,
      emailData: { subject: `Re: ${subject}`, from: fromName, to: [], type: EmailType.REPLY, sentByUserId: userId, skipBlockingCheck: true },
      metadata: {
        eventType: SOCIAL_MEDIA_INTERACTION_TYPES.REPLY,
        timestamp: new Date(),
        source: 'social-media',
        isReply: true,
        ...(url && { webUrl: url }),
      },
    });

    if (externalThreadId.startsWith(X_POST_THREAD_PREFIX)) {
      if (postLength(body) > X_MAX_POST_LENGTH) {
        throw new InteractionReplyValidationError(`Reply exceeds X's ${X_MAX_POST_LENGTH}-character limit`);
      }
      const inbound = await db.externalMessage.findMany({
        where: { externalSourceId: source.id, externalThreadId, direction: MessageDirection.INCOMING },
        select: { externalId: true },
      });
      const targetPostId = pickReplyTargetPostId(source.id, inbound.map((m) => m.externalId));
      if (!targetPostId) throw new InteractionReplyValidationError('No customer post found in this thread to reply to');

      const posted = await this.tokens
        .withUserToken(source, (token) => this.client.replyToPost(token, targetPostId, body))
        .catch(toReplyError);
      return reply(xPostExternalId(source.id, posted.id), xPostUrl(posted.id, creds.username));
    }

    if (externalThreadId.startsWith(X_DM_THREAD_PREFIX)) {
      if (body.length > X_MAX_DM_LENGTH) {
        throw new InteractionReplyValidationError(`Message exceeds X's ${X_MAX_DM_LENGTH}-character DM limit`);
      }
      const dmConversationId = externalThreadId.slice(X_DM_THREAD_PREFIX.length);
      const recipient = dmCounterparty(dmConversationId, creds.xUserId);
      if (!recipient) throw new InteractionReplyValidationError('Group DMs are not supported');

      // Answer on the channel the customer last wrote on. Without XChat keys a legacy DM still
      // reaches an XChat user (live-verified), so that is the fallback.
      const account = xchatAccountFor(source, this.tokens);
      if (account && (await this.lastInboundWasXChat(source.id, externalThreadId))) {
        const messageId = await this.xchat.send(account, dmConversationId, body).catch(toReplyError);
        return reply(xDmExternalId(source.id, messageId));
      }
      const sent = await this.tokens
        .withUserToken(source, (token) => this.client.sendDm(token, recipient, body))
        .catch(toReplyError);
      // Same id scheme as inbound DMs, so a later poll or dm.sent echo of this message dedups.
      return reply(xDmExternalId(source.id, sent.dmEventId));
    }

    throw new InteractionReplyValidationError('Unknown X conversation type');
  }

  private async lastInboundWasXChat(sourceId: string, externalThreadId: string): Promise<boolean> {
    const last = await db.externalMessage.findFirst({
      where: { externalSourceId: sourceId, externalThreadId, direction: MessageDirection.INCOMING },
      orderBy: { createdAt: 'desc' },
      select: { externalId: true },
    });
    const id = last?.externalId.split(':dm:')[1];
    return !!id && isXChatMessageId(id);
  }
}
