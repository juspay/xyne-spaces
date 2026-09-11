import { Extension } from '@tiptap/core';
import type { EditorState } from '@tiptap/pm/state';
import type { LinkRange } from './canvasEmbedActions';
import { getPastedLink } from './canvasPastedLink';

/**
 * The keys the link menu offers, in the order the menu lists them.
 *
 * They fire while the caret is in the link, so the menu never has to be focused
 * to be used. None is a bare letter, so typing inside a link is untouched.
 * Tab and Shift-Tab nest a block, but BlockNote stands down while a toolbar is
 * open, which leaves them to us. Mod-K belongs to the app and Mod-Enter to the
 * composers; Mod-Shift-B/E/H/J/L/R/S are TipTap's, so O and U are what is left.
 */
export const LINK_SHORTCUTS = {
  edit: 'Shift-Tab',
  open: 'Mod-Shift-O',
  embed: 'Tab',
  remove: 'Mod-Shift-U',
} as const;

/** Row order in the menu, which is also the order of LINK_SHORTCUTS. */
export const LINK_MENU_ROWS = ['edit', 'open', 'embed', 'remove'] as const;

/** Asks the open link menu to run one of its rows. */
export const CANVAS_LINK_ACTION_EVENT = 'canvas:link-action';

/** The link the menu is currently offering actions for, if any. */
export function linkUnderMenu(state: EditorState): LinkRange | null {
  const pasted = getPastedLink(state);
  if (pasted) return pasted;

  const linkMark = state.schema.marks['link'];
  if (!linkMark) return null;

  const caret = state.selection.$from;
  const mark = caret.marks().find(candidate => candidate.type === linkMark);
  if (!mark) return null;
  const href = typeof mark.attrs['href'] === 'string' ? mark.attrs['href'] : null;
  if (!href) return null;

  // The mark's own span, which the caret sits somewhere inside.
  const parentStart = caret.start();
  let from = parentStart;
  let to = parentStart;
  caret.parent.forEach((node, offset) => {
    if (!node.isText || !mark.isInSet(node.marks)) return;
    const start = parentStart + offset;
    const end = start + node.nodeSize;
    if (caret.pos < start || caret.pos > end) return;
    from = start;
    to = end;
  });

  return to > from ? { url: href, from, to } : null;
}

/**
 * Runs the link menu's rows from the keyboard.
 *
 * A shortcut presses its row rather than repeating what the row does, so the two
 * cannot drift apart — and the row already handles the parts that are not a
 * simple edit, like the form the Edit row opens, or unlinking without the
 * autolinker immediately putting the link back.
 */
export const canvasLinkShortcutsExtension = Extension.create({
  name: 'canvasLinkShortcuts',
  // Ahead of BlockNote's own Tab handling, which would otherwise nest the block.
  priority: 1000,

  addKeyboardShortcuts() {
    const press = (row: number) => (): boolean => {
      const view = this.editor.view;
      if (!linkUnderMenu(view.state)) return false;
      view.dom.dispatchEvent(
        new CustomEvent(CANVAS_LINK_ACTION_EVENT, { bubbles: true, detail: { row } }),
      );
      return true;
    };

    return Object.fromEntries(
      LINK_MENU_ROWS.map((name, index) => [LINK_SHORTCUTS[name], press(index)]),
    );
  },
});
