import type { HoverActionsToolbarProps } from './HoverActionsToolbar';

/**
 * Everything the shared hover toolbar overlay needs in order to render the
 * action set for one message — exactly the props ChatBubble used to pass to
 * its per-row HoverActionsToolbar — plus the capability flags/handlers the
 * centralized hover keyboard shortcuts (useMessageHoverShortcuts) need to
 * mirror the per-bubble `enabled:` expressions they replaced.
 */
export type MessageHoverToolbarActions = Omit<HoverActionsToolbarProps, 'isVisible'> & {
  /** Mirrors ChatBubble's `isMessageEditable` check (edit/delete shortcuts). */
  canEditMessage: boolean;
  /** Deleted messages disable pin/bookmark/copy-content shortcuts. */
  isMessageDeleted: boolean;
  /** Copies the raw message content (mod+shift+c shortcut). */
  onCopyContent?: () => void;
};

/**
 * Per-message action registry for the shared hover toolbar (Slack pattern).
 *
 * Each mounted ChatBubble keeps its current capabilities/handlers registered
 * under a unique per-instance hover key (also stamped on the bubble's root DOM
 * node as `data-hover-key`). The single MessageHoverToolbar overlay looks the
 * entry up at show time, so hovering a row never re-renders the row itself.
 *
 * Keys are per React instance (useId), not per messageId, because the same
 * message can be mounted twice at once (channel row + open thread root).
 */
const registry = new Map<string, MessageHoverToolbarActions>();
const listeners = new Set<() => void>();

const emit = (): void => {
  for (const listener of listeners) listener();
};

export const registerMessageHoverActions = (
  hoverKey: string,
  actions: MessageHoverToolbarActions,
): void => {
  registry.set(hoverKey, actions);
  emit();
};

export const unregisterMessageHoverActions = (hoverKey: string): void => {
  if (registry.delete(hoverKey)) emit();
};

export const getMessageHoverActions = (hoverKey: string): MessageHoverToolbarActions | undefined =>
  registry.get(hoverKey);

/**
 * Resolve the action entry for a message by messageId (used by the
 * centralized hover keyboard shortcuts, which only know the hovered
 * messageId). The same message can be registered more than once (channel row +
 * open thread root), so when multiple entries match, prefer the one whose row
 * is currently stamped `data-hovered` by the shared toolbar; otherwise fall
 * back to the first match.
 */
export const getMessageHoverActionsByMessageId = (
  messageId: string,
): MessageHoverToolbarActions | undefined => {
  const matches: Array<{ hoverKey: string; actions: MessageHoverToolbarActions }> = [];
  for (const [hoverKey, actions] of registry) {
    if (actions.messageId === messageId) matches.push({ hoverKey, actions });
  }
  if (matches.length <= 1) return matches[0]?.actions;
  for (const { hoverKey, actions } of matches) {
    // Hover keys come from useId — safe inside a quoted attribute selector.
    if (document.querySelector(`[data-hovered][data-hover-key="${CSS.escape(hoverKey)}"]`)) {
      return actions;
    }
  }
  return matches[0]?.actions;
};

/** Subscribe to registry changes (useSyncExternalStore-compatible). */
export const subscribeMessageHoverActions = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
