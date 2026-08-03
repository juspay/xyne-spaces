import { useEffect, useRef, useSyncExternalStore } from 'react';
import { shortcutsActor } from '../machines/shortcutsMachine';
import { registerShortcut } from './shortcutsRegistry';
import type { ShortcutScope, ShortcutRegistration } from './shortcutsRegistry';
import { shortcuts } from './catalog';
import type { ShortcutDefinition, ShortcutId } from './catalog';
import { getShortcutOverrides, subscribeShortcutOverrides } from './overridesStore';

/**
 * Subscribe to the live per-user override map. Returns a stable snapshot whose
 * identity only changes when the user remaps a shortcut, so downstream `keys`
 * references stay referentially stable between renders.
 */
const useShortcutOverrideMap = (): ReturnType<typeof getShortcutOverrides> =>
  useSyncExternalStore(subscribeShortcutOverrides, getShortcutOverrides, getShortcutOverrides);

export const useShortcut = (
  keys: ShortcutRegistration['keys'],
  handler: (event: KeyboardEvent) => void,
  config: Omit<ShortcutRegistration, 'keys'> = {},
): void => {
  const handlerRef = useRef(handler);
  const whenRef = useRef(config.when);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    whenRef.current = config.when;
  }, [config.when]);

  useEffect(() => {
    if (config.enabled === false) return;

    const { enabled: _enabled, when: _when, ...registerConfig } = config;
    return registerShortcut(
      keys,
      {
        ...registerConfig,
        // Use ref for `when` to avoid re-registration when function reference changes
        ...(config.when && {
          when: (event: KeyboardEvent) => whenRef.current?.(event) ?? true,
        }),
      },
      event => {
        handlerRef.current(event);
      },
    );
  }, [
    keys,
    config.scope,
    config.priority,
    config.allowInInputs,
    config.preventDefault,
    config.description,
    config.category,
    // Only re-register when `when` is added or removed, not when reference changes
    config.when !== undefined,
    config.enabled,
  ]);
};

export const useScope = (scope: ShortcutScope, active = true): void => {
  useEffect(() => {
    if (!active) return;
    shortcutsActor.send({ type: 'PUSH_SCOPE', scope });
    return () => {
      shortcutsActor.send({ type: 'POP_SCOPE', scope });
    };
  }, [scope, active]);
};

type ShortcutOverrides = Partial<Omit<ShortcutDefinition, 'keys'>> & { enabled?: boolean };

/**
 * Use a shortcut from the central catalog
 * @param id - Shortcut ID from catalog (e.g., 'message.compose')
 * @param handler - Function to execute when shortcut is triggered
 * @param overrides - Override catalog defaults (scope, priority, etc.)
 *
 * @example
 * useShortcutById('message.compose', () => {
 *   openComposer();
 * });
 */
export const useShortcutById = (
  id: ShortcutId,
  handler: (event: KeyboardEvent) => void,
  overrides: ShortcutOverrides = {},
): void => {
  const overrideMap = useShortcutOverrideMap();
  const definition = shortcuts[id];
  const { keys: catalogKeys, ...baseConfig } = definition || { keys: '' };

  // Resolve the effective key binding: a user override (if present) wins over the
  // catalog default. Both branches return referentially stable arrays/strings, so
  // useShortcut only re-registers when the binding actually changes.
  const userKeys = overrideMap[id];
  const resolvedKeys = userKeys ?? catalogKeys;

  // An override set to an empty array means the user intentionally unbound it.
  const isUnbound = Array.isArray(userKeys) && userKeys.length === 0;

  useShortcut(resolvedKeys, handler, {
    ...baseConfig,
    ...overrides,
    enabled: definition && !isUnbound ? (overrides.enabled ?? true) : false,
  });
};

/**
 * Resolve the effective primary combo string for a shortcut (override-aware).
 * Used by non-registry gesture handlers (e.g. composer push-to-talk) that need to
 * read the current binding without registering a react-hotkeys handler. Returns a
 * primitive string so it is safe to place directly in effect dependency arrays.
 */
export const useResolvedShortcutCombo = (id: ShortcutId): string => {
  const overrideMap = useShortcutOverrideMap();
  const userKeys = overrideMap[id];
  const catalogKeys = shortcuts[id]?.keys ?? '';
  const keys = userKeys ?? catalogKeys;
  return Array.isArray(keys) ? (keys[0] ?? '') : keys;
};
