export { ShortcutsProvider } from '../providers/ShortcutsProvider';
export { useShortcut, useScope, useShortcutById } from './hooks';
export { shortcuts, getShortcut, getShortcutsByCategory, findConflicts } from './catalog';
export { invokeShortcut } from './shortcutsRegistry';
export { formatShortcut } from './formatShortcut';
export type { ShortcutConfig, ShortcutRegistration, ShortcutScope } from './shortcutsRegistry';
export type { ShortcutDefinition, ShortcutId } from './catalog';
