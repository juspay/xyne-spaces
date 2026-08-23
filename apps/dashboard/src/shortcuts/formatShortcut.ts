/**
 * Render a registered key combination for display, e.g. 'mod+shift+a' becomes
 * '⌘⇧A' on macOS and 'Ctrl Shift A' elsewhere.
 *
 * Shared so the shortcuts modal, tooltips and menus can never drift apart.
 */
export const formatShortcut = (key: string, isMac: boolean): string => {
  return key
    .replace('mod+', isMac ? '⌘' : 'Ctrl+')
    .replace('shift+', isMac ? '⇧' : 'Shift+')
    .replace('alt+', isMac ? '⌥' : 'Alt+')
    .replace('ctrl+', isMac ? '⌃' : 'Ctrl+')
    .split('+')
    .map(k => k.trim())
    .map(k => k.replace(/[a-z]/i, c => c.toUpperCase()))
    .join(' ');
};
