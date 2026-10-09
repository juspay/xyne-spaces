import { useCallback, useEffect, useRef, useState } from 'react';

/** Pages kept alive at once, the one on screen included; past it the longest unused go. */
const MAX_LIVE_PAGES = 4;
/** How long a page out of sight stays alive — frozen after its first minute — before
 *  it is let go, to load again when opened. */
const PARKED_LIFETIME_MS = 10 * 60 * 1000;

interface Kept {
  id: string;
  touched: number;
}

/**
 * Pages past the limit go, the longest unused first — never the one on screen, nor
 * one playing sound.
 */
function withinLimit(
  entries: Kept[],
  shownId: string | null,
  isPlaying: (id: string) => boolean,
): Kept[] {
  let excess = entries.length - MAX_LIVE_PAGES;
  if (excess <= 0) return entries;
  const going = new Set<string>();
  for (const entry of [...entries].sort((a, b) => a.touched - b.touched)) {
    if (excess <= 0) break;
    if (entry.id === shownId || isPlaying(entry.id)) continue;
    going.add(entry.id);
    excess -= 1;
  }
  return entries.filter(entry => !going.has(entry.id));
}

/**
 * How a browser keeps pages out of sight: the few shown lately, as Chrome does, or
 * every one open — for a browser something else works in too, as Xyne AI does in its
 * workspace's tabs, which it must find as it left them.
 */
export type KeepAlivePolicy = 'recent' | 'every';

/**
 * Which of a browser's pages stay alive: the one on screen, and the few shown
 * lately, out of sight — as Chrome keeps background tabs. Past four the longest
 * unused goes; one out of sight ten minutes goes; and when the desktop app says
 * memory is short, all out of sight go at once, as Chrome's Memory Saver does. A
 * page playing sound is never let go while it plays.
 *
 * With the `every` policy, every open page stays — opened behind or never shown
 * included — until its tab closes. Out of sight they are still frozen after a while.
 *
 * @param ids the pages there are; one closed is let go.
 * @param shownId the page on screen, if any.
 * @param isPlaying whether a page is playing sound now.
 * @param policy which to keep; `recent` unless said.
 * @returns the ids of the pages to keep mounted.
 */
export function useKeptAlive(
  ids: readonly string[],
  shownId: string | null,
  isPlaying: (id: string) => boolean,
  policy: KeepAlivePolicy = 'recent',
): ReadonlySet<string> {
  const [alive, setAlive] = useState<Kept[]>([]);
  const playingRef = useRef(isPlaying);
  playingRef.current = isPlaying;
  // Stable, and still asking the present check.
  const playing = useCallback((id: string): boolean => playingRef.current(id), []);

  const previouslyShown = useRef<string | null>(null);
  useEffect(() => {
    const now = Date.now();
    const left = previouslyShown.current;
    previouslyShown.current = shownId;
    setAlive(current => {
      const kept = current
        .filter(entry => entry.id !== shownId)
        .map(entry => (entry.id === left ? { ...entry, touched: now } : entry));
      const next = shownId ? [...kept, { id: shownId, touched: now }] : kept;
      return withinLimit(next, shownId, playing);
    });
  }, [shownId, playing]);

  const idsKey = ids.join('\n');
  useEffect(() => {
    const present = new Set(idsKey.split('\n'));
    setAlive(current => {
      const next = current.filter(entry => present.has(entry.id));
      return next.length === current.length ? current : next;
    });
  }, [idsKey]);

  useEffect(
    () =>
      window.electronAPI?.onBrowserMemoryPressure?.(() => {
        setAlive(current => current.filter(entry => entry.id === shownId || playing(entry.id)));
      }),
    [shownId, playing],
  );

  // A page out of sight long enough is let go: one timer, for the next to expire.
  useEffect(() => {
    const parked = alive.filter(entry => entry.id !== shownId);
    if (parked.length === 0) return undefined;
    const next = Math.min(...parked.map(entry => entry.touched)) + PARKED_LIFETIME_MS;
    const timer = window.setTimeout(
      () => {
        const now = Date.now();
        setAlive(current =>
          current.flatMap(entry => {
            if (entry.id === shownId || now - entry.touched < PARKED_LIFETIME_MS) return [entry];
            // Still playing: kept, and looked at again a lifetime from now.
            return playing(entry.id) ? [{ ...entry, touched: now }] : [];
          }),
        );
      },
      Math.max(0, next - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [alive, shownId, playing]);

  if (policy === 'every') return new Set([...ids, ...(shownId ? [shownId] : [])]);
  return new Set([...alive.map(entry => entry.id), ...(shownId ? [shownId] : [])]);
}
