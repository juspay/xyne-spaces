/**
 * Start-call intent detections waiting to be rendered as an inline card under
 * the message that triggered them.
 *
 * Local only, keyed by messageId: a detection comes from the sender's own device
 * (see services/onDeviceIntent), so only the sender ever sees the card, and only
 * in the list that rendered the message. Nothing here is persisted — a reload is
 * a fresh chance to be useful, same as the toast cooldown.
 *
 * Hand-rolled subscribe/snapshot pair for useSyncExternalStore, like
 * switchOverlayStore. `getSuggestion` returns the same object until that entry
 * changes, so subscribers do not re-render on unrelated updates.
 */
import { useSyncExternalStore } from 'react';
import type { IntentDetection } from '../services/onDeviceIntent';

const suggestions = new Map<string, IntentDetection>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function addIntentCallSuggestion(detection: IntentDetection): void {
  // Re-classifying the same message (an edit) replaces its entry in place.
  suggestions.set(detection.messageId, detection);
  emit();
}

export function dismissIntentCallSuggestion(messageId: string): void {
  if (suggestions.delete(messageId)) emit();
}

export function getIntentCallSuggestion(messageId: string): IntentDetection | undefined {
  return suggestions.get(messageId);
}

export function subscribeIntentCallSuggestions(listener: () => void): () => void {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
}

/** The pending start-call suggestion for one message, or undefined. */
export function useIntentCallSuggestion(messageId: string): IntentDetection | undefined {
  return useSyncExternalStore(subscribeIntentCallSuggestions, () =>
    getIntentCallSuggestion(messageId),
  );
}
