import { parseCreateSchedule } from './agentSchedule';
import { parseCustomProperties } from './customProperty';
import { EMPTY_CREATE_FORM, isFormDirty, type AgentCreateFormState } from './types';

/**
 * Create-canvas drafts in this browser, one per draft id, per workspace + user.
 *
 * Every canvas autosaves under its own id (the `?draft=` in its URL), so a
 * reload brings it back. Only drafts the user chose to save are "kept": those
 * are listed under Drafts in Agent Hub and stay until deleted or created.
 * Autosaves that were never kept are only there for a reload, and go after a
 * day. Version 1 was a single draft per workspace + user that every visit
 * reopened; listing moves it to an id and keeps it, so nothing is lost.
 */

const VERSION = 2;
const PREFIX = 'xyne.agentCreateDraft.v1';
/** Version 1 drafts, and the Build chat stored next to a draft. */
export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** An autosave nobody kept is only for a reload of that canvas. */
export const UNSAVED_DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface StoredAgentDraft {
  v: number;
  savedAt: number;
  /** Saved by the user, so it shows under Drafts in Agent Hub. */
  kept: boolean;
  form: AgentCreateFormState;
}

/** A kept draft, as Agent Hub lists it. */
export interface SavedAgentDraft {
  id: string;
  savedAt: number;
  form: AgentCreateFormState;
}

/** The subset of Storage these helpers use, so tests can pass a map. */
export type DraftStorage = Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem' | 'removeItem'>;

function draftScope(workspaceId: string | undefined, userId: string | undefined): string {
  return `${PREFIX}:${workspaceId ?? 'none'}:${userId ?? 'anon'}`;
}

export function agentDraftStorageKey(
  workspaceId: string | undefined,
  userId: string | undefined,
  draftId: string,
): string {
  return `${draftScope(workspaceId, userId)}:d:${draftId}`;
}

export function newAgentDraftId(): string {
  return crypto.randomUUID();
}

/** Only drafts with real content are worth keeping. */
export function isDraftWorthKeeping(form: AgentCreateFormState): boolean {
  return isFormDirty(form, EMPTY_CREATE_FORM);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Merges onto the empty form so drafts from an older shape still load. */
export function parseStoredDraft(
  raw: string | null,
  now: number = Date.now(),
): StoredAgentDraft | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || (parsed['v'] !== 1 && parsed['v'] !== VERSION) || !isRecord(parsed['form'])) {
    return null;
  }
  const savedAt = typeof parsed['savedAt'] === 'number' ? parsed['savedAt'] : 0;
  // Version 1 drafts reopened on every visit, so they count as kept.
  const kept = parsed['v'] === 1 || parsed['kept'] === true;
  const maxAge =
    parsed['v'] === 1 ? DRAFT_MAX_AGE_MS : kept ? Number.POSITIVE_INFINITY : UNSAVED_DRAFT_MAX_AGE_MS;
  if (now - savedAt > maxAge) return null;
  const stored = parsed['form'];
  const form: AgentCreateFormState = {
    ...EMPTY_CREATE_FORM,
    ...(stored as Partial<AgentCreateFormState>),
    tools: {
      ...EMPTY_CREATE_FORM.tools,
      ...(isRecord(stored['tools'])
        ? (stored['tools'] as Partial<AgentCreateFormState['tools']>)
        : {}),
    },
    // Drafts saved before these existed (or hand-edited ones) load without them.
    schedule: parseCreateSchedule(stored['schedule']),
    customProperties: parseCustomProperties(stored['customProperties']),
    settings: isRecord(stored['settings']) ? stored['settings'] : {},
  };
  return isDraftWorthKeeping(form) ? { v: VERSION, savedAt, kept, form } : null;
}

function browserStorage(): DraftStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readAgentDraft(
  key: string,
  storage: DraftStorage | null = browserStorage(),
): StoredAgentDraft | null {
  try {
    return parseStoredDraft(storage?.getItem(key) ?? null);
  } catch {
    return null;
  }
}

export function writeAgentDraft(
  key: string,
  form: AgentCreateFormState,
  options: { kept: boolean; now?: number },
  storage: DraftStorage | null = browserStorage(),
): void {
  try {
    if (!storage) return;
    if (!isDraftWorthKeeping(form)) {
      storage.removeItem(key);
      return;
    }
    const payload: StoredAgentDraft = {
      v: VERSION,
      savedAt: options.now ?? Date.now(),
      kept: options.kept,
      form,
    };
    storage.setItem(key, JSON.stringify(payload));
  } catch {
    // Storage full or blocked: the canvas still works, it just won't survive a reload.
  }
}

/** Where the Build chat for a draft is kept (buildChatStorage.ts). It goes when the draft does. */
export function buildChatStorageKey(draftKey: string): string {
  return `${draftKey}:chat`;
}

export function clearAgentDraft(key: string, storage: DraftStorage | null = browserStorage()): void {
  try {
    storage?.removeItem(key);
    storage?.removeItem(buildChatStorageKey(key));
  } catch {
    // Nothing to clear when storage is blocked.
  }
}

/**
 * The drafts this user kept in this workspace, newest first. Clears out
 * drafts that expired on the way, and moves a version 1 draft to an id.
 */
export function listSavedAgentDrafts(
  workspaceId: string | undefined,
  userId: string | undefined,
  options: { now?: number; newId?: () => string } = {},
  storage: DraftStorage | null = browserStorage(),
): SavedAgentDraft[] {
  if (!storage) return [];
  const now = options.now ?? Date.now();
  const scope = draftScope(workspaceId, userId);
  try {
    const legacy = storage.getItem(scope);
    if (legacy !== null) {
      const draft = parseStoredDraft(legacy, now);
      if (draft) {
        const key = agentDraftStorageKey(workspaceId, userId, (options.newId ?? newAgentDraftId)());
        writeAgentDraft(key, draft.form, { kept: true, now: draft.savedAt }, storage);
        const chat = storage.getItem(buildChatStorageKey(scope));
        if (chat !== null) storage.setItem(buildChatStorageKey(key), chat);
      }
      clearAgentDraft(scope, storage);
    }

    const prefix = `${scope}:d:`;
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(prefix) && !key.endsWith(':chat')) keys.push(key);
    }
    const saved: SavedAgentDraft[] = [];
    for (const key of keys) {
      const draft = parseStoredDraft(storage.getItem(key), now);
      if (!draft) {
        clearAgentDraft(key, storage);
        continue;
      }
      if (draft.kept) saved.push({ id: key.slice(prefix.length), savedAt: draft.savedAt, form: draft.form });
    }
    return saved.sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}
