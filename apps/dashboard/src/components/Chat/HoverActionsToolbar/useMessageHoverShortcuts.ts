import { type RefObject, useEffect, useRef } from 'react';
import { useShortcutById } from '../../../shortcuts';
import type { ShortcutId } from '../../../shortcuts';
import { hoveredMessage, messageInteractionModality } from '../ChatBubble/hoveredMessageRef';
import {
  getMessageHoverActions,
  getMessageHoverActionsByMessageId,
  type MessageHoverToolbarActions,
} from './messageHoverActionsRegistry';

/**
 * Resolve the registry entry for the message currently under the pointer.
 * Returns undefined when nothing is hovered or the hovered row never
 * registered (mobile/pinned/search rows).
 */
const resolveHoveredEntry = (): MessageHoverToolbarActions | undefined => {
  // Last input wins: a pointer the user has not moved since their last
  // keystroke does not own the shortcuts, however many rows have scrolled
  // underneath it.
  if (messageInteractionModality.current !== 'pointer') return undefined;
  const hovered = hoveredMessage.current;
  if (!hovered) return undefined;
  return getMessageHoverActionsByMessageId(hovered.messageId);
};

const resolveKeyboardSelectedEntry = (
  containerRef: RefObject<HTMLElement | null>,
  keyboardSelectedMessageId: string | null | undefined,
): MessageHoverToolbarActions | undefined => {
  if (!keyboardSelectedMessageId) return undefined;
  const row = containerRef.current?.querySelector<HTMLElement>(
    `[data-message-id="${CSS.escape(keyboardSelectedMessageId)}"]`,
  );
  const hoverKey = row?.getAttribute('data-hover-key');
  return hoverKey ? getMessageHoverActions(hoverKey) : undefined;
};

const resolveActiveEntry = (
  containerRef: RefObject<HTMLElement | null>,
  keyboardSelectedMessageId: string | null | undefined,
): MessageHoverToolbarActions | undefined =>
  resolveHoveredEntry() ?? resolveKeyboardSelectedEntry(containerRef, keyboardSelectedMessageId);

/**
 * Several MessageHoverToolbar instances can be mounted at once (channel list +
 * thread panel). Pointer-driven shortcuts keep the existing first-mounted
 * owner. When no pointer target exists, the list with a keyboard selection owns
 * the shortcut instead, so a selected row in a secondary panel still works.
 */
const owners: symbol[] = [];

/** One catalog shortcut driven by the hovered message's registry entry. */
const useHoverShortcut = (
  id: ShortcutId,
  isOwner: () => boolean,
  resolveEntry: () => MessageHoverToolbarActions | undefined,
  canRun: (entry: MessageHoverToolbarActions) => boolean,
  run: (entry: MessageHoverToolbarActions) => void,
): void => {
  useShortcutById(
    id,
    () => {
      const entry = resolveEntry();
      if (entry && canRun(entry)) run(entry);
    },
    {
      // `enabled` stays true — gating lives in `when`, evaluated at keypress
      // time, so a disabled combo never preventDefaults the key event.
      when: () => {
        if (!isOwner()) return false;
        const entry = resolveEntry();
        return entry !== undefined && canRun(entry);
      },
    },
  );
};

/**
 * Centralized keyboard shortcuts for the hovered or keyboard-selected message.
 *
 * These used to be registered by EVERY mounted ChatBubble (~6 shortcuts × ~40
 * bubbles = ~240 effect setups per channel open). Now they are registered ONCE
 * per list by the shared MessageHoverToolbar: each handler resolves the
 * pointer target first, then the keyboard-selected row in its own container,
 * checks the relevant capability flag, and invokes the entry's handler.
 */
export const useMessageHoverShortcuts = (
  containerRef: RefObject<HTMLElement | null>,
  keyboardSelectedMessageId?: string | null,
): void => {
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

  const isOwner = (): boolean => {
    // Mirrors resolveHoveredEntry: a hover that no longer owns the shortcuts
    // must not decide ownership either.
    const pointerOwns =
      messageInteractionModality.current === 'pointer' && hoveredMessage.current !== null;
    if (pointerOwns) return owners[0] === instanceIdRef.current;
    if (keyboardSelectedMessageId) return true;
    return owners[0] === instanceIdRef.current;
  };
  const resolveEntry = (): MessageHoverToolbarActions | undefined =>
    resolveActiveEntry(containerRef, keyboardSelectedMessageId);

  useHoverShortcut(
    'message.edit',
    isOwner,
    resolveEntry,
    entry => entry.canEditMessage && entry.onEditMessage !== undefined,
    entry => entry.onEditMessage?.(),
  );

  useHoverShortcut(
    'message.delete',
    isOwner,
    resolveEntry,
    entry => entry.canEditMessage && entry.onDeleteMessage !== undefined,
    entry => entry.onDeleteMessage?.(),
  );

  useHoverShortcut(
    'message.pin',
    isOwner,
    resolveEntry,
    entry =>
      entry.conversation !== undefined &&
      !entry.isMessageDeleted &&
      entry.onPinMessage !== undefined,
    entry => entry.onPinMessage?.(),
  );

  useHoverShortcut(
    'message.bookmark',
    isOwner,
    resolveEntry,
    entry => !entry.isMessageDeleted && entry.onBookmark !== undefined,
    entry => entry.onBookmark?.(),
  );

  useHoverShortcut(
    'message.copyLink',
    isOwner,
    resolveEntry,
    entry => entry.onCopyLink !== undefined,
    entry => entry.onCopyLink?.(),
  );

  useHoverShortcut(
    'message.copyContent',
    isOwner,
    resolveEntry,
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
