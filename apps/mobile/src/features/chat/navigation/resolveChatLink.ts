import type { ChatLinkOpenIntent } from './chatOpenIntent';
import { readConversationTicketId } from './threadTicketSurface';
import {
  resolveBaseConversationSurface,
  type BaseConversationSurface,
} from '../baseConversationSurface';

type ResolvableConversation = {
  channelId: string;
  conversationId: string;
  createdAt: number;
  initialMessageId: string;
  messages?: ReadonlyArray<{ messageId?: string | null | undefined }> | null | undefined;
  ticketId?: string | null;
  ticket?: { id?: string | null | undefined } | null | undefined;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  ticket_md?: string | null | undefined;
  channel?: { scopeType?: string | null | undefined } | null | undefined;
};

type ResolvableMessage = {
  messageId: string;
  conversation: ResolvableConversation | null | undefined;
};

export type ResolvedChatLocation = {
  channelId: string;
  destination: 'main' | 'thread' | 'ticketThread';
  threadId?: string;
  ticketId?: string;
  conversationId: string;
  messageId?: string;
  createdAt: number;
  source: ChatLinkOpenIntent['source'];
  surface: BaseConversationSurface;
  scopeType?: string;
};

export type ChatLinkResolution =
  | { status: 'ok'; location: ResolvedChatLocation }
  | { status: 'not_found' }
  | { status: 'unavailable' };

export type ChatLinkResolverDependencies = {
  getMessage: (messageId: string) => Promise<ResolvableMessage | null | undefined>;
  getConversation: (conversationId: string) => Promise<ResolvableConversation | null | undefined>;
};

const inFlightByScope = new WeakMap<object, Map<string, Promise<ChatLinkResolution>>>();

export const getChatLinkLocationKey = (intent: ChatLinkOpenIntent): string =>
  [
    intent.hint.channelId,
    intent.hint.conversationId ?? '',
    intent.hint.threadId ?? '',
    intent.hint.messageId ?? '',
  ].join('|');

const isResolvableConversation = (
  value: ResolvableConversation | null | undefined,
): value is ResolvableConversation =>
  !!value &&
  !!value.channelId &&
  !!value.conversationId &&
  !!value.initialMessageId &&
  Number.isFinite(value.createdAt) &&
  value.createdAt > 0;

const buildResolvedLocation = ({
  conversation,
  intent,
  messageId,
  isMain,
}: {
  conversation: ResolvableConversation;
  intent: ChatLinkOpenIntent;
  messageId?: string;
  isMain: boolean;
}): ResolvedChatLocation => {
  const ticketId = isMain ? null : readConversationTicketId(conversation);
  const destination = isMain ? 'main' : ticketId ? 'ticketThread' : 'thread';
  const scopeType = conversation.channel?.scopeType ?? intent.hint.scopeType;
  return {
    channelId: conversation.channelId,
    destination,
    ...(destination !== 'main' ? { threadId: conversation.conversationId } : {}),
    ...(ticketId ? { ticketId } : {}),
    conversationId: conversation.conversationId,
    ...(messageId ? { messageId } : {}),
    createdAt: conversation.createdAt,
    source: intent.source,
    surface: resolveBaseConversationSurface(scopeType, intent.hint.surface),
    ...(scopeType ? { scopeType } : {}),
  };
};

/**
 * Use persisted chat data only when it contains the exact linked message.
 * Cache data is an optimistic display source; the Zero lookup remains the
 * authority whenever this check misses.
 */
export const resolveChatLinkFromCache = (
  intent: ChatLinkOpenIntent,
  cachedThreadConversation: ResolvableConversation | null | undefined,
  cachedChannelConversation?: ResolvableConversation | null | undefined,
): ResolvedChatLocation | null => {
  if (intent.kind !== 'link' || intent.source !== 'deeplink') return null;

  const hintedConversationId = intent.hint.threadId ?? intent.hint.conversationId;
  if (!hintedConversationId) return null;

  const messageId = intent.hint.messageId;
  for (const cachedConversation of [cachedThreadConversation, cachedChannelConversation]) {
    if (
      !isResolvableConversation(cachedConversation) ||
      cachedConversation.channelId !== intent.hint.channelId ||
      cachedConversation.conversationId !== hintedConversationId
    ) {
      continue;
    }

    // Channel cache rows carry the root identity but not the related message
    // array. The root message is therefore a valid cache hit through
    // initialMessageId even when the inline relation is absent.
    const targetIsCached =
      !messageId ||
      messageId === cachedConversation.initialMessageId ||
      cachedConversation.messages?.some(message => message.messageId === messageId) === true;
    if (!targetIsCached) continue;

    return buildResolvedLocation({
      conversation: cachedConversation,
      intent,
      ...(messageId ? { messageId } : {}),
      isMain:
        !intent.hint.threadId && (!messageId || messageId === cachedConversation.initialMessageId),
    });
  }

  return null;
};

