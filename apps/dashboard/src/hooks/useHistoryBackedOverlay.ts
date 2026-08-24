import { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/** Key stamped into the router location state that marks an overlay's history entry. */
const OVERLAY_STATE_KEY = 'xyneOverlay';
/** Key holding whatever the overlay wants handed back when the user returns to its entry. */
const OVERLAY_PAYLOAD_KEY = 'xyneOverlayPayload';

interface HistoryBackedOverlayParams<TPayload> {
  /** Whether the overlay is currently open. */
  open: boolean;
  /** Closes the overlay. Called when the user pops our entry off the stack. */
  onClose: () => void;
  /**
   * Reopens the overlay when the user comes BACK to its entry from somewhere the overlay
   * navigated to, handing back the payload passed to `markNavigating`.
   */
  onRestore?: (payload: TPayload | undefined) => void;
  /** Identifies this overlay in the location state, so nested overlays don't cross-close. */
  id: string;
  /** Set false for embedded/inline usages that are never really "open". */
  enabled?: boolean;
}

/**
 * Puts an overlay's open state on the history stack.
 *
 * Opening pushes an entry for the SAME url carrying a marker in the router's location
 * state, so the top-bar back arrow — and the browser/trackpad back gesture, which reach
 * this through the same router pop — close the overlay instead of leaving the page.
 * Closing it any other way (Escape, click-outside) pops that entry back off, so the stack
 * is left exactly as it was found.
 *
 * When the overlay closes *because it navigated somewhere*, it calls `markNavigating` with
 * whatever it needs to come back to. That stamps the payload onto its entry, which the
 * destination is then pushed on top of — so pressing back from the destination lands on the
 * marked entry and reopens the overlay in the state the user left it in, rather than
 * dumping them on a bare page.
 */
export function useHistoryBackedOverlay<TPayload = unknown>({
  open,
  onClose,
  onRestore,
  id,
  enabled = true,
}: HistoryBackedOverlayParams<TPayload>): {
  markNavigating: () => void;
  setPayload: (payload: TPayload) => void;
} {
  const location = useLocation();
  const navigate = useNavigate();

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;

  // True once we've pushed (or adopted) an entry for the current open stretch —
  // distinguishes "the user just opened it" from "the user popped our entry", which look
  // identical from the location state alone.
  const pushedRef = useRef(false);

  // Set by the overlay right before it closes itself *and* navigates. Without it the
  // close branch below can race the navigation — if this effect runs before the router
  // has committed the new location, the entry still looks current and we pop, undoing
  // the navigation and leaving the user exactly where they started.
  const navigatingRef = useRef(false);

  // True when this open stretch came from a restore, i.e. we adopted an entry we never
  // pushed. Closing then must NOT pop it: the user navigated back INTO this entry, and
  // popping would throw them a step further back than they asked for.
  const adoptedRef = useRef(false);

  // The entry we last restored, so closing the overlay doesn't immediately re-restore it.
  const restoredKeyRef = useRef<string | null>(null);

  // True between scheduling a pop and it landing. Without it the restore branch fires in
  // that gap — the overlay is closed and still standing on its own entry — and springs
  // the overlay straight back open.
  const poppingRef = useRef(false);

  const state = location.state as Record<string, unknown> | null;
  const isOverlayEntry = state?.[OVERLAY_STATE_KEY] === id;
  const payload = state?.[OVERLAY_PAYLOAD_KEY] as TPayload | undefined;

  // Read inside callbacks that run outside render, where `location` would be stale.
  const hrefRef = useRef('');
  hrefRef.current = `${location.pathname}${location.search}${location.hash}`;
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (!enabled) {
      pushedRef.current = false;
      return;
    }

    // Standing anywhere but our entry ends the "already restored this one" guard below.
    // That guard only exists to stop a close-in-place from immediately re-restoring, and
    // react-router hands an entry the SAME `location.key` every time it is popped back to
    // — so without this reset the guard never lifts and an entry can be restored exactly
    // once per session. Leaving the entry is what makes the next return a fresh visit.
    if (!isOverlayEntry) restoredKeyRef.current = null;

    if (open && !pushedRef.current) {
      pushedRef.current = true;
      navigatingRef.current = false;
      // Already standing on our entry (a restore) — adopt it instead of stacking another.
      if (isOverlayEntry) {
        adoptedRef.current = true;
        return;
      }
      adoptedRef.current = false;
      void navigate(hrefRef.current, {
        state: { ...state, [OVERLAY_STATE_KEY]: id },
        preventScrollReset: true,
      });
      return;
    }

    // Our entry is gone while the overlay is still open — the user went back. Skipped
    // while navigating away, where the same shape means "the destination just landed".
    if (open && pushedRef.current && !isOverlayEntry && !navigatingRef.current) {
      pushedRef.current = false;
      onCloseRef.current();
      return;
    }

    // Back onto our entry with the overlay closed: the user returned from wherever the
    // overlay sent them. Reopen it with what they left behind.
    //
    // Gated on the payload, which only `markNavigating` writes. A bare marker means the
    // overlay was merely open here — restoring on that would fight every ordinary close,
    // reopening the overlay in the gap before its entry is popped.
    if (
      !open &&
      !pushedRef.current &&
      !poppingRef.current &&
      isOverlayEntry &&
      payload !== undefined &&
      restoredKeyRef.current !== location.key &&
      onRestoreRef.current
    ) {
      restoredKeyRef.current = location.key;
      onRestoreRef.current(payload);
      return;
    }

    // Closed some other way. Pop our entry, unless the close came with a navigation
    // (then the marker is no longer the current entry and popping would undo it).
    if (!open && pushedRef.current) {
      pushedRef.current = false;
      const wasNavigating = navigatingRef.current;
      const wasAdopted = adoptedRef.current;
      navigatingRef.current = false;
      adoptedRef.current = false;
      if (wasNavigating || wasAdopted || !isOverlayEntry) return;

      // Deferred by a task so any navigation started in the same handler has committed
      // first, then re-checked against live history — react-router keeps location state
      // under `usr`. Rows that close the palette *and* navigate (a channel, a result, the
      // results page) all pass through here; popping on top of their push would silently
      // undo it. If the shape ever changes the check just fails and we skip the pop — a
      // stale entry, never a cancelled navigation.
      poppingRef.current = true;
      const timer = setTimeout(() => {
        const live = window.history.state as { usr?: Record<string, unknown> } | null;
        if (live?.usr?.[OVERLAY_STATE_KEY] === id) void navigate(-1);
        poppingRef.current = false;
      }, 0);
      return () => {
        clearTimeout(timer);
        poppingRef.current = false;
      };
    }
    return undefined;
    // `location` is read for the push url only — re-running on every location change
    // would re-push while the overlay stays open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isOverlayEntry, enabled, id, navigate]);

  const markNavigating = useCallback((): void => {
    navigatingRef.current = true;
  }, []);

  /**
   * Keeps the overlay's own history entry up to date with whatever should be handed back
   * if the user ever returns to it. Call it as the state changes — the overlay can be left
   * in a hundred ways (a result, a channel, a DM, the results page, an external link), and
   * only the entry itself is guaranteed to still be there afterwards.
   *
   * Written straight to `window.history` rather than through the router: this is the
   * current entry, the url is unchanged, and a router replace would re-render the tree on
   * every keystroke. React Router reads `usr` back out on a pop, so a restore still sees it.
   */
  const setPayload = useCallback(
    (nextPayload: TPayload): void => {
      const live = window.history.state as {
        usr?: Record<string, unknown> | null;
        key?: string;
        idx?: number;
      } | null;
      if (live?.usr?.[OVERLAY_STATE_KEY] !== id) return;
      window.history.replaceState(
        { ...live, usr: { ...live.usr, [OVERLAY_PAYLOAD_KEY]: nextPayload } },
        '',
      );
    },
    [id],
  );

  return { markNavigating, setPayload };
}
