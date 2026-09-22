import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { HoverActionsToolbar } from './HoverActionsToolbar';
import { hoveredMessage, messageInteractionModality } from '../ChatBubble/hoveredMessageRef';
import {
  getMessageHoverActions,
  subscribeMessageHoverActions,
} from './messageHoverActionsRegistry';
import { useMessageHoverShortcuts } from './useMessageHoverShortcuts';

interface MessageHoverToolbarProps {
  /** The positioned (position: relative) list container the overlay lives in. */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Message selected through Up/Down navigation in this list. */
  keyboardSelectedMessageId?: string | null;
}

interface ActiveRow {
  hoverKey: string;
  messageId: string;
  top: number;
}

/**
 * ONE shared hover toolbar for an entire message list (Slack pattern).
 *
 * A single delegated `pointerover` listener on the list container resolves the
 * hovered row via `closest('[data-message-id]')`, writes the module-level
 * `hoveredMessage` ref (consumed by keyboard-shortcut `when` predicates) and
 * positions this overlay over the row via translateY from the row's bounding
 * rect. Hovering therefore causes ZERO React renders of bubble rows — only
 * this one small component renders, once per row entered.
 *
 * Per-message capabilities/handlers are read at show time from
 * `messageHoverActionsRegistry`, where every ChatBubble keeps its current
 * action set registered. While the emoji picker or the overflow dropdown is
 * open the overlay is "pinned": it ignores pointerover/pointerleave/scroll
 * until the popover closes.
 */
