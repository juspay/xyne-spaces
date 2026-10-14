import { useSyncExternalStore } from 'react';

export const CRITICAL_WINDOW_TIMEOUT_MS = 10_000;

type CriticalWindowEntry = {
  timeout: ReturnType<typeof setTimeout>;
};

const activeWindows = new Map<string, CriticalWindowEntry>();
const listeners = new Set<() => void>();

const emitChange = (): void => {
  listeners.forEach(listener => listener());
};

export const subscribeCriticalWindow = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const isCriticalWindowActive = (): boolean => activeWindows.size > 0;

export const useIsCriticalWindowActive = (): boolean =>
  useSyncExternalStore(subscribeCriticalWindow, isCriticalWindowActive, isCriticalWindowActive);

export const beginCriticalWindow = (
  tag: string,
  timeoutMs: number = CRITICAL_WINDOW_TIMEOUT_MS,
): void => {
  const existing = activeWindows.get(tag);
  if (existing) clearTimeout(existing.timeout);

  const timeout = setTimeout(() => {
    activeWindows.delete(tag);
    emitChange();
  }, timeoutMs);

  activeWindows.set(tag, { timeout });
  emitChange();
};

export const endCriticalWindow = (tag: string): void => {
  const existing = activeWindows.get(tag);
  if (!existing) return;

  clearTimeout(existing.timeout);
  activeWindows.delete(tag);
  emitChange();
};

export const getChatCriticalWindowTag = (channelId: string): string => `chat:${channelId}`;
