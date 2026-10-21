import { useSyncExternalStore } from 'react';

/**
 * Remembers which guide the user left through "Try it", so the floating
 * "Back to guide" bar can bring them back from whatever screen it opened.
 *
 * Module-level store with the same plain subscriber pattern as
 * `stores/recordingStore.ts`: no dependency, readable outside React, and one
 * `useSyncExternalStore` hook for the bar. Cleared when the user returns to
 * the guide by any route, dismisses the bar, or the protected shell unmounts.
 */

export interface GuideReturnTarget {
  guideId: string;
  title: string;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let target: GuideReturnTarget | null = null;

function emit(): void {
  listeners.forEach(listener => listener());
}

export function getGuideReturnTarget(): GuideReturnTarget | null {
  return target;
}

export function subscribeGuideReturn(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Call right before navigating away through "Try it". */
export function armGuideReturn(next: GuideReturnTarget): void {
  if (target?.guideId === next.guideId && target.title === next.title) return;
  target = { guideId: next.guideId, title: next.title };
  emit();
}

export function clearGuideReturn(): void {
  if (target === null) return;
  target = null;
  emit();
}

export function useGuideReturnTarget(): GuideReturnTarget | null {
  return useSyncExternalStore(subscribeGuideReturn, getGuideReturnTarget, getGuideReturnTarget);
}
