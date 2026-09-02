import type { Editor } from '@tiptap/react';

export interface TriggerMatch {
  query: string;
  match: RegExpMatchArray;
  triggerStart: number;
  triggerEnd: number;
}

export interface EditorPosition {
  top: number;
  left: number;
  alignRight?: boolean;
}

export interface VirtualElement {
  getBoundingClientRect: () => {
    width: number;
    height: number;
    top: number;
    bottom: number;
    left: number;
    right: number;
    x: number;
    y: number;
    toJSON: () => Record<string, never>;
  };
}

export const getTextBeforeCursor = (editor: Editor): string => {
  const { from } = editor.state.selection;
  const textBefore = editor.state.doc.textBetween(0, from, '\n');
  return textBefore;
};

export const detectTrigger = (editor: Editor, pattern: RegExp): TriggerMatch | null => {
  const { from } = editor.state.selection;
  const textBefore = getTextBeforeCursor(editor);
  const match = textBefore.match(pattern);

  if (!match || match[1] === undefined) return null;

  return {
    query: match[1],
    match,
    triggerStart: from - match[0].length,
    triggerEnd: from,
  };
};

export const detectMentionTrigger = (editor: Editor): TriggerMatch | null => {
  const { from } = editor.state.selection;
  const textBefore = getTextBeforeCursor(editor);
  // Allow dot in query so firstName.lastName usernames work (e.g. @john. still shows dropdown)
  const mentionMatch = textBefore.match(/(?:^|[\s\u200B(])@([\w\s.-]*)$/);
  // Close mention box if:
  // 1. Space comes immediately after @ (e.g., "@ ")
  // 2. Two consecutive spaces are encountered anywhere after @ (e.g., "@john  ")
  if (textBefore.match(/@ $/) || textBefore.match(/@[\w\s.-]* {2}$/)) {
    return null;
  }

  if (!mentionMatch || mentionMatch[1] === undefined) return null;

  return {
    query: mentionMatch[1],
    match: mentionMatch,
    triggerStart: from - mentionMatch[0].length,
    triggerEnd: from,
  };
};

export const detectCommandTrigger = (editor: Editor): TriggerMatch | null => {
  return detectTrigger(editor, /(?:^|[\s\u200B])\/(\w*)$/);
};

export const detectChannelTrigger = (editor: Editor): TriggerMatch | null => {
  return detectTrigger(editor, /#([\w-]*)$/);
};

export const detectEmojiTrigger = (editor: Editor): TriggerMatch | null => {
  return detectTrigger(editor, /(?:^|[\s\u200B]):(\w{2,})$/);
};

/**
 * Detects `+query` in the email body for recipient autocomplete.
 * Requires at least one query character after `+` so bare `+` or `C++` do not open the picker.
 */
export const detectRecipientTrigger = (editor: Editor): TriggerMatch | null => {
  const { from } = editor.state.selection;
  const textBefore = getTextBeforeCursor(editor);
  const recipientMatch = textBefore.match(/(?:^|[\s\u200B])\+([\w][\w\s.@-]*)$/);

  if (textBefore.match(/\+ $/) || textBefore.match(/\+[\w\s.@-]* {2}$/)) {
    return null;
  }

  if (!recipientMatch || recipientMatch[1] === undefined) return null;

  return {
    query: recipientMatch[1],
    match: recipientMatch,
    triggerStart: from - recipientMatch[0].length,
    triggerEnd: from,
  };
};

/**
 * Detects `~query` before the cursor for the thread-file reference picker.
 * `~` is used because @, #, /, :, and + are already claimed by other selectors.
 * Mirrors detectMentionTrigger: closes on `~ ` or a double space.
 */
export const detectFileReferenceTrigger = (editor: Editor): TriggerMatch | null => {
  const { from } = editor.state.selection;
  const textBefore = getTextBeforeCursor(editor);
  const fileMatch = textBefore.match(/(?:^|[\s\u200B(])~([\w\s.-]*)$/);

  if (textBefore.match(/~ $/) || textBefore.match(/~[\w\s.-]* {2}$/)) {
    return null;
  }

  if (!fileMatch || fileMatch[1] === undefined) return null;

  return {
    query: fileMatch[1],
    match: fileMatch,
    triggerStart: from - fileMatch[0].length,
    triggerEnd: from,
  };
};

export const getAbsolutePosition = (editor: Editor, pos: number): EditorPosition | null => {
  const { view } = editor;
  const coords = view.coordsAtPos(pos);

  if (!coords) return null;

  return {
    top: coords.top,
    left: coords.left,
  };
};
export const getSmartPopoverPosition = (basePosition: EditorPosition): EditorPosition => {
  const popoverWidth = 320; // Default width (w-80 = 320px)
  const viewportWidth = window.innerWidth;
  const rightSpaceAvailable = viewportWidth - basePosition.left;

  // If there's not enough space on the right, align to the right
  const shouldAlignRight = rightSpaceAvailable < popoverWidth;

  return {
    ...basePosition,
    alignRight: shouldAlignRight,
  };
};

export const createVirtualAnchor = (editor: Editor, queryLength: number): VirtualElement | null => {
  const { from } = editor.state.selection;
  const { view } = editor;
  const coords = view.coordsAtPos(from - queryLength - 1);

  if (!coords) return null;

  return {
    getBoundingClientRect: () => ({
      width: 0,
      height: 0,
      top: coords.top,
      bottom: coords.bottom,
      left: coords.left,
      right: coords.left,
      x: coords.left,
      y: coords.top,
      toJSON: () => ({}),
    }),
  };
};
