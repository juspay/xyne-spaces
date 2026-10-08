import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useSelector } from '@xstate/react';
import { MessageType, buildInitialMessageMd } from '@xyne/shared';
import type { FlowDefinition } from '@xyne/shared';
import type { Conversation } from '../machines/stateMachine';
import { websocketService } from '../services/clients/socketClient';
import { authActor } from '../machines/authMachine';

/**
 * Ephemeral messages posted via chat.postEphemeral.
 *
 * Nothing about these is persisted — not in Postgres, not in Redis. They arrive
 * over the recipient's user room, live in this module for the life of the tab,
 * and are gone on reload. That is the whole feature: an app can put something in
 * front of one person without leaving a message behind.
 *
 * The two delivery modes land in different places:
 *
 * - EPHEMERAL  renders inline, in the channel or thread it was addressed to,
 *              exactly where an ordinary message from that app would appear.
 * - OPENSCREEN renders as a popup, and only while the recipient is actually
 *              looking at that channel. It is an interruption, so it is scoped
 *              to the context that makes it meaningful.
 *
 * Both are per-user and client-only, so this store is the entire record of them.
 */
export type EphemeralMessage = {
  messageId: string;
  conversationId: string;
  channelId?: string;
  /** False for a channel-level card, whose conversationId is synthesized. */
  isThreadReply?: boolean;
  senderId: string;
  senderName?: string;
  content: string;
  /** Present when the card carries a flow — the popup renders this directly. */
  flowJSON?: FlowDefinition;
  msgType?: string;
  createdAt: Date | number | string;
  metadata?: Record<string, unknown>;
  visibleTo?: string | null;
  messageDelivery?: 'EPHEMERAL' | 'OPENSCREEN';
};

/** Payload of the user event (handleUserEvent spreads event.data). */
type EphemeralEvent = {
  channelId?: string;
  message?: EphemeralMessage;
};

/**
 * One flat list rather than per-channel buckets: arrivals are rare and the
 * lists are short, so the selectors below can afford to filter. Keeping a
 * single array also means `getSnapshot` returns a stable reference, which
 * useSyncExternalStore requires — every derived shape is built in a useMemo.
 */
let items: EphemeralMessage[] = [];
const listeners = new Set<() => void>();
const EMPTY: EphemeralMessage[] = [];

/** Who the stored messages were delivered to. */
let currentUserId: string | null = null;

function notify(): void {
  for (const listener of listeners) listener();
}

function clearAll(): void {
  if (items.length === 0) return;
  items = EMPTY;
  notify();
}

function add(event: EphemeralEvent): void {
  const message = event.message;
  if (!message?.messageId) return;

  // The server routes these to the recipient's user room, so this is a second
  // guard: it keeps another account's card out of the store after a user switch
  // in the same tab, before `clearAll` has run.
  if (message.visibleTo && currentUserId && message.visibleTo !== currentUserId) return;
  if (items.some(m => m.messageId === message.messageId)) return;

  items = [...items, { ...message, ...(event.channelId && { channelId: event.channelId }) }];
  notify();
}

export function dismissEphemeralMessage(messageId: string): void {
  const next = items.filter(m => m.messageId !== messageId);
  if (next.length === items.length) return;
  items = next;
  notify();
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return (): void => {
    listeners.delete(callback);
  };
}

function getSnapshot(): EphemeralMessage[] {
  return items;
}

function useEphemeralItems(): EphemeralMessage[] {
  return useSyncExternalStore(subscribe, getSnapshot);
}

function toTimestamp(createdAt: EphemeralMessage['createdAt']): number {
  const ms = createdAt instanceof Date ? createdAt.getTime() : new Date(createdAt).getTime();
  return Number.isNaN(ms) ? Date.now() : ms;
}

/**
 * Owns the socket subscription for the whole tab.
 *
 * Mounted once (EphemeralFlowHost calls it), so the selectors below stay pure
 * subscribers and ChatListV4 / ThreadPannel can read the store from as many
 * places as they like without each attaching its own listeners.
 */
export function useEphemeralMessageBridge(): void {
  // Selected narrowly rather than via useAuth(), which subscribes to the whole
  // auth state — this runs in a component mounted for the whole session.
  const userId = useSelector(authActor, state => state.context.user?.id ?? null);

  // A different account in the same tab must not inherit the previous one's cards.
  useEffect(() => {
    if (currentUserId === userId) return;
    currentUserId = userId;
    clearAll();
  }, [userId]);

  useEffect(() => {
    let active = true;

    // A fresh socket means a fresh session: nothing stored is replayable, and it
    // may belong to a login that has since been replaced.
    const handleConnect = (): void => clearAll();

    // Registered inside connect() on purpose. websocketService.on() returns early
    // when the socket is null, and connect() calls removeAllListeners() and builds
    // a NEW socket — so a listener attached once, eagerly, is silently dropped the
    // first time anything reconnects.
    void websocketService
      .connect()
      .then(() => {
        if (!active) return;
        websocketService.on('ephemeral_message', add);
        websocketService.on('open_screen_message', add);
        websocketService.on('connect', handleConnect);
      })
      .catch(() => {});

    return (): void => {
      active = false;
      websocketService.removeListener('ephemeral_message', add);
      websocketService.removeListener('open_screen_message', add);
      websocketService.removeListener('connect', handleConnect);
    };
  }, []);
}

