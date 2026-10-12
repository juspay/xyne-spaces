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
import { globalClickTracker } from '../services/Analytics/globalClickTracker';

export interface IntentCallSuggestion {
  detection: IntentDetection;
  /**
   * When the suggestion first became visible. Lives here, not in the card: the
   * message list is virtualized, so the card remounts as it scrolls in and out,
   * and a per-mount clock would skew msShown and double-count impressions.
   */
  shownAt: number;
}

/**
 * Keep-last-N cap. A session that trips the classifier dozens of times without
 * acting on any of them should not hold every entry for the rest of the session;
 * nobody scrolls back to act on the twentieth-oldest suggestion.
 */
const MAX_ENTRIES = 20;

const suggestions = new Map<string, IntentCallSuggestion>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function addIntentCallSuggestion(detection: IntentDetection): void {
  // ChatInput only classifies new sends, never edits, so a second detection for
  // the same messageId does not happen in practice; if it did it would replace
  // the entry. A card whose message is later edited to drop the call request
  // stays until dismissed — accepted for now.
  const existing = suggestions.get(detection.messageId);
  if (existing) {
    suggestions.set(detection.messageId, { ...existing, detection });
    emit();
    return;
  }
  // Impression is counted exactly once per detection, here, matching the toast
  // it replaced. The card's own ACT_ON / DISMISSED events use the same clock.
  globalClickTracker.trackManualEvent('INTENT_SUGGESTION', 'SUGGESTION_SHOWN', undefined, {
    intentKey: detection.intentId,
    hasAction: true,
    surface: detection.surface,
  });
  suggestions.set(detection.messageId, { detection, shownAt: Date.now() });
  // Map iterates in insertion order, so the first key is the oldest entry.
  while (suggestions.size > MAX_ENTRIES) {
    const oldest = suggestions.keys().next().value;
    if (oldest === undefined) break;
    suggestions.delete(oldest);
  }
  emit();
}

export function dismissIntentCallSuggestion(messageId: string): void {
  if (suggestions.delete(messageId)) emit();
}

export function getIntentCallSuggestion(messageId: string): IntentCallSuggestion | undefined {
  return suggestions.get(messageId);
}

export function subscribeIntentCallSuggestions(listener: () => void): () => void {
  listeners.add(listener);
  return (): void => {
    listeners.delete(listener);
  };
}

/** The pending start-call suggestion for one message, or undefined. */
export function useIntentCallSuggestion(messageId: string): IntentCallSuggestion | undefined {
  return useSyncExternalStore(subscribeIntentCallSuggestions, () =>
    getIntentCallSuggestion(messageId),
  );
}
