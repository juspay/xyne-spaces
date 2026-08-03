import { useMemo } from 'react';
import { useSelector } from '@xstate/react';

import { useZero } from './useZero';
import { mutators } from '../zero/mutators';
import { stateMachineActor } from '../machines/stateMachine';
import { parseShortcutOverrides } from '../shortcuts/overridesStore';
import type { ShortcutOverrideMap } from '../shortcuts/overridesStore';
import type { ShortcutId } from '../shortcuts/catalog';

/**
 * Read/write hook for the user's keyboard-shortcut overrides, backed by
 * `user_preferences.keyboardShortcuts` (a stringified JSON map) via the
 * `userPreference.setKeyboardShortcuts` Zero mutator.
 *
 * The whole sparse map is persisted on every change — it is tiny and always read
 * as a unit — mirroring the existing single-column preference mutators. Writes
 * propagate through Zero → stateMachine → ShortcutsProvider, which is what makes
 * a remap take effect live and sync across the user's devices.
 */
export interface UseShortcutConfig {
  overrides: ShortcutOverrideMap;
  /** Set (or replace) the binding for a shortcut. Pass `[]` to unbind it. */
  setOverride: (id: ShortcutId, keys: string[]) => void;
  /** Remove the override so the shortcut falls back to its catalog default. */
  resetOverride: (id: ShortcutId) => void;
  /** Clear every override (restore all defaults). */
  resetAll: () => void;
  /** True when the shortcut currently has a user override. */
  isCustomized: (id: ShortcutId) => boolean;
}

export const useShortcutConfig = (): UseShortcutConfig => {
  const zero = useZero();
  const userPreference = useSelector(stateMachineActor, state => state.context.userPreference);
  const raw = userPreference?.keyboardShortcuts ?? null;

  const overrides = useMemo(() => parseShortcutOverrides(raw), [raw]);

  const persist = (next: ShortcutOverrideMap): void => {
    void zero.mutate(
      mutators.userPreference.setKeyboardShortcuts({
        id: userPreference?.id ?? crypto.randomUUID(),
        keyboardShortcuts: JSON.stringify(next),
        timestamp: Date.now(),
      }),
    );
  };

  const setOverride = (id: ShortcutId, keys: string[]): void => {
    persist({ ...overrides, [id]: keys });
  };

  const resetOverride = (id: ShortcutId): void => {
    const next = { ...overrides };
    delete next[id];
    persist(next);
  };

  const resetAll = (): void => {
    persist({});
  };

  const isCustomized = (id: ShortcutId): boolean => overrides[id] !== undefined;

  return { overrides, setOverride, resetOverride, resetAll, isCustomized };
};
