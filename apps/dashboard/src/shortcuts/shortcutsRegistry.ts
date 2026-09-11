import { logger, Event as LogEvent } from '../utils/logger';
import { shortcutsActor } from '../machines/shortcutsMachine';

declare global {
  interface KeyboardEvent {
    /** True when the event was synthesized by `invokeShortcut` rather than a real key press. */
    __fromInvokeShortcut?: boolean;
  }
}

export const KNOWN_SHORTCUT_SCOPES = [
  'global',
  'channel',
  'thread',
  'composer',
  'command',
  'modal',
  'viewer',
  'canvas',
] as const;

export type KnownShortcutScope = (typeof KNOWN_SHORTCUT_SCOPES)[number];
export type ShortcutScope = string;

export interface ShortcutConfig {
  scope?: ShortcutScope;
  priority?: number;
  allowInInputs?: boolean;
  preventDefault?: boolean;
  useKey?: boolean;
  description?: string;
  category?: string;
  when?: (event: KeyboardEvent) => boolean;
}

export interface ShortcutRegistration extends ShortcutConfig {
  keys: string | string[];
  enabled?: boolean;
}

interface ShortcutEntry {
  id: string;
  keys: string[];
  scope: ShortcutScope;
  priority: number;
  allowInInputs: boolean;
  preventDefault: boolean;
  useKey?: boolean;
  description?: string;
  category?: string;
  when?: (event: KeyboardEvent) => boolean;
  order: number;
  handler: (event: KeyboardEvent) => void;
}

interface ShortcutMetadata {
  id: string;
  keys: string[];
  scope: ShortcutScope;
  priority: number;
  description?: string;
  category?: string;
}

type Registry = Map<string, Map<string, ShortcutEntry>>;

let orderCounter = 0;
const registry: Registry = new Map();
const tieWarnings = new Set<string>();

// Signature of the last key set sent to the actor. registerShortcut runs once
// PER SHORTCUT PER COMPONENT (e.g. ~7 per mounted ChatBubble), but the key SET
// almost never changes — every bubble registers the same key strings. Without
// this dedupe, mounting/unmounting a message list fired hundreds of
// UPDATE_KEYS events in a tight loop, each re-rendering ShortcutsProvider and
// every HotkeyBinding under it (a 100% CPU spike on channel mount/unmount).
let lastSentKeysSignature: string | null = null;

const updateRegisteredKeys = (): void => {
  const keys = Array.from(registry.keys());
  const signature = keys.join(' ');
  if (signature === lastSentKeysSignature) return;
  lastSentKeysSignature = signature;
  shortcutsActor.send({ type: 'UPDATE_KEYS', keys });
};

const normalizeKeys = (keys: string | string[]): string[] => {
  const rawKeys = Array.isArray(keys) ? keys : keys.split(',');
  return rawKeys.map(key => key.trim().toLowerCase()).filter(Boolean);
};

/**
 * Check if the event target is an editable element (input, textarea, contentEditable, etc.)
 * Used to filter shortcuts that shouldn't trigger while typing
 */
const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;

  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
};

export const registerShortcut = (
  keys: string | string[],
  config: ShortcutConfig,
  handler: (event: KeyboardEvent) => void,
): (() => void) => {
  const normalizedKeys = normalizeKeys(keys);
  const id = `shortcut_${orderCounter++}`;

  const entry: ShortcutEntry = {
    id,
    keys: normalizedKeys,
    scope: config.scope ?? 'global',
    priority: config.priority ?? 0,
    allowInInputs: config.allowInInputs ?? false,
    preventDefault: config.preventDefault ?? true,
    order: orderCounter,
    handler,
  };

  if (config.useKey !== undefined) {
    entry.useKey = config.useKey;
  }

  if (config.description !== undefined) {
    entry.description = config.description;
  }

  if (config.category !== undefined) {
    entry.category = config.category;
  }

  if (config.when !== undefined) {
    entry.when = config.when;
  }

  normalizedKeys.forEach(key => {
    const entries = registry.get(key) ?? new Map<string, ShortcutEntry>();
    entries.set(id, entry);
    registry.set(key, entries);
  });

  updateRegisteredKeys();

  return () => {
    normalizedKeys.forEach(key => {
      const entries = registry.get(key);
      if (!entries) return;
      entries.delete(id);
      if (entries.size === 0) registry.delete(key);
    });
    updateRegisteredKeys();
  };
};

export const getShortcutKeys = (): string[] => shortcutsActor.getSnapshot().context.registeredKeys;

export const listShortcuts = (): ShortcutMetadata[] => {
  const entries: ShortcutMetadata[] = [];
  const seen = new Set<string>();
  registry.forEach(keyEntries => {
    keyEntries.forEach(entry => {
      if (seen.has(entry.id)) return;
      seen.add(entry.id);
      entries.push({
        id: entry.id,
        keys: entry.keys,
        scope: entry.scope,
        priority: entry.priority,
        ...(entry.description !== undefined ? { description: entry.description } : {}),
        ...(entry.category !== undefined ? { category: entry.category } : {}),
      });
    });
  });
  return entries;
};

