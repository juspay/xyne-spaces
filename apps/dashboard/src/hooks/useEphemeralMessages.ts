import { useEffect, useSyncExternalStore } from 'react';
import { useSelector } from '@xstate/react';
import { websocketService } from '../services/clients/socketClient';
import { authActor } from '../machines/authMachine';

export type EphemeralMessage = {
  messageId: string;
  conversationId: string;
  channelId?: string;
  senderId: string;
  senderName?: string;
  senderPicture?: string | null;
  content: string;
  msgType: string;
  createdAt: Date | number | string;
  hasAttachment?: boolean;
  attachments?: unknown[];
  metadata?: Record<string, unknown>;
  visibleTo?: string | null;
  ephemeral?: boolean;
};

/** Payload of the `ephemeral_message` user event (handleUserEvent spreads event.data). */
type EphemeralMessageEvent = {
  channelId?: string;
  message?: EphemeralMessage;
};

const store = new Map<string, EphemeralMessage[]>();
const listeners = new Set<() => void>();
const EMPTY: EphemeralMessage[] = [];

/** Who the messages currently held in `store` were delivered to. */
let currentUserId: string | null = null;

function notify(): void {
  for (const listener of listeners) listener();
}

function clearStore(): void {
  if (store.size === 0) return;
  store.clear();
  notify();
}

/**
 * Drop one message wherever it is held. The dismissal event carries only a messageId —
 * the server keys the broadcast by the resolved channel id but writes
 * `conversationId ?? resolvedChannelId` into the message, so the two can differ and the
 * channel is not a reliable lookup key. The map holds a handful of entries; scan it.
 */
function removeMessage(messageId: string): void {
  for (const [channelId, list] of store) {
    const next = list.filter(m => m.messageId !== messageId);
    if (next.length === list.length) continue;
    if (next.length === 0) store.delete(channelId);
    else store.set(channelId, next);
    notify();
    return;
  }
}

function handleEphemeralDismissed(event: { messageId?: string }): void {
  if (event.messageId) removeMessage(event.messageId);
}

function handleEphemeralMessage(event: EphemeralMessageEvent): void {
  const message = event.message;
  const channelId = event.channelId;
  if (!message || !channelId) return;

  // The server routes these to the recipient's user room, so this is a second guard:
  // it keeps another account's message out of the store after a user switch in the
  // same tab, before `clearStore` has run.
  if (message.visibleTo && currentUserId && message.visibleTo !== currentUserId) return;

  const existing = store.get(channelId) ?? EMPTY;
  if (existing.some(m => m.messageId === message.messageId)) return;

  const next = [...existing, message].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  store.set(channelId, next);
  notify();
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return (): void => {
    listeners.delete(callback);
  };
}

export function useEphemeralMessages(channelId: string | undefined): EphemeralMessage[] {
  // Selected narrowly rather than via useAuth(), which subscribes to the whole auth
  // state — this hook runs inside ConversationPanelV2 and ThreadPannel.
  const userId = useSelector(authActor, state => state.context.user?.id ?? null);

  // A different account in the same tab must not inherit the previous one's messages.
  useEffect(() => {
    if (currentUserId === userId) return;
    currentUserId = userId;
    clearStore();
  }, [userId]);

  // Registered per mount, not once per page: `connect()` calls removeAllListeners() and
  // builds a new Socket (socketClient.ts), so a listener attached once is silently lost
  // the first time anything reconnects. Same shape as DynamicDashboardPanel.
  useEffect(() => {
    let active = true;

    // A fresh socket means a fresh session — anything held is unreplayable, and may
    // belong to a login that has since been replaced.
    const handleConnect = (): void => clearStore();

    void websocketService
      .connect()
      .then(() => {
        if (!active) return;
        websocketService.on('ephemeral_message', handleEphemeralMessage);
        websocketService.on('ephemeral_dismissed', handleEphemeralDismissed);
        websocketService.on('connect', handleConnect);
      })
      .catch(() => {});

    return (): void => {
      active = false;
      websocketService.removeListener('ephemeral_message', handleEphemeralMessage);
      websocketService.removeListener('ephemeral_dismissed', handleEphemeralDismissed);
      websocketService.removeListener('connect', handleConnect);
    };
  }, []);

  return useSyncExternalStore(subscribe, () =>
    channelId ? (store.get(channelId) ?? EMPTY) : EMPTY,
  );
}
