import { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/** Key stamped into the router location state that marks an overlay's history entry. */
const OVERLAY_STATE_KEY = 'xyneOverlay';

interface HistoryBackedOverlayParams {
  /** Whether the overlay is currently open. */
  open: boolean;
  /** Closes the overlay. Called when the user pops our entry off the stack. */
  onClose: () => void;
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
 * Closing it any other way (Escape, click-outside, picking a row) pops that entry back
 * off, so the stack is left exactly as it was found.
 *
 * The one case we deliberately leave alone is closing *because* the overlay navigated
 * somewhere: the entry is then already buried under the destination, and popping would
 * undo the navigation. That leaves one same-url entry behind, so backing out of the
 * destination lands on the origin page (overlay closed) and takes one more back to leave.
 */
export function useHistoryBackedOverlay({
  open,
  onClose,
  id,
  enabled = true,
}: HistoryBackedOverlayParams): { markNavigating: () => void } {
  const location = useLocation();
  const navigate = useNavigate();

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // True once we've pushed for the current open stretch — distinguishes "the user just
  // opened it" from "the user popped our entry", which look identical from the state alone.
  const pushedRef = useRef(false);

  // Set by the overlay right before it closes itself *and* navigates. Without it the
  // close branch below can race the navigation — if this effect runs before the router
  // has committed the new location, the entry still looks current and we pop, undoing
  // the navigation and leaving the user exactly where they started.
  const navigatingRef = useRef(false);

  const isOverlayEntry =
    (location.state as Record<string, unknown> | null)?.[OVERLAY_STATE_KEY] === id;

  useEffect(() => {
    if (!enabled) {
      pushedRef.current = false;
      return;
    }

    if (open && !pushedRef.current) {
      pushedRef.current = true;
      navigatingRef.current = false;
      void navigate(`${location.pathname}${location.search}${location.hash}`, {
        state: { ...(location.state as Record<string, unknown> | null), [OVERLAY_STATE_KEY]: id },
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

    // Closed some other way. Pop our entry, unless the close came with a navigation
    // (then the marker is no longer the current entry and popping would undo it).
    if (!open && pushedRef.current) {
      pushedRef.current = false;
      const wasNavigating = navigatingRef.current;
      navigatingRef.current = false;
      if (wasNavigating || !isOverlayEntry) return;

      // Deferred by a task so any navigation started in the same handler has committed
      // first, then re-checked against live history — react-router keeps location state
      // under `usr`. Rows that close the palette *and* navigate (opening a channel, a
      // result, the results page) all pass through here; popping on top of their push
      // would silently undo it. If the shape ever changes the check just fails and we
      // skip the pop — a stale entry, never a cancelled navigation.
      const timer = setTimeout(() => {
        const live = window.history.state as { usr?: Record<string, unknown> } | null;
        if (live?.usr?.[OVERLAY_STATE_KEY] === id) void navigate(-1);
      }, 0);
      return () => clearTimeout(timer);
    }
    return undefined;
    // `location` is read for the push url only — re-running on every location change
    // would re-push while the overlay stays open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isOverlayEntry, enabled, id, navigate]);

  const markNavigating = useCallback((): void => {
    navigatingRef.current = true;
  }, []);

  return { markNavigating };
}
