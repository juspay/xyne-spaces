import { useEffect, useRef } from 'react';
import { useShortcutById } from '../../../shortcuts';
import type { ShortcutId } from '../../../shortcuts';
import { hoveredMessage } from '../ChatBubble/hoveredMessageRef';
import {
  getMessageHoverActionsByMessageId,
  type MessageHoverToolbarActions,
} from './messageHoverActionsRegistry';

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
export const useMessageHoverShortcuts = (): void => {
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
};
