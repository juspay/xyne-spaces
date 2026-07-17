import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';

/**
 * A single formatting shortcut definition.
 *
 * `run` is the single source of truth for the command: it is invoked both by
 * the keyboard binding (via {@link FormattingShortcutsExtension}) and by toolbar
 * buttons, so the keybinding and the button can never drift apart.
 */
export interface FormattingShortcut {
  /** Stable id used to look the shortcut up from toolbars, e.g. 'clearFormatting'. */
  id: string;
  /** Human-readable name for tooltips / aria labels, e.g. 'Clear Formatting'. */
  label: string;
  /** Display hint for tooltips, e.g. '⌘⇧C'. Presentation only. */
  shortcutHint: string;
  /**
   * TipTap key specs bound to this shortcut, e.g. ['Mod-Shift-c'].
   * `Mod` maps to ⌘ on macOS and Ctrl elsewhere — TipTap normalises this.
   */
  keys: string[];
  /** Runs the command. Returns whether the command was handled. */
  run: (editor: Editor) => boolean;
}

/**
 * The shared formatting shortcuts used by every rich-text composer
 * (channel composer + email composer). Add a new shortcut here once and every
 * editor that mounts {@link FormattingShortcutsExtension} picks it up.
 */
export const FORMATTING_SHORTCUTS: FormattingShortcut[] = [
  {
    id: 'inlineCode',
    label: 'Inline Code',
    shortcutHint: '⌘⇧C',
    keys: ['Mod-Shift-c'],
    run: editor => editor.chain().focus().toggleCode().run(),
  },
  {
    id: 'strike',
    label: 'Strikethrough',
    shortcutHint: '⌘⇧X',
    keys: ['Mod-Shift-x'],
    run: editor => editor.chain().focus().toggleStrike().run(),
  },
  {
    id: 'clearFormatting',
    label: 'Clear Formatting',
    shortcutHint: '⌘\\',
    keys: ['Mod-\\'],
    run: editor => editor.chain().focus().clearNodes().unsetAllMarks().run(),
  },
];

/** Look a shortcut up by id so toolbars reuse the exact same command. */
export const getFormattingShortcut = (id: string): FormattingShortcut | undefined =>
  FORMATTING_SHORTCUTS.find(shortcut => shortcut.id === id);

export interface FormattingShortcutsOptions {
  /** Shortcuts to register. Defaults to {@link FORMATTING_SHORTCUTS}. */
  shortcuts: FormattingShortcut[];
}

/**
 * Registers formatting shortcuts through TipTap's native keymap. Precedence and
 * conflict resolution are handled by ProseMirror's keymap rather than a manual
 * `handleKeyDown` if-ladder. App-level shortcuts that depend on React state
 * (Enter-to-send, Escape, mention/command menus, the ⌘⇧V plain-paste flag) stay
 * in the editor's `handleKeyDown`.
 */
export const FormattingShortcutsExtension = Extension.create<FormattingShortcutsOptions>({
  name: 'formattingShortcuts',

  addOptions() {
    return {
      shortcuts: FORMATTING_SHORTCUTS,
    };
  },

  addKeyboardShortcuts() {
    const handlers: Record<string, (props: { editor: Editor }) => boolean> = {};
    for (const shortcut of this.options.shortcuts) {
      const handler = ({ editor }: { editor: Editor }): boolean => shortcut.run(editor);
      for (const key of shortcut.keys) {
        handlers[key] = handler;
      }
    }
    return handlers;
  },
});