/**
 * EPHEMERAL cards addressed to this channel rather than to one of its threads,
 * shaped as conversation rows so ChatListV4 can render them beside real ones.
 *
 * Built the same way pending sends are (buildInitialMessageMd + a conversation
 * row), with two differences that matter: `isSent` is true, because there is
 * nothing in flight to a server, and `visibleTo` is set, so the row is filtered
 * to this user by the same check that guards persisted visibleTo messages.
 */
export function useEphemeralChannelConversations(channelId: string): Conversation[] {
  const all = useEphemeralItems();
  const workspaceId = useSelector(authActor, state => state.context.user?.workspaceId ?? null);
  const userId = useSelector(authActor, state => state.context.user?.id ?? null);

  return useMemo(() => {
    const mine = all.filter(
      m => m.messageDelivery !== 'OPENSCREEN' && m.channelId === channelId && !m.isThreadReply,
    );
    if (mine.length === 0) return EMPTY as unknown as Conversation[];

    return mine.map(m => {
      const timestamp = toTimestamp(m.createdAt);
      return {
        conversationId: m.conversationId,
        channelId,
        workspaceId,
        createdBy: m.senderId,
        initialMessageId: m.messageId,
        parentMessageId: null,
        lastActivityAt: timestamp,
        replyCount: 0,
        pinned: false,
        ticketId: null,
        metadata: {},
        callId: null,
        replies_md: null,
        ticket_md: null,
        initial_message_md: buildInitialMessageMd({
          messageId: m.messageId,
          conversationId: m.conversationId,
          workspaceId,
          senderId: m.senderId,
          content: m.content,
          msgType: (m.msgType as MessageType) ?? MessageType.BOT,
          hasAttachment: false,
          createdAt: timestamp,
          visibleTo: m.visibleTo ?? userId,
          isSent: true,
          metadata: { ...(m.metadata ?? {}), __xyneEphemeral: true },
        }),
        parent_message_md: null,
        doNotPostToChannel: null,
        createdAt: timestamp,
        initialMessageAttachments: [],
        initialMessageNudgeCounts: [],
      } as unknown as Conversation;
    });
  }, [all, channelId, workspaceId, userId]);
}

/** EPHEMERAL cards posted into one thread, shaped as that thread's messages. */
export function useEphemeralThreadMessages(conversationId: string | undefined): unknown[] {
  const all = useEphemeralItems();
  const workspaceId = useSelector(authActor, state => state.context.user?.workspaceId ?? null);
  const userId = useSelector(authActor, state => state.context.user?.id ?? null);

  return useMemo(() => {
    if (!conversationId) return EMPTY;
    const mine = all.filter(
      m =>
        m.messageDelivery !== 'OPENSCREEN' &&
        m.isThreadReply === true &&
        m.conversationId === conversationId,
    );
    if (mine.length === 0) return EMPTY;

    return mine.map(m => ({
      messageId: m.messageId,
      conversationId: m.conversationId,
      workspaceId,
      senderId: m.senderId,
      content: m.content,
      msgType: (m.msgType as MessageType) ?? MessageType.BOT,
      hasAttachment: false,
      edited: false,
      isSent: true,
      isDeleted: false,
      showInChannel: false,
      childConversationId: null,
      visibleTo: m.visibleTo ?? userId,
      createdAt: toTimestamp(m.createdAt),
      metadata: { ...(m.metadata ?? {}), __xyneEphemeral: true },
      attachments: [],
      nudgeCounts: [],
    }));
  }, [all, conversationId, workspaceId, userId]);
}

/**
 * The OPENSCREEN card to show right now, or undefined.
 *
 * Scoped to the channel the recipient is actually looking at. A popup that
 * appears over an unrelated part of the product is an interruption with no
 * context; one that appears while the channel is open reads as coming from it.
 * The card stays in the store if they are elsewhere, so navigating to the
 * channel brings it up rather than losing it.
 *
 * Only the head is shown. An app can push a second card while the first is
 * half-filled, and replacing it would destroy typed input.
 */
export function useEphemeralOpenScreen(
  activeChannelId: string | undefined,
): EphemeralMessage | undefined {
  const all = useEphemeralItems();

  return useMemo(() => {
    if (!activeChannelId) return undefined;
    return all.find(m => m.messageDelivery === 'OPENSCREEN' && m.channelId === activeChannelId);
  }, [all, activeChannelId]);
}
