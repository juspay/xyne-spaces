import React, { useCallback } from 'react';
import { HotkeysProvider, useHotkeys } from 'react-hotkeys-hook';
import { useSelector } from '@xstate/react';
import { shortcutsActor } from '../machines/shortcutsMachine';
import { getUseKeyForShortcut, resolveShortcut } from '../shortcuts/shortcutsRegistry';
import { usePlatform } from '../hooks/usePlatform';
import { posthogService } from '../services/Analytics/posthogService';

const APP_SCOPE = 'app';

/**
 * Validate that required modifier keys are pressed for a shortcut.
 * This is needed because react-hotkeys-hook with useKey: true doesn't properly
 * validate modifiers for special characters like [, ], /, .
 * Also ensures unwanted modifiers are NOT pressed (exact match).
 */
const validateModifiers = (keys: string, event: KeyboardEvent, isMac: boolean): boolean => {
  const keyLower = keys.toLowerCase();

  const requiresMod = keyLower.includes('mod+');
  const modPressed = isMac ? event.metaKey : event.ctrlKey;
  if (requiresMod && !modPressed) return false;
  if (!requiresMod && modPressed) return false;

  const requiresShift = keyLower.includes('shift+');
  if (requiresShift && !event.shiftKey) return false;
  if (!requiresShift && event.shiftKey) return false;

  const requiresAlt = keyLower.includes('alt+');
  if (requiresAlt && !event.altKey) return false;
  if (!requiresAlt && event.altKey) return false;

  return true;
};

const HotkeyBinding = ({
  keys,
  isMac,
}: {
  keys: string;
  isMac: boolean;
}): React.ReactElement | null => {
  const handleKey = useCallback(
    (event: KeyboardEvent) => {
      if (!validateModifiers(keys, event, isMac)) return;

      const activeScopes = shortcutsActor.getSnapshot().context.scopeStack;
      const entry = resolveShortcut(keys, event, activeScopes);
      if (!entry) return;

      if (entry.preventDefault) {
        event.preventDefault();
      }

      // Keyboard-driven actions are invisible to autocapture (which only sees
      // clicks). Record the resolved command so shortcut usage — custom and
      // built-in — is measurable. Only the stable command id/keys are sent, never
      // typed text, so no message content leaks.
      posthogService.capture('shortcut_triggered', {
        shortcutId: entry.id,
        keys: entry.keys.join('+'),
        scope: entry.scope,
      });

      entry.handler(event);
    },
    [keys, isMac],
  );

  // Get useKey directly from registry - no need for resolveShortcut overhead
  const useKey = getUseKeyForShortcut(keys);

  // Note: We always set enableOnFormTags/enableOnContentEditable to true here.
  // Individual shortcuts control whether they work in inputs via allowInInputs flag
  // which is checked in resolveShortcut()
  useHotkeys(
    keys,
    (event: KeyboardEvent) => handleKey(event),
    {
      scopes: [APP_SCOPE],
      enableOnFormTags: true,
      enableOnContentEditable: true,
      preventDefault: false,
      useKey,
    },
    [handleKey],
  );

  return null;
};

export const ShortcutsProvider = ({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement => {
  // Content comparator: this provider wraps the whole app, and registeredKeys
  // gets replaced with a fresh array reference on registry updates — without
  // the comparator, every update re-rendered all HotkeyBindings even when the
  // key set was identical.
  const keys = useSelector(
    shortcutsActor,
    state => state.context.registeredKeys,
    (a, b) => a === b || (a.length === b.length && a.every((k, i) => k === b[i])),
  );
  const { isMobile, isMac } = usePlatform();

  if (isMobile) {
    return <>{children}</>;
  }

  return (
    <HotkeysProvider initiallyActiveScopes={[APP_SCOPE]}>
      {keys.map(key => (
        <HotkeyBinding key={key} keys={key} isMac={isMac} />
      ))}
      {children}
    </HotkeysProvider>
  );
};
