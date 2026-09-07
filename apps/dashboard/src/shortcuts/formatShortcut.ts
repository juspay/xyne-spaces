const MODIFIER_SYMBOLS: Record<string, string> = {
  mod: '⌘',
  shift: '⇧',
  alt: '⌥',
  ctrl: '⌃',
};

const MODIFIER_WORDS: Record<string, string> = {
  mod: 'Ctrl',
  shift: 'Shift',
  alt: 'Alt',
  ctrl: 'Ctrl',
};

const KEY_LABELS: Record<string, string> = {
  comma: ',',
  equal: '=',
  add: '+',
  minus: '-',
  subtract: '-',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  esc: 'Esc',
  escape: 'Esc',
  space: 'Space',
  enter: '↵',
  delete: 'Del',
  backspace: '⌫',
};

/**
 * Render a registered key combination for display, e.g. 'mod+shift+a' becomes
 * '⌘⇧A' on macOS and 'Ctrl Shift A' elsewhere.
 *
 * Shared so the shortcuts modal, tooltips and menus can never drift apart.
 */
export const formatShortcut = (key: string, isMac: boolean): string => {
  const parts = key.split('+');
  const base = parts.pop() ?? '';
  const modifiers = parts.map(
    part => (isMac ? MODIFIER_SYMBOLS : MODIFIER_WORDS)[part.toLowerCase()] ?? part,
  );
  const label = KEY_LABELS[base.toLowerCase()] ?? base.replace(/[a-z]/i, c => c.toUpperCase());

  return isMac ? `${modifiers.join('')}${label}` : [...modifiers, label].join(' ');
};