export const resolveShortcut = (
  key: string,
  event: KeyboardEvent,
  activeScopes: ShortcutScope[],
): ShortcutEntry | null => {
  const entries = registry.get(key);
  if (!entries) return null;

  const scopeRank = (scope: ShortcutScope): number => {
    if (scope === '*') return -1;
    return activeScopes.lastIndexOf(scope);
  };

  // Build candidates with cached scope ranks in a single pass
  const candidates: Array<{ entry: ShortcutEntry; rank: number }> = [];
  for (const entry of entries.values()) {
    const rank = scopeRank(entry.scope);
    if (entry.scope !== '*' && rank === -1) continue;
    if (!entry.allowInInputs && isEditableTarget(event.target)) continue;
    if (entry.when && !entry.when(event)) continue;
    candidates.push({ entry, rank });
  }

  if (candidates.length === 0) return null;

  if (import.meta.env.DEV && candidates.length > 1) {
    // Find best scope rank and priority in a single pass
    let bestScopeRank = -Infinity;
    let bestPriority = -Infinity;

    for (const { entry, rank } of candidates) {
      if (rank > bestScopeRank) {
        bestScopeRank = rank;
        bestPriority = entry.priority;
      } else if (rank === bestScopeRank && entry.priority > bestPriority) {
        bestPriority = entry.priority;
      }
    }

    // Collect tied candidates in a single pass
    const tiedCandidates: ShortcutEntry[] = [];
    for (const { entry, rank } of candidates) {
      if (rank === bestScopeRank && entry.priority === bestPriority) {
        tiedCandidates.push(entry);
      }
    }

    if (tiedCandidates.length > 1) {
      const signature = [
        key,
        bestScopeRank,
        bestPriority,
        tiedCandidates
          .map(entry => entry.id)
          .sort()
          .join(','),
      ].join('|');

      if (!tieWarnings.has(signature)) {
        tieWarnings.add(signature);
        logger.warn(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_warn',
          message: String(
            `[Shortcuts] Ambiguous shortcut resolution for "${key}" at priority ${bestPriority}. ` +
              'Adjust scope/priority to disambiguate.',
          ),
          context: [
            tiedCandidates.map(entry => ({
              id: entry.id,
              scope: entry.scope,
              description: entry.description,
              category: entry.category,
            })),
          ],
        });
      }
    }
  }

  candidates.sort((a, b) => {
    const scopeDiff = b.rank - a.rank;
    if (scopeDiff !== 0) return scopeDiff;

    const priorityDiff = b.entry.priority - a.entry.priority;
    if (priorityDiff !== 0) return priorityDiff;

    return b.entry.order - a.entry.order;
  });

  return candidates[0]?.entry ?? null;
};

/**
 * Get the useKey option for a given key from any registered shortcut.
 * Returns true if any shortcut for this key has useKey enabled.
 */
export const getUseKeyForShortcut = (key: string): boolean => {
  const entries = registry.get(key);
  if (!entries) return false;
  for (const entry of entries.values()) {
    if (entry.useKey) return true;
  }
  return false;
};

/**
 * Programmatically invoke a shortcut handler by key combination.
 * Useful for triggering shortcuts from UI elements (e.g., search button).
 * @param key - The shortcut key combination (e.g., 'mod+k')
 * @returns true if a handler was found and invoked
 */
export const invokeShortcut = (key: string): boolean => {
  const normalizedKey = key.trim().toLowerCase();
  const entries = registry.get(normalizedKey);
  if (!entries || entries.size === 0) return false;

  const activeScopes = shortcutsActor.getSnapshot().context.scopeStack;

  // Parse the key combination to extract the actual key and modifiers
  // Handle edge case where the actual key is '+' (e.g., 'mod++' or 'shift++')
  const parts = normalizedKey.split('+');
  const actualKey =
    parts[parts.length - 1] || (parts.length > 1 && normalizedKey.endsWith('+') ? '+' : '');
  const hasMod = parts.includes('mod') || parts.includes('meta');
  const hasCtrl = parts.includes('ctrl');
  const hasShift = parts.includes('shift');
  const hasAlt = parts.includes('alt');

  try {
    // Create a synthetic event that matches the shortcut key combination
    const syntheticEvent = new KeyboardEvent('keydown', {
      key: actualKey,
      code: actualKey.length === 1 ? `Key${actualKey.toUpperCase()}` : actualKey,
      metaKey: hasMod,
      ctrlKey: hasCtrl,
      shiftKey: hasShift,
      altKey: hasAlt,
      bubbles: true,
      cancelable: true,
    });

    const entry = resolveShortcut(normalizedKey, syntheticEvent, activeScopes);
    if (!entry) return false;

    // Mark synthetic events so handlers can distinguish UI-triggered shortcuts
    // from genuine keyboard presses
    syntheticEvent.__fromInvokeShortcut = true;
    entry.handler(syntheticEvent);
    return true;
  } catch (error) {
    logger.warn(LogEvent.FRONTEND_ERROR, {
      type: 'migrated_console_warn',
      message: String('Failed to invoke shortcut:'),
      context: [key, error],
    });
    return false;
  }
};
