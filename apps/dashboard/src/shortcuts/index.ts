export { ShortcutsProvider } from '../providers/ShortcutsProvider';
export { useShortcut, useScope, useShortcutById, useResolvedShortcutCombo } from './hooks';
export {
  shortcuts,
  getShortcut,
  getShortcutsByCategory,
  findConflicts,
  scopesOverlap,
  findActionsForCombo,
} from './catalog';
export { invokeShortcut } from './shortcutsRegistry';
export type { ShortcutConfig, ShortcutRegistration, ShortcutScope } from './shortcutsRegistry';
export type { ShortcutDefinition, ShortcutId, ComboMatch } from './catalog';
export {
  getShortcutOverrides,
  setShortcutOverrides,
  subscribeShortcutOverrides,
  parseShortcutOverrides,
} from './overridesStore';
export type { ShortcutOverrideMap } from './overridesStore';
