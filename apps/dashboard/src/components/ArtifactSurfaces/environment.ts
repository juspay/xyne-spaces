import { useSyncExternalStore } from 'react';

/**
 * The page facts apps are told about, and that decide whether an overlay runs
 * at all. Each is a tiny external store so every running app reads the same
 * value without its own listener.
 */

const subscribeVisibility = (listener: () => void): (() => void) => {
  document.addEventListener('visibilitychange', listener);
  return () => document.removeEventListener('visibilitychange', listener);
};
const isVisible = (): boolean =>
  typeof document === 'undefined' || document.visibilityState !== 'hidden';

/** False while the page is not on screen: another tab, a minimized window. */
export const useDocumentVisible = (): boolean =>
  useSyncExternalStore(subscribeVisibility, isVisible, () => true);

const subscribeTheme = (listener: () => void): (() => void) => {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
};
const colorScheme = (): 'light' | 'dark' =>
  typeof document !== 'undefined' &&
  document.documentElement.getAttribute('data-theme') === 'midnight'
    ? 'dark'
    : 'light';

/** Midnight is the only dark Spaces theme. */
export const useColorScheme = (): 'light' | 'dark' =>
  useSyncExternalStore(subscribeTheme, colorScheme, () => 'light');

/**
 * A viewer who asks for less motion, less transparency or their own colours
 * gets no overlay at all — not mounting also stops the overlay's own loops.
 */
const PLAIN_QUERY =
  '(prefers-reduced-motion: reduce), (prefers-reduced-transparency: reduce), (forced-colors: active)';
const subscribePlain = (listener: () => void): (() => void) => {
  const query = window.matchMedia(PLAIN_QUERY);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
};
const prefersPlain = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia(PLAIN_QUERY).matches;

export const usePrefersPlainOverlays = (): boolean =>
  useSyncExternalStore(subscribePlain, prefersPlain, () => false);
