import { parseCreateSchedule } from './agentSchedule';
import { parseCustomProperties } from './customProperty';
import { EMPTY_CREATE_FORM, isFormDirty, type AgentCreateFormState } from './types';

/**
 * Unsaved create-canvas drafts, kept per workspace + user in this browser so a
 * reload or an accidental navigation does not throw away a drafted agent.
 */

const VERSION = 1;
const PREFIX = 'xyne.agentCreateDraft.v1';
export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface StoredAgentDraft {
  v: number;
  savedAt: number;
  form: AgentCreateFormState;
}

export function agentDraftStorageKey(
  workspaceId: string | undefined,
  userId: string | undefined,
): string {
  return `${PREFIX}:${workspaceId ?? 'none'}:${userId ?? 'anon'}`;
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
  if (!isRecord(parsed) || parsed['v'] !== VERSION || !isRecord(parsed['form'])) return null;
  const savedAt = typeof parsed['savedAt'] === 'number' ? parsed['savedAt'] : 0;
  if (now - savedAt > DRAFT_MAX_AGE_MS) return null;
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
  return isDraftWorthKeeping(form) ? { v: VERSION, savedAt, form } : null;
}

export function readAgentDraft(key: string): StoredAgentDraft | null {
  try {
    return parseStoredDraft(window.localStorage.getItem(key));
  } catch {
    return null;
  }
}

export function writeAgentDraft(
  key: string,
  form: AgentCreateFormState,
  now: number = Date.now(),
): void {
  try {
    if (!isDraftWorthKeeping(form)) {
      window.localStorage.removeItem(key);
      return;
    }
    const payload: StoredAgentDraft = { v: VERSION, savedAt: now, form };
    window.localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // Storage full or blocked: the canvas still works, it just won't survive a reload.
  }
}

/** Where the Build chat for a draft is kept (buildChatStorage.ts). It goes when the draft does. */
export function buildChatStorageKey(draftKey: string): string {
  return `${draftKey}:chat`;
}

export function clearAgentDraft(key: string): void {
  try {
    window.localStorage.removeItem(key);
    window.localStorage.removeItem(buildChatStorageKey(key));
  } catch {
    // Nothing to clear when storage is blocked.
  }
}