export const resolveChatLink = async (
  intent: ChatLinkOpenIntent,
  dependencies: ChatLinkResolverDependencies,
): Promise<ChatLinkResolution> => {
  try {
    const messageId = intent.hint.messageId;
    const hintedConversationId = intent.hint.threadId ?? intent.hint.conversationId;
    const hintedConversationPromise = hintedConversationId
      ? dependencies.getConversation(hintedConversationId)
      : Promise.resolve(undefined);

    if (messageId && intent.hint.conversationId && !intent.hint.threadId) {
      const hintedConversation = await hintedConversationPromise;
      if (
        isResolvableConversation(hintedConversation) &&
        hintedConversation.channelId === intent.hint.channelId &&
        hintedConversation.initialMessageId === messageId
      ) {
        return {
          status: 'ok',
          location: buildResolvedLocation({
            conversation: hintedConversation,
            intent,
            messageId,
            isMain: true,
          }),
        };
      }
    }

    if (messageId) {
      const [message, hintedConversation] = await Promise.all([
        dependencies.getMessage(messageId),
        hintedConversationPromise,
      ]);
      const messageConversation = message?.conversation;
      if (!message || !isResolvableConversation(messageConversation))
        return { status: 'not_found' };
      if (
        messageConversation.channelId !== intent.hint.channelId ||
        (hintedConversationId !== undefined &&
          hintedConversationId !== messageConversation.conversationId)
      ) {
        return { status: 'not_found' };
      }

      // The activity message query only relates the base conversation. Prefer
      // the separately fetched conversation because it includes the ticket
      // relation needed to choose Ticket Details instead of a plain thread.
      const conversation = isResolvableConversation(hintedConversation)
        ? hintedConversation
        : messageConversation;
      if (conversation.channelId !== intent.hint.channelId) return { status: 'not_found' };

      return {
        status: 'ok',
        location: buildResolvedLocation({
          conversation,
          intent,
          messageId: message.messageId,
          isMain: !intent.hint.threadId && message.messageId === conversation.initialMessageId,
        }),
      };
    }

    if (!hintedConversationId) return { status: 'not_found' };
    const conversation = await hintedConversationPromise;
    if (
      !isResolvableConversation(conversation) ||
      conversation.channelId !== intent.hint.channelId
    ) {
      return { status: 'not_found' };
    }

    return {
      status: 'ok',
      location: buildResolvedLocation({
        conversation,
        intent,
        isMain: !intent.hint.threadId,
      }),
    };
  } catch {
    return { status: 'unavailable' };
  }
};

/**
 * A URL event can be delivered twice during cold start. Share the authoritative
 * lookup only within the current Zero client, so a sign-out/new session never
 * receives a promise created for a previous client.
 */
export const resolveChatLinkDeduped = (
  scope: object,
  intent: ChatLinkOpenIntent,
  dependencies: ChatLinkResolverDependencies,
  options: { force?: boolean } = {},
): Promise<ChatLinkResolution> => {
  let inFlight = inFlightByScope.get(scope);
  if (!inFlight) {
    inFlight = new Map();
    inFlightByScope.set(scope, inFlight);
  }

  const key = getChatLinkLocationKey(intent);
  const existing = inFlight.get(key);
  if (existing && !options.force) return existing;

  const pending = resolveChatLink(intent, dependencies);
  inFlight.set(key, pending);
  void pending.finally(() => {
    if (inFlight?.get(key) === pending) inFlight.delete(key);
  });
  return pending;
};
