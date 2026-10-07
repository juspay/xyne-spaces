import { useEffect, useRef } from 'react';
import type { ListItem, ShownResults } from './engine/dialogue';

/**
 * What a page shows, for Xyne Buddy: the conversation open, a channel, a DM or a thread in one,
 * which "here" stands for, and the list of results on screen, which "the first one" picks from.
 * Pages set them while they show them, and clear them when they go; the assistant only reads them.
 */
export type ShownThread = { channelId: string; conversationId?: string };

export interface ShownList {
  key: string; // what the list is for: a new key is a new list
  kind: string; // what one item is, as Buddy says it: "message"
  total: number; // all there are; `items` are the ones on screen
  items: readonly ListItem[]; // in on-screen order, so "the third one" is the third shown
  ready: boolean; // the page's fetch for this key has finished
  open(id: string): void;
}

export type PublishedList = ShownList & { version: number };

let thread: ShownThread | null = null;
let list: { ref: { current: ShownList | null }; version: number } | null = null;
// Raised for each new list, so a run can tell the list it asked for from an older one.
let versions = 0;
const listeners = new Set<() => void>();
const notify = (): void => listeners.forEach(listener => listener());
// Told each time a page opens a conversation, and each time a list leaves the screen.
const openings = new Set<() => void>();
const departures = new Set<() => void>();
const subscribe =
  (to: Set<() => void>) =>
  (listener: () => void): (() => void) => {
    to.add(listener);
    return (): void => {
      to.delete(listener);
    };
  };

const current = (): PublishedList | null => {
  const shown = list?.ref.current;
  return list && shown ? { ...shown, version: list.version } : null;
};

export const snapshotOf = ({ kind, total, items, version }: PublishedList): ShownResults => ({
  kind,
  total,
  items: [...items],
  version,
});

export const onScreen = {
  thread: {
    get: (): ShownThread | null => thread,
    set: (shown: ShownThread | null): void => {
      thread = shown;
      if (shown) openings.forEach(listener => listener());
    },
    onOpen: subscribe(openings),
  },
  list: {
    get: current,
    // Puts the list `source` holds on screen, until the function returned takes it off.
    show(source: { current: ShownList | null }): () => void {
      versions += 1;
      const entry = { ref: source, version: versions };
      list = entry;
      notify();
      return (): void => {
        if (list !== entry) return;
        list = null;
        notify();
        // A new search on the same page puts its list up in the same commit: only a list still
        // gone after it has left the screen.
        queueMicrotask(() => {
          if (!list) departures.forEach(listener => listener());
        });
      };
    },
    onGone: subscribe(departures),
    // The newest version so far, to wait for a list newer than it.
    version: (): number => versions,
    /**
     * The first ready list newer than `after`; null when none is ready in time. With `kept`, also
     * the list that was newest at `after` once ready, if after `kept.ms` the page still shows it
     * under `kept.key`: the same search again keeps its list, and no newer one ever comes.
     */
    waitFor(
      after: number,
      ms: number,
      kept?: { key: string; ms: number },
    ): Promise<PublishedList | null> {
      return new Promise(resolve => {
        let settled = false;
        const found = (): PublishedList | null => {
          const shown = current();
          const same = settled && shown?.version === after && shown.key === kept?.key;
          return shown?.ready && (shown.version > after || same) ? shown : null;
        };
        const check = (): void => {
          const shown = found();
          if (!shown) return;
          clearTimeout(timer);
          clearTimeout(settling);
          listeners.delete(check);
          resolve(shown);
        };
        listeners.add(check);
        const timer = setTimeout(() => {
          clearTimeout(settling);
          listeners.delete(check);
          resolve(null);
        }, ms);
        const settling = kept
          ? setTimeout(() => {
              settled = true;
              check();
            }, kept.ms)
          : undefined;
        check();
      });
    },
  },
};

/** Shows this list to the assistant while mounted; it always sees the latest render. */
export function useOnScreenList(shown: ShownList | null): void {
  const ref = useRef(shown);
  ref.current = shown;
  const key = shown?.key;
  useEffect(() => (key === undefined ? undefined : onScreen.list.show(ref)), [key]);
  // A list becomes ready without a new key: a run waiting for it is told.
  const ready = shown?.ready;
  useEffect(() => {
    if (ready) notify();
  }, [ready]);
}

/** Shows this conversation as the one open while mounted: what "here" is to the assistant. */
export function useOnScreenThread(channelId: string | undefined, conversationId?: string): void {
  useEffect(() => {
    if (!channelId) return undefined;
    const shown: ShownThread = { channelId, ...(conversationId && { conversationId }) };
    onScreen.thread.set(shown);
    return (): void => {
      // Another page may have opened its own since.
      if (thread === shown) onScreen.thread.set(null);
    };
  }, [channelId, conversationId]);
}
