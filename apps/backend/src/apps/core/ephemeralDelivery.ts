/**
 * Delivery for ephemeral messages — the step shared by chat.postEphemeral's two
 * front doors (the native app API and the Slack adapter).
 *
 * It sits in core/ for the same reason findOrCreateConversation does: the Slack
 * adapter translates Slack's request shape and Slack's response shape, but the
 * thing in between must behave identically however it was reached. Minting a
 * capability token and addressing a user room are exactly that middle, and a
 * second copy of either would be a second chance to get authorization wrong.
 *
 * Nothing here writes to the database. The card exists only as a socket frame
 * and in the recipient's browser.
 */
import crypto from 'node:crypto';
import { MessageType, validateFlowDefinition, formatValidationErrors } from '@xyne/shared';
import type { MessageDelivery } from '@xyne/shared';
import { repositories } from '@/database/repositories';
import { redisService } from '@/services/redisService';
import { isAlphanumericId, encodeHtmlAttr } from '@/utils/contentUtils';
import { ContentFormat } from '../types';
import { mintFlowToken } from './flowToken';

export interface EphemeralDeliveryArgs {
  /** Already resolved by the caller — this function does no channel lookup. */
  channelId: string;
  /** Set only when the card was posted into a thread. */
  conversationId?: string;
  /** The one user who will see the card. */
  recipientId: string;
  senderId: string;
  senderName?: string | null;
  messageDelivery: MessageDelivery;
  /**
   * The app this card belongs to, taken from the verified auth token — never
   * from the request body. Required whenever `flow` is present, because it is
   * what the capability token authorises.
   */
  appId?: string;
  /** An interactive card. Validated here; callers pass their own shape through. */
  flow?: unknown;
  /** Rendered HTML or markdown, used when there is no `flow`. */
  content?: string;
  isMarkdown?: boolean;
  metadata?: Record<string, unknown>;
}

export type EphemeralDeliveryResult =
  | { ok: true; messageId: string }
  | { ok: false; reason: 'not_in_channel' | 'invalid_app' | 'invalid_flow'; details?: string[] };

/**
 * Build the stored-message-shaped content for an interactive ephemeral card.
 *
 * Mirrors what postMessage embeds for a persisted flow, with one difference that
 * matters: a persisted message's appId is read back out of `data-flow-appid`,
 * which only works because the row is trusted server state. Nothing stores this
 * card, so the appId travels as a signed token instead and the attribute is
 * along only for the renderer.
 */
function buildFlowContent(
  flow: unknown,
  appId: string,
  token: string,
):
  | { ok: true; content: string; flowJSON: Record<string, unknown> }
  | { ok: false; reason: 'invalid_app' | 'invalid_flow'; details?: string[] } {
  if (!isAlphanumericId(appId)) {
    return { ok: false, reason: 'invalid_app' };
  }

  const flowResult = validateFlowDefinition(flow);
  if (!flowResult.success) {
    return { ok: false, reason: 'invalid_flow', details: formatValidationErrors(flowResult) };
  }

  // Injected AFTER validation and into `data`, not the top level: the schema
  // strips unknown top-level keys, so a token placed there would silently
  // vanish, while `data` is a passthrough record and survives every round-trip
  // back through context.flowJSON.
  const flowJSON = {
    ...flowResult.data,
    data: { ...(flowResult.data.data ?? {}), __xyneFlowToken: token },
  };

  const flowId = flowResult.data.screenId ?? crypto.randomUUID();
  const escapedJSON = JSON.stringify(flowJSON).replace(/"/g, '&quot;');
  const fbRaw = (flowJSON.data as Record<string, unknown>)['fallbackText'];
  const flowFallback = encodeHtmlAttr(
    (typeof fbRaw === 'string' && fbRaw.trim() ? fbRaw : flowJSON.title) || 'Flow JSON',
  );

  return {
    ok: true,
    content: `<div data-flow-json="${escapedJSON}" data-flow-appid="${encodeHtmlAttr(appId)}" data-flow-id="${encodeHtmlAttr(flowId)}">${flowFallback}</div>`,
    flowJSON: flowJSON as unknown as Record<string, unknown>,
  };
}

/**
 * Mint, build and relay an ephemeral card to one user.
 *
 * Returns as soon as the frame is published. That is a broadcast, not a
 * delivery: a recipient with no live socket never receives it, and there is no
 * row for them to catch up on when they reconnect. Callers must not report it
 * as "sent".
 */
export async function deliverEphemeralMessage(
  args: EphemeralDeliveryArgs,
): Promise<EphemeralDeliveryResult> {
  // The posting bot's channel access is checked by the route's own middleware.
  // The recipient's is checked here, or an app could address a card at someone
  // with no part in the channel it claims to come from.
  const isParticipant = await repositories.channelParticipants.isParticipant(
    args.channelId,
    args.recipientId,
  );
  if (!isParticipant) {
    return { ok: false, reason: 'not_in_channel' };
  }

  // Generated before the content: the token binds this id, so the card and the
  // capability to act on it refer to the same message.
  const messageId = crypto.randomUUID();

  // A card posted into a thread belongs to that thread's conversation. One posted
  // to a channel has no conversation, but the client renders it as a conversation
  // row and FlowRenderer refuses to dispatch an action without an id — so
  // synthesize one. Like the messageId, it names nothing that was stored.
  const conversationId = args.conversationId ?? crypto.randomUUID();

  let content = args.content ?? '';
  let flowJSON: Record<string, unknown> | undefined;
  let isMarkdown = args.isMarkdown ?? false;

  if (args.flow !== undefined) {
    if (!args.appId) {
      return { ok: false, reason: 'invalid_app' };
    }
    const token = mintFlowToken({ appId: args.appId, userId: args.recipientId, messageId });
    const built = buildFlowContent(args.flow, args.appId, token);
    if (!built.ok) {
      return { ok: false, reason: built.reason, ...(built.details && { details: built.details }) };
    }
    content = built.content;
    flowJSON = built.flowJSON;
    isMarkdown = false;
  }

  // Addressed to one user, so route by user room rather than channel session: a
  // session broadcast only reaches sockets with that channel open and silently
  // drops otherwise. User rooms are joined at connect time.
  //
  // The client decides where to put it from `isThreadReply`: an EPHEMERAL card
  // renders inline in the thread it was posted to, or as a row in the channel.
  await redisService.broadcastUserEvent(args.recipientId, {
    type: args.messageDelivery === 'OPENSCREEN' ? 'open_screen_message' : 'ephemeral_message',
    userId: args.recipientId,
    data: {
      channelId: args.channelId,
      message: {
        messageId,
        conversationId,
        // Distinguishes a real thread conversation from the synthesized one
        // above, which the client must not try to open as a thread.
        isThreadReply: !!args.conversationId,
        senderId: args.senderId,
        senderName: args.senderName,
        content,
        // The popup renders a screen, not HTML — sending the object saves it
        // re-parsing the content string to recover what we already have.
        ...(flowJSON && { flowJSON }),
        msgType: MessageType.BOT,
        createdAt: new Date(),
        metadata: {
          ...(isMarkdown && { contentFormat: ContentFormat.MARKDOWN }),
          ...args.metadata,
        },
        visibleTo: args.recipientId,
        messageDelivery: args.messageDelivery,
        ephemeral: true,
      },
    },
    timestamp: new Date(),
  });

  return { ok: true, messageId };
}
