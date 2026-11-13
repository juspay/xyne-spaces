/**
 * Save on its own, without writing on every keystroke.
 *
 * Three clocks, because two were not enough.
 *
 * - A **quiet period** waits for the author to stop, so a burst becomes one save.
 * - A **ceiling** forces a save anyway, so someone who never stops typing is
 *   still saved rather than never.
 * - A **floor** keeps two saves apart, whatever the editing looks like.
 *
 * The floor is the one that is easy to leave out and the only one that actually
 * bounds the request rate. Debounce alone caps nothing: edits arriving further
 * apart than the quiet period each get their own save, so a steady edit every
 * two seconds is a save every two seconds — measured at 30 a minute, each one a
 * whole config. The ceiling does not help, because it only engages when edits
 * come *faster* than the quiet period. With the floor the rate is capped at
 * 6 a minute however hard the editor is driven.
 *
 * That is the shape Notion, Linear and Confluence all settle on, and it suits
 * this editor especially well: text commits on blur rather than per keystroke,
 * so the natural edit rate is already a few changes a minute. The clocks are
 * there for the structural edits — adding options, moving screens — which can
 * arrive in quick succession.
 *
 * Three things it deliberately does NOT do:
 *
 * - **Retry a failed save.** A save that failed leaves the work dirty and the
 *   error on screen; autosave then stays quiet until something changes again.
 *   Retrying on a timer is how a failing backend gets hammered by every open tab.
 * - **Overlap saves.** One at a time; if the clock fires mid-save it re-arms.
 *   Out-of-order writes would make "saved" mean the wrong version.
 * - **Resolve conflicts.** Saving is last-write-wins, and autosave makes that
 *   race far more likely — two tabs on one workflow will now overwrite each
 *   other quietly. That is a known, accepted limitation, not an oversight.
 */
import { useEffect, useRef } from 'react';

/** How long to wait for the author to stop before saving. */
export const QUIET_MS = 2_000;
/** How long a continuous edit can hold a save off. */
export const CEILING_MS = 10_000;
/** The least time between two saves — what actually bounds the request rate. */
export const FLOOR_MS = 10_000;

export function useAutosave({
  dirty,
  saving,
  enabled,
  revision,
  save,
}: {
  /** Whether there is anything to save. */
  dirty: boolean;
  /** Whether a save is already in flight. */
  saving: boolean;
  /** Off for a read-only editor, or a host that saves its own way. */
  enabled: boolean;
  /**
   * Something that changes on every edit — the config itself will do.
   *
   * `dirty` alone cannot restart the quiet period: it is already true when the
   * second edit lands, so nothing re-runs and the first timer still decides.
   */
  revision: unknown;
  /** Resolves false when the save failed; the caller reports it. */
  save: () => Promise<boolean>;
}): void {
  // Read at fire time, so a timer armed one render ago still saves the latest.
  const latest = useRef(save);
  latest.current = save;

  // When the current run of unsaved changes began — the ceiling counts from here.
  const since = useRef<number | null>(null);
  // The edit that failed, so a failure stays quiet until the work moves on.
  const failedAt = useRef<string | null>(null);
  // When the last save went out, so the floor has something to measure from.
  const lastSaved = useRef(0);

  useEffect(() => {
    if (!enabled || !dirty) {
      since.current = null;
      return undefined;
    }
    if (saving) return undefined;

    const now = Date.now();
    since.current ??= now;
    // Wait for quiet, but no longer than the ceiling — and never sooner than the
    // floor, which outranks both: it is the only one that caps the rate.
    const debounced = Math.min(QUIET_MS, CEILING_MS - (now - since.current));
    const floor = FLOOR_MS - (now - lastSaved.current);
    const delay = Math.max(0, debounced, floor);

    const id = window.setTimeout(() => {
      void (async () => {
        const mark = String(since.current);
        if (failedAt.current === mark) return;
        // `save` reports its own failure; this only stops the clock, so a
        // backend that is down is not retried by every open tab on a timer.
        lastSaved.current = Date.now();
        if (await latest.current()) since.current = null;
        else failedAt.current = mark;
      })();
    }, delay);
    return () => { window.clearTimeout(id); };
    // `revision` restarts the quiet period on each edit; `saving` re-arms when a
    // save finishes, for whatever arrived while it was in flight.
  }, [revision, dirty, saving, enabled]);

  // Leaving the tab is the one moment worth not waiting for.
  useEffect(() => {
    if (!enabled) return undefined;
    const flush = () => {
      if (document.visibilityState === 'hidden' && dirty && !saving) void latest.current();
    };
    document.addEventListener('visibilitychange', flush);
    return () => { document.removeEventListener('visibilitychange', flush); };
  }, [dirty, saving, enabled]);
}
