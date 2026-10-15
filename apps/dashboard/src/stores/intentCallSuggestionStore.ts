import { useSyncExternalStore } from 'react';
import type { IntentDetection } from '../services/onDeviceIntent';
import { globalClickTracker } from '../services/Analytics/globalClickTracker';

export interface IntentCallSuggestion {
  detection: IntentDetection;
  shownAt: number;
}

const MAX_ENTRIES = 20;

const suggestions = new Map<string, IntentCallSuggestion>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function addIntentCallSuggestion(detection: IntentDetection): void {
  const existing = suggestions.get(detection.messageId);
  if (existing) {
    suggestions.set(detection.messageId, { ...existing, detection });
    emit();
    return;
  }
  globalClickTracker.trackManualEvent('INTENT_SUGGESTION', 'SUGGESTION_SHOWN', undefined, {
    intentKey: detection.intentId,
    hasAction: true,
    surface: detection.surface,
  });
  suggestions.set(detection.messageId, { detection, shownAt: Date.now() });
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

export function useIntentCallSuggestion(messageId: string): IntentCallSuggestion | undefined {
  return useSyncExternalStore(subscribeIntentCallSuggestions, () =>
    getIntentCallSuggestion(messageId),
  );
}
