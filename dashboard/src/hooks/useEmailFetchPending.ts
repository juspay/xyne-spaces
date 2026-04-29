import { useSyncExternalStore } from 'react';

// Tracks which channel IDs currently have an in-flight background fetch.
// Mutation completes the moment the worker enqueues the job (server returns 202),
// but the actual fetch keeps running on the worker — the spinner needs to stay
// up until the EMAIL_FETCH_COMPLETED/FAILED notification arrives.
class EmailFetchPendingStore {
  private pending = new Set<string>();
  private listeners = new Set<() => void>();

  has(channelId: string): boolean {
    return this.pending.has(channelId);
  }

  add(channelId: string): void {
    if (this.pending.has(channelId)) return;
    this.pending.add(channelId);
    this.notify();
  }

  remove(channelId: string): void {
    if (!this.pending.has(channelId)) return;
    this.pending.delete(channelId);
    this.notify();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private notify(): void {
    this.listeners.forEach(fn => fn());
  }
}

const store = new EmailFetchPendingStore();

export const emailFetchPendingActions = {
  markPending: (channelId: string): void => store.add(channelId),
  markDone: (channelId: string): void => store.remove(channelId),
};

const subscribe = (fn: () => void): (() => void) => store.subscribe(fn);

export function useEmailFetchPending(channelId: string | undefined): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (channelId ? store.has(channelId) : false),
    () => false,
  );
}
