import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { HoverActionsToolbar } from './HoverActionsToolbar';
import { hoveredMessage } from '../ChatBubble/hoveredMessageRef';
import {
  getMessageHoverActions,
  subscribeMessageHoverActions,
} from './messageHoverActionsRegistry';
import { useMessageHoverShortcuts } from './useMessageHoverShortcuts';

interface MessageHoverToolbarProps {
  /** The positioned (position: relative) list container the overlay lives in. */
  containerRef: React.RefObject<HTMLElement | null>;
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
export const MessageHoverToolbar: React.FC<MessageHoverToolbarProps> = ({ containerRef }) => {
  // Keyboard shortcuts for whichever message is hovered — registered once per
  // list here instead of once per mounted ChatBubble (~6 × ~40 effects saved).
  useMessageHoverShortcuts();

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

  const hide = useCallback((): void => {
    cancelPendingClear();
    hoveredMessage.current = null;
    setHighlightedRow(null);
    if (activeRowRef.current !== null) setActiveRow(null);
  }, [cancelPendingClear, setHighlightedRow]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // The container's viewport rect only shifts on scroll/resize/layout, not
    // per hovered row. Reading it on every pointerover forced a second
    // synchronous layout flush per event; cache it and recompute lazily after
    // a scroll/resize instead.
    let containerTop = 0;
    let containerTopDirty = true;
    const markContainerDirty = (): void => {
      containerTopDirty = true;
    };

    const handlePointerOver = (event: MouseEvent): void => {
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

      // Read layout geometry BEFORE stamping data-hovered so this
      // getBoundingClientRect read does not flush the style invalidation we are
      // about to create. The container rect is cached across rows.
      if (containerTopDirty) {
        containerTop = container.getBoundingClientRect().top;
        containerTopDirty = false;
      }
      const top = Math.round(row.getBoundingClientRect().top - containerTop);

      setHighlightedRow(row);
      const actions = getMessageHoverActions(hoverKey);
      hoveredMessage.current = {
        messageId,
        ...(actions?.conversationId !== undefined && { conversationId: actions.conversationId }),
      };

      const prev = activeRowRef.current;
      if (prev && prev.hoverKey === hoverKey && prev.top === top) return;
      setActiveRow({ hoverKey, messageId, top });
    };

    const handlePointerLeave = (): void => {
      if (pinnedOpenRef.current) return;
      hide();
    };

    const handleScroll = (): void => {
      markContainerDirty();
      if (pinnedOpenRef.current) return;
      hide();
    };

    container.addEventListener('pointerover', handlePointerOver);
    container.addEventListener('pointerleave', handlePointerLeave);
    container.addEventListener('mouseover', handlePointerOver);
    container.addEventListener('mouseleave', handlePointerLeave);
    // The (Virtuoso) scroller lives inside the container — capture catches it.
    container.addEventListener('scroll', handleScroll, { capture: true, passive: true });
    window.addEventListener('resize', markContainerDirty);
    return (): void => {
      cancelPendingClear();
      container.removeEventListener('pointerover', handlePointerOver);
      container.removeEventListener('pointerleave', handlePointerLeave);
      container.removeEventListener('mouseover', handlePointerOver);
      container.removeEventListener('mouseleave', handlePointerLeave);
      container.removeEventListener('scroll', handleScroll, { capture: true });
      window.removeEventListener('resize', markContainerDirty);
    };
  }, [cancelPendingClear, containerRef, hide, setHighlightedRow]);

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

  // On unmount, drop the highlight from whatever row still carries it.
  useEffect((): (() => void) => (): void => setHighlightedRow(null), [setHighlightedRow]);

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
