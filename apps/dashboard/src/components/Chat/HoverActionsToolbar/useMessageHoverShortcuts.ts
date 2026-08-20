import { useEffect, useRef } from 'react';
import { useShortcutById } from '../../../shortcuts';
import type { ShortcutId } from '../../../shortcuts';
import { hoveredMessage } from '../ChatBubble/hoveredMessageRef';
import {
  getMessageHoverActionsByMessageId,
  type MessageHoverToolbarActions,
} from './messageHoverActionsRegistry';
import { navigateMessageFocus } from './messageKeyboardNav';

/**
 * Resolve the registry entry for the message currently under the pointer.
 * Returns undefined when nothing is hovered or the hovered row never
 * registered (mobile/pinned/search rows).
 */
const resolveHoveredEntry = (): MessageHoverToolbarActions | undefined => {
  const hovered = hoveredMessage.current;
  if (!hovered) return undefined;
  return getMessageHoverActionsByMessageId(hovered.messageId);
};

/**
 * Several MessageHoverToolbar instances can be mounted at once (channel list +
 * thread panel). Each registers the same shortcut set, so only the first
 * mounted instance "owns" them at keypress time — the others' `when`
 * predicates return false, keeping shortcut resolution unambiguous. Ownership
 * is checked lazily in `when`, so it transfers on unmount without any
 * re-registration.
 */
/**
 * Arrow navigation must not hijack the caret while the user is actually typing,
 * and must stay out of the command palette / dialogs / listboxes (which own
 * their own arrow handling). It IS allowed when focus is on the message list /
 * body, or in an EMPTY composer (Slack-style: ↑ from an empty field starts
 * walking messages).
 */
const isMessageNavContext = (): boolean => {
  const el = document.activeElement;
  if (el instanceof HTMLElement) {
    if (el.closest('[cmdk-root],[role="dialog"],[role="menu"],[role="listbox"]')) return false;
    if (el.isContentEditable) return (el.textContent ?? '').trim() === '';
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea') {
      return ((el as HTMLInputElement).value ?? '').trim() === '';
    }
  }
  return true;
};

const owners: symbol[] = [];

/** One catalog shortcut driven by the hovered message's registry entry. */
const useHoverShortcut = (
  id: ShortcutId,
  isOwner: () => boolean,
  canRun: (entry: MessageHoverToolbarActions) => boolean,
  run: (entry: MessageHoverToolbarActions) => void,
): void => {
  useShortcutById(
    id,
    () => {
      const entry = resolveHoveredEntry();
      if (entry && canRun(entry)) run(entry);
    },
    {
      // `enabled` stays true — gating lives in `when`, evaluated at keypress
      // time, so a disabled combo never preventDefaults the key event.
      when: () => {
        if (!isOwner()) return false;
        const entry = resolveHoveredEntry();
        return entry !== undefined && canRun(entry);
      },
    },
  );
};

/**
 * Centralized keyboard shortcuts for the message under the pointer.
 *
 * These used to be registered by EVERY mounted ChatBubble (~6 shortcuts × ~40
 * bubbles = ~240 effect setups per channel open). Now they are registered ONCE
 * per list by the shared MessageHoverToolbar: each handler reads the
 * module-level `hoveredMessage` ref at keypress time, resolves that message's
 * entry in the hover-actions registry, checks the relevant capability flag and
 * invokes the entry's handler.
 */
export const useMessageHoverShortcuts = (containerRef?: { current: HTMLElement | null }): void => {
  const instanceIdRef = useRef<symbol | null>(null);
  instanceIdRef.current ??= Symbol('messageHoverShortcuts');

  useEffect(() => {
    const id = instanceIdRef.current;
    if (id === null) return;
    owners.push(id);
    return (): void => {
      const index = owners.indexOf(id);
      if (index !== -1) owners.splice(index, 1);
    };
  }, []);

  const isOwner = (): boolean => owners[0] === instanceIdRef.current;

  // Arrow-key roving focus across the message list. Routed to the list that
  // actually holds the current selection; with no selection, only the primary
  // (first-mounted) list handles it. Gated by `isMessageNavContext` so it never
  // fires while typing or inside a dialog/command palette.
  const ownsArrowNav = (): boolean => {
    if (!isMessageNavContext()) return false;
    const container = containerRef?.current;
    const currentId = hoveredMessage.current?.messageId;
    if (currentId && container) {
      return container.querySelector(`[data-message-id="${CSS.escape(currentId)}"]`) !== null;
    }
    return !currentId && isOwner();
  };

  useShortcutById(
    'message.focusPrev',
    () => {
      const container = containerRef?.current;
      if (container) navigateMessageFocus(container, 'prev');
    },
    { when: ownsArrowNav },
  );

  useShortcutById(
    'message.focusNext',
    () => {
      const container = containerRef?.current;
      if (container) navigateMessageFocus(container, 'next');
    },
    { when: ownsArrowNav },
  );

  useHoverShortcut(
    'message.edit',
    isOwner,
    entry => entry.canEditMessage && entry.onEditMessage !== undefined,
    entry => entry.onEditMessage?.(),
  );

  useHoverShortcut(
    'message.delete',
    isOwner,
    entry => entry.canEditMessage && entry.onDeleteMessage !== undefined,
    entry => entry.onDeleteMessage?.(),
  );

  useHoverShortcut(
    'message.pin',
    isOwner,
    entry =>
      entry.conversation !== undefined &&
      !entry.isMessageDeleted &&
      entry.onPinMessage !== undefined,
    entry => entry.onPinMessage?.(),
  );

  useHoverShortcut(
    'message.bookmark',
    isOwner,
    entry => !entry.isMessageDeleted && entry.onBookmark !== undefined,
    entry => entry.onBookmark?.(),
  );

  useHoverShortcut(
    'message.copyLink',
    isOwner,
    entry => entry.onCopyLink !== undefined,
    entry => entry.onCopyLink?.(),
  );

  useHoverShortcut(
    'message.copyContent',
    isOwner,
    entry => !entry.isMessageDeleted && entry.onCopyContent !== undefined,
    entry => entry.onCopyContent?.(),
  );

  // Alt/Option + click on a message bubble marks it as unread.
  useEffect(() => {
    const handleClick = (e: MouseEvent): void => {
      if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const hovered = hoveredMessage.current;
      if (!hovered) return;
      const entry = getMessageHoverActionsByMessageId(hovered.messageId);
      if (!entry || entry.isMessageDeleted || entry.onMarkAsUnread === undefined) return;
      e.preventDefault();
      e.stopPropagation();
      entry.onMarkAsUnread();
    };
    document.addEventListener('click', handleClick, true);
    return (): void => document.removeEventListener('click', handleClick, true);
  }, []);
};
