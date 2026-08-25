import { useSyncExternalStore } from 'react';
import { websocketService } from '../services/clients/socketClient';

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
let initialized = false;

function notify(): void {
  for (const listener of listeners) listener();
}

function handleEphemeralMessage(event: EphemeralMessageEvent): void {
  const message = event.message;
  const channelId = event.channelId;
  if (!message || !channelId) return;

  const existing = store.get(channelId) ?? EMPTY;
  if (existing.some(m => m.messageId === message.messageId)) return;

  const next = [...existing, message].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  store.set(channelId, next);
  notify();
}

// Register the websocket listener exactly once for the lifetime of the page.
function ensureInitialized(): void {
  if (initialized) return;
  initialized = true;

  const start = async (): Promise<void> => {
    if (!websocketService.isConnectedToServer()) {
      await websocketService.connect();
    }
    websocketService.on('ephemeral_message', handleEphemeralMessage);
  };

  void start();
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return (): void => {
    listeners.delete(callback);
  };
}

export function useEphemeralMessages(channelId: string | undefined): EphemeralMessage[] {
  ensureInitialized();

  return useSyncExternalStore(subscribe, () =>
    channelId ? (store.get(channelId) ?? EMPTY) : EMPTY,
  );
}
