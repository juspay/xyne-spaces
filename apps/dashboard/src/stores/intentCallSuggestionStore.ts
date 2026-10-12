/**
 * Local, in-memory call suggestions for the sender's own messages; gone on reload.
 * Two maps because the data arrives in two steps: the composer knows who and where
 * at send time, the classifier says whether ~500ms later and carries only a messageId.
 */
import { useSyncExternalStore } from 'react';
import { trace } from '../services/onDeviceIntent/debug';

/** Which composer the message was sent from, and so which list shows its card. */
export type IntentCallSurface = 'channel' | 'thread';

interface PendingCall {
  participantIds: string[];
  surface: IntentCallSurface;
  /** The thread or channel it was sent in; a room keeps one live card. */
  room: string;
}

export interface IntentCallSuggestion extends PendingCall {
  intentKey: string;
}

const PENDING_MAX = 20;
const pending = new Map<string, PendingCall>();
const suggestions = new Map<string, IntentCallSuggestion>();
const listeners = new Set<() => void>();
const notify = (): void => listeners.forEach(l => l());

export const rememberCallParticipants = (
  messageId: string,
  participantIds: string[],
  surface: IntentCallSurface,
  room: string,
): void => {
  pending.set(messageId, { participantIds, surface, room });
  while (pending.size > PENDING_MAX) pending.delete(pending.keys().next().value as string);
};

export const promoteIntentCallSuggestion = (messageId: string, intentKey: string): void => {
  // Every mounted ChatInput hears the detection; only the first promotion counts.
  const sent = pending.get(messageId);
  if (suggestions.has(messageId) || !sent) return;
  pending.delete(messageId);
  trace('main', '8. call card', { messageId, surface: sent.surface });
  // Newest wins: a chatty room shows one card, under its latest call message.
  for (const [id, s] of suggestions) if (s.room === sent.room) suggestions.delete(id);
  suggestions.set(messageId, { ...sent, intentKey });
  notify();
};

export const removeIntentCallSuggestion = (messageId: string): void => {
  if (suggestions.delete(messageId)) notify();
};

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useIntentCallSuggestion = (messageId: string): IntentCallSuggestion | undefined =>
  useSyncExternalStore(subscribe, () => suggestions.get(messageId));
