import { useEffect, useRef } from 'react';
import { shortcutsActor } from '../machines/shortcutsMachine';
import { registerShortcut } from './shortcutsRegistry';
import type { ShortcutScope, ShortcutRegistration } from './shortcutsRegistry';
import { getShortcut } from './catalog';
import { isElectronApp } from '../utils/electronApp';
import type { ShortcutDefinition, ShortcutId } from './catalog';

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
  const definition = getShortcut(id);
  const { keys, ...baseConfig } = definition ?? { keys: '' };

  // An `electronOnly` combo is claimed by the browser itself (new window,
  // incognito, tab switching) and never reaches the page, so registering a
  // handler for it in a tab only adds a listener that can never fire. Gating
  // here means the catalog flag governs both the binding and the hint, instead
  // of every call site repeating the check the sidebar rail does by hand.
  const available =
    definition !== undefined && (definition.electronOnly !== true || isElectronApp());

  useShortcut(keys, handler, {
    ...baseConfig,
    ...overrides,
    enabled: available ? (overrides.enabled ?? true) : false,
  });
};