export const MessageHoverToolbar: React.FC<MessageHoverToolbarProps> = ({
  containerRef,
  keyboardSelectedMessageId,
}) => {
  // Keyboard shortcuts for whichever message is hovered — registered once per
  // list here instead of once per mounted ChatBubble (~6 × ~40 effects saved).
  useMessageHoverShortcuts(containerRef, keyboardSelectedMessageId);

  const [activeRow, setActiveRow] = useState<ActiveRow | null>(null);
  const [isEmojiPickerOpen, setIsEmojiPickerOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // Mirrors for the DOM listeners (attached once) and post-close checks.
  const activeRowRef = useRef<ActiveRow | null>(null);
  activeRowRef.current = activeRow;
  const pinnedOpenRef = useRef(false);
  pinnedOpenRef.current = isEmojiPickerOpen || isDropdownOpen;

  // The overlay wrapper — pointerover events from inside it must never move
  // or clear the row highlight (the toolbar floats over/near rows).
  const overlayRef = useRef<HTMLDivElement | null>(null);

  // Last seen pointer coordinates, so a `pointermove` that reports the same
  // position (fired by scrolling, not by the user) is not mistaken for intent.
  const pointerPositionRef = useRef<{ x: number; y: number } | null>(null);

  // Imperative row-background highlight (single source of truth, no renders).
  // The previously highlighted [data-message-id] root keeps `data-hovered`
  // until a NEW row is entered or the toolbar hides — so in the gap between
  // messages (or over the toolbar itself) the bg stays in sync with the
  // toolbar, Slack-style. Rows style it via Tailwind `data-[hovered]:bg-...`.
  const highlightedRowRef = useRef<HTMLElement | null>(null);
  const setHighlightedRow = useCallback((row: HTMLElement | null): void => {
    const prev = highlightedRowRef.current;
    if (prev === row) return;
    prev?.removeAttribute('data-hovered');
    row?.setAttribute('data-hovered', 'true');
    highlightedRowRef.current = row;
  }, []);

  const keyboardHighlightedRowRef = useRef<HTMLElement | null>(null);
  const setKeyboardHighlightedRow = useCallback((row: HTMLElement | null): void => {
    const prev = keyboardHighlightedRowRef.current;
    if (prev === row) return;
    prev?.removeAttribute('data-keyboard-selected');
    row?.setAttribute('data-keyboard-selected', 'true');
    keyboardHighlightedRowRef.current = row;
  }, []);

  const findKeyboardSelectedRow = useCallback((): HTMLElement | null => {
    if (!keyboardSelectedMessageId) return null;
    return (
      containerRef.current?.querySelector<HTMLElement>(
        `[data-message-id="${CSS.escape(keyboardSelectedMessageId)}"]`,
      ) ?? null
    );
  }, [containerRef, keyboardSelectedMessageId]);

  // Pending delayed clear (scheduled when the pointer enters something that is
  // NOT a message row — date pills, gaps, empty list areas). ~200ms so that
  // brushing the few-px gap between rows or travelling row→toolbar never
  // flickers, while resting on a non-message area clears Slack-style.
  const pendingClearRef = useRef<number | null>(null);
  const cancelPendingClear = useCallback((): void => {
    if (pendingClearRef.current !== null) {
      window.clearTimeout(pendingClearRef.current);
      pendingClearRef.current = null;
    }
  }, []);

  /**
   * Parks the toolbar on the keyboard-selected row. The toolbar is the clearest
   * statement of which message the next shortcut hits, so while the keyboard
   * owns the shortcuts it must sit on the selected row rather than disappear.
   * Returns false when there is nothing to park on (no selection, or the row is
   * virtualized away), leaving the caller to hide as usual.
   */
  const showToolbarOnKeyboardSelection = useCallback((): boolean => {
    const container = containerRef.current;
    const row = findKeyboardSelectedRow();
    if (!container || !row) return false;
    const hoverKey = row.getAttribute('data-hover-key');
    const messageId = row.getAttribute('data-message-id');
    if (!hoverKey || !messageId) return false;

    const top = Math.round(row.getBoundingClientRect().top - container.getBoundingClientRect().top);
    const prev = activeRowRef.current;
    if (prev && prev.hoverKey === hoverKey && prev.top === top) return true;
    setActiveRow({ hoverKey, messageId, top });
    return true;
  }, [containerRef, findKeyboardSelectedRow]);

  const hide = useCallback((): void => {
    cancelPendingClear();
    hoveredMessage.current = null;
    setHighlightedRow(null);
    setKeyboardHighlightedRow(findKeyboardSelectedRow());
    // With the hover gone the shortcuts resolve to the keyboard selection, so
    // the toolbar follows them there rather than leaving the armed row bare.
    if (showToolbarOnKeyboardSelection()) return;
    if (activeRowRef.current !== null) setActiveRow(null);
  }, [
    cancelPendingClear,
    findKeyboardSelectedRow,
    setHighlightedRow,
    setKeyboardHighlightedRow,
    showToolbarOnKeyboardSelection,
  ]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const applyHover = (event: MouseEvent): void => {
      // While a picker/dropdown is pinned open, freeze the toolbar in place.
      if (pinnedOpenRef.current) return;
      if (!(event.target instanceof Element)) return;
      // Hovering the toolbar itself must not move/clear the highlight.
      if (overlayRef.current?.contains(event.target)) {
        cancelPendingClear();
        return;
      }
      const row = event.target.closest<HTMLElement>('[data-message-id]');
      if (!row || !container.contains(row)) {
        // Not a message (date pill, gap, empty area): clear after a short
        // delay instead of immediately, so row→row gaps and row→toolbar
        // travel don't flicker. Any row/toolbar pointerover cancels it.
        if (pendingClearRef.current === null && activeRowRef.current !== null) {
          pendingClearRef.current = window.setTimeout((): void => {
            pendingClearRef.current = null;
            if (!pinnedOpenRef.current) hide();
          }, 200);
        }
        return;
      }
      cancelPendingClear();
      const messageId = row.getAttribute('data-message-id');
      const hoverKey = row.getAttribute('data-hover-key');
      if (!messageId || !hoverKey) return;

      // The keyboard selection keeps its outline while the pointer is
      // elsewhere: it is only dropped when the selection itself is cleared.
      // The two treatments are distinct (hover tints, selection outlines), so
      // both can be on screen at once without reading as one thing.
      setHighlightedRow(row);
      const actions = getMessageHoverActions(hoverKey);
      hoveredMessage.current = {
        messageId,
        ...(actions?.conversationId !== undefined && { conversationId: actions.conversationId }),
      };

      const top = Math.round(
        row.getBoundingClientRect().top - container.getBoundingClientRect().top,
      );
      const prev = activeRowRef.current;
      if (prev && prev.hoverKey === hoverKey && prev.top === top) return;
      setActiveRow({ hoverKey, messageId, top });
    };

    /**
     * `pointerover` also fires when rows scroll under a stationary cursor, so
     * while the keyboard owns the shortcuts it is ignored; the next genuine
     * `pointermove` hands ownership back.
     */
    const handlePointerOver = (event: MouseEvent): void => {
      if (messageInteractionModality.current !== 'pointer') return;
      applyHover(event);
    };

    const handlePointerMove = (event: MouseEvent): void => {
      const previous = pointerPositionRef.current;
      if (previous && previous.x === event.clientX && previous.y === event.clientY) return;
      pointerPositionRef.current = { x: event.clientX, y: event.clientY };

      const wasKeyboard = messageInteractionModality.current === 'keyboard';
      messageInteractionModality.current = 'pointer';
      // Coming back from keyboard ownership the row under the cursor never got
      // a pointerover, so resolve it from this move instead.
      if (wasKeyboard) applyHover(event);
    };

    const handlePointerLeave = (): void => {
      if (pinnedOpenRef.current) return;
      hide();
    };

    const handleScroll = (): void => {
      if (pinnedOpenRef.current) return;
      hide();
    };

    container.addEventListener('pointerover', handlePointerOver);
    container.addEventListener('pointermove', handlePointerMove, { passive: true });
    container.addEventListener('pointerleave', handlePointerLeave);
    container.addEventListener('mouseover', handlePointerOver);
    container.addEventListener('mouseleave', handlePointerLeave);
    // The (Virtuoso) scroller lives inside the container — capture catches it.
    container.addEventListener('scroll', handleScroll, { capture: true, passive: true });
    return (): void => {
      cancelPendingClear();
      container.removeEventListener('pointerover', handlePointerOver);
      container.removeEventListener('pointermove', handlePointerMove);
      container.removeEventListener('pointerleave', handlePointerLeave);
      container.removeEventListener('mouseover', handlePointerOver);
      container.removeEventListener('mouseleave', handlePointerLeave);
      container.removeEventListener('scroll', handleScroll, { capture: true });
    };
  }, [cancelPendingClear, containerRef, hide, setHighlightedRow, setKeyboardHighlightedRow]);

  const activeHoverKey = activeRow?.hoverKey ?? null;
  const getSnapshot = useCallback(
    (): ReturnType<typeof getMessageHoverActions> =>
      activeHoverKey !== null ? getMessageHoverActions(activeHoverKey) : undefined,
    [activeHoverKey],
  );
  const actions = useSyncExternalStore(subscribeMessageHoverActions, getSnapshot);

  // Hovered row unmounted underneath us (virtualized away / deleted) — hide.
  useEffect(() => {
    if (activeHoverKey !== null && actions === undefined && !pinnedOpenRef.current) hide();
  }, [activeHoverKey, actions, hide]);

  // Keyboard navigation takes ownership from a stationary pointer. Moving the
  // pointer again restores normal hover precedence.
  useEffect(() => {
    if (!keyboardSelectedMessageId) {
      setKeyboardHighlightedRow(null);
      return;
    }
    cancelPendingClear();
    hoveredMessage.current = null;
    setHighlightedRow(null);
    setKeyboardHighlightedRow(findKeyboardSelectedRow());
    // The toolbar moves with the selection, so the armed row always carries it.
    if (!showToolbarOnKeyboardSelection()) {
      activeRowRef.current = null;
      setActiveRow(null);
    }
  }, [
    cancelPendingClear,
    findKeyboardSelectedRow,
    keyboardSelectedMessageId,
    setHighlightedRow,
    setKeyboardHighlightedRow,
    showToolbarOnKeyboardSelection,
  ]);

  // Keep keyboard selection attached as virtualized rows mount/unmount. Runs
  // regardless of any active hover: the outline belongs to the selection, so a
  // row remounting while the pointer is elsewhere must get it back.
  useEffect(() => {
    const sync = (): void => {
      setKeyboardHighlightedRow(findKeyboardSelectedRow());
      // A row that scrolled back into view takes its toolbar back with it,
      // unless the pointer is currently hovering something of its own.
      if (hoveredMessage.current === null) showToolbarOnKeyboardSelection();
    };
    sync();
    return subscribeMessageHoverActions(sync);
  }, [findKeyboardSelectedRow, setKeyboardHighlightedRow, showToolbarOnKeyboardSelection]);

  // On unmount, drop highlights from rows that still carry them.
  useEffect(
    (): (() => void) => (): void => {
      setHighlightedRow(null);
      setKeyboardHighlightedRow(null);
    },
    [setHighlightedRow, setKeyboardHighlightedRow],
  );

  if (!activeRow || !actions) return null;

  // After the pinned popover/dropdown closes, hide unless the pointer is
  // still over the list (in which case pointerover keeps driving the overlay).
  const scheduleHideIfPointerOutside = (): void => {
    window.setTimeout(() => {
      if (pinnedOpenRef.current) return;
      const container = containerRef.current;
      if (container?.matches(':hover')) return;
      hide();
    }, 0);
  };

  const handleEmojiPickerOpenChange = (open: boolean): void => {
    setIsEmojiPickerOpen(open);
    actions.onEmojiPickerOpenChange?.(open);
    if (!open && !isDropdownOpen) scheduleHideIfPointerOutside();
  };

  const handleDropdownOpenChange = (open: boolean): void => {
    setIsDropdownOpen(open);
    actions.onDropdownOpenChange?.(open);
    if (!open && !isEmojiPickerOpen) scheduleHideIfPointerOutside();
  };

  return (
    <div
      ref={overlayRef}
      className='absolute inset-x-0 top-0 z-50 h-0'
      style={{ transform: `translateY(${activeRow.top}px)` }}
    >
      <HoverActionsToolbar
        key={activeRow.hoverKey}
        isVisible
        {...actions}
        {...(actions.onEmojiPickerOpenChange && {
          onEmojiPickerOpenChange: handleEmojiPickerOpenChange,
        })}
        onDropdownOpenChange={handleDropdownOpenChange}
      />
    </div>
  );
};
