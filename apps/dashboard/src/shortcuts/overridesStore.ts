import type { ShortcutId } from './catalog';

/**
 * Per-user keyboard-shortcut overrides.
 *
 * This is a small module-level pub/sub store that mirrors the user's persisted
 * `user_preferences.keyboardShortcuts` value (a stringified JSON map). It is the
 * single source of truth the live shortcut registry reads from via
 * `useSyncExternalStore`, so a remap re-registers bindings immediately with no
 * reload.
 *
 * Data flow (unidirectional):
 *   Settings UI → setKeyboardShortcuts mutator → Zero → stateMachine
 *     → ShortcutsProvider sync effect → setShortcutOverrides() → registry
 *
 * The map is sparse: only remapped shortcuts appear. An entry mapped to an empty
 * array (`[]`) means the shortcut is intentionally unbound. A missing entry means
 * "use the catalog default".
 */
export type ShortcutOverrideMap = Partial<Record<ShortcutId, string[]>>;

let overrides: ShortcutOverrideMap = {};
const listeners = new Set<() => void>();

/** Stable snapshot getter for useSyncExternalStore. Identity only changes on set. */
export const getShortcutOverrides = (): ShortcutOverrideMap => overrides;

export const subscribeShortcutOverrides = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

export const setShortcutOverrides = (next: ShortcutOverrideMap): void => {
  overrides = next ?? {};
  listeners.forEach(listener => listener());
};

/**
 * Parse the persisted stringified JSON map into a validated override map.
 * Any malformed input degrades safely to `{}` (i.e. all catalog defaults).
 */
export const parseShortcutOverrides = (raw: string | null | undefined): ShortcutOverrideMap => {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: ShortcutOverrideMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
        out[key as ShortcutId] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
};
