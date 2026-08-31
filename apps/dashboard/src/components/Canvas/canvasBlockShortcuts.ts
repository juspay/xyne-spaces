import { formatKeyboardShortcut } from '@blocknote/core';
import type { DefaultReactSuggestionItem } from '@blocknote/react';
import { useEffect } from 'react';
import { editorView } from './canvasEditorView';

/**
 * A key for the blocks the slash menu left without one.
 *
 * Three families, each carrying on one BlockNote already uses, so a key says
 * something about the block rather than being the next number free:
 *
 *   Mod-Alt-Shift-N  inserted blocks, numbered down the menu. 1 to 3 are the
 *                    toggle headings, mirroring Mod-Alt-1 to 3 for the headings
 *                    themselves; 4 to 7 are the Media group in its own order.
 *   Mod-Shift-N      joins the list blocks, which hold 6 to 9, at the free end.
 *   Mod-Alt-<letter> joins Mod-Alt-C for code and Mod-Alt-Q for quote: a block
 *                    with a name rather than a place in a series.
 *
 * What is missing from all three is deliberate. Mod-Shift-3 to 5 are the system
 * screenshots, Mod-Alt-D, M and W the Dock, Minimise All and Safari's close-other
 * -tabs, Mod-Alt-I, J and C the browser's developer tools, and Mod-Alt with an
 * arrow moves between its tabs. Mod-Ctrl is clear on a Mac but cannot be spelled
 * on Windows, where Mod is already Ctrl.
 */
export const BLOCK_SHORTCUTS: Readonly<Record<string, string>> = {
  // Basic blocks read as their initial, next to BlockNote's own Q and C. The
  // lists answer to Mod-Shift-6 to 9 as well; the letter is what gets shown,
  // being the one worth remembering.
  Quote: 'Mod-Alt-Q',
  'Bullet List': 'Mod-Alt-B',
  'Numbered List': 'Mod-Alt-L',
  'Check List': 'Mod-Alt-K',
  'Toggle List': 'Mod-Alt-H',
  Divider: 'Mod-Alt-R',

  'Toggle Heading 1': 'Mod-Alt-Shift-1',
  'Toggle Heading 2': 'Mod-Alt-Shift-2',
  'Toggle Heading 3': 'Mod-Alt-Shift-3',

  Image: 'Mod-Alt-Shift-4',
  Video: 'Mod-Alt-Shift-5',
  Audio: 'Mod-Alt-Shift-6',
  File: 'Mod-Alt-Shift-7',

  Diagram: 'Mod-Alt-Shift-8',
  Whiteboard: 'Mod-Alt-Shift-9',

  'Block Equation': 'Mod-Shift-1',
  'Inline Equation': 'Mod-Shift-2',

  Table: 'Mod-Alt-T',
  Emoji: 'Mod-Alt-E',
};

/** BlockNote binds these itself; we only show them. */
const ALREADY_BOUND = new Set(['Quote']);

/**
 * Whether an event is the given shortcut.
 *
 * Matched on `code` rather than `key`: Alt rewrites the character a key produces
 * on macOS, so Mod-Alt-T arrives as `†`.
 */
function matches(event: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.split('-');
  const key = parts[parts.length - 1] ?? '';

  if (parts.includes('Mod') !== (event.metaKey || event.ctrlKey)) return false;
  if (parts.includes('Alt') !== event.altKey) return false;
  if (parts.includes('Shift') !== event.shiftKey) return false;

  return event.code === (/^\d$/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`);
}

/** The slash menu items, each showing the key that reaches it. */
export function withBlockShortcutBadges(
  items: DefaultReactSuggestionItem[],
): DefaultReactSuggestionItem[] {
  return items.map(item => {
    const shortcut = BLOCK_SHORTCUTS[item.title];
    return shortcut ? { ...item, badge: formatKeyboardShortcut(shortcut) } : item;
  });
}

/**
 * Binds those keys to the slash menu items themselves.
 *
 * A key runs the item's own handler rather than repeating what it does, so the
 * two cannot drift apart — and inserting a file, image, video or audio block goes
 * on to open the file picker exactly as picking it from the menu would.
 */
export function useCanvasBlockShortcuts(
  editor: unknown,
  items: DefaultReactSuggestionItem[],
): void {
  useEffect(() => {
    const dom = editorView(editor)?.dom;
    if (!dom || items.length === 0) return undefined;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.metaKey && !event.ctrlKey) return;

      const item = items.find(candidate => {
        const shortcut = BLOCK_SHORTCUTS[candidate.title];
        return shortcut && !ALREADY_BOUND.has(candidate.title) && matches(event, shortcut);
      });
      if (!item) return;

      event.preventDefault();
      event.stopPropagation();
      item.onItemClick?.();
    };

    dom.addEventListener('keydown', onKeyDown, true);
    return () => dom.removeEventListener('keydown', onKeyDown, true);
  }, [editor, items]);
}
