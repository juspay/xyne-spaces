import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return (): void => {};

  const mql = window.matchMedia(QUERY);
  mql.addEventListener('change', onChange);
  return (): void => mql.removeEventListener('change', onChange);
}

function getSnapshot(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(QUERY).matches;
}

/**
 * Whether the OS asks for reduced motion, kept live as the setting changes.
 *
 * Use this when the accessible answer is to *not render* something rather than
 * to stop animating it — a looping ping paused mid-frame reads as a stuck
 * element, so the incoming-call radar drops its rings entirely instead.
 * For animations that only need stopping, prefer a
 * `@media (prefers-reduced-motion: reduce)` rule in global.css.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
