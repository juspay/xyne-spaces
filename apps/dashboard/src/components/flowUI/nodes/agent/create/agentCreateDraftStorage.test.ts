import { describe, expect, it } from 'vitest';
import {
  agentDraftStorageKey,
  buildChatStorageKey,
  DRAFT_MAX_AGE_MS,
  isDraftWorthKeeping,
  listSavedAgentDrafts,
  parseStoredDraft,
  readAgentDraft,
  UNSAVED_DRAFT_MAX_AGE_MS,
  writeAgentDraft,
  type DraftStorage,
} from './agentCreateDraftStorage';
import { EMPTY_CREATE_FORM } from './types';

function memoryStorage(
  initial: Record<string, string> = {},
): DraftStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get length() {
      return data.size;
    },
    key: index => [...data.keys()][index] ?? null,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: key => void data.delete(key),
  };
}

const NOW = 1_800_000_000_000;

const stored = (form: Record<string, unknown>, savedAt = NOW - 1000, v = 1): string =>
  JSON.stringify({ v, savedAt, form });

describe('agentCreateDraftStorage', () => {
  it('keys drafts per workspace, user and draft', () => {
    expect(agentDraftStorageKey('ws1', 'u1', 'a')).not.toBe(agentDraftStorageKey('ws2', 'u1', 'a'));
    expect(agentDraftStorageKey('ws1', 'u1', 'a')).not.toBe(agentDraftStorageKey('ws1', 'u2', 'a'));
    expect(agentDraftStorageKey('ws1', 'u1', 'a')).not.toBe(agentDraftStorageKey('ws1', 'u1', 'b'));
  });

  it('does not keep an empty canvas', () => {
    expect(isDraftWorthKeeping(EMPTY_CREATE_FORM)).toBe(false);
    expect(isDraftWorthKeeping({ ...EMPTY_CREATE_FORM, name: 'Brief' })).toBe(true);
  });

  it('restores a recent draft and fills fields added since it was saved', () => {
    const draft = parseStoredDraft(
      stored({ name: 'Morning Brief', systemPrompt: 'Workflow…', tools: { direct: ['read_dms'] } }),
      NOW,
    );
    expect(draft?.form.name).toBe('Morning Brief');
    expect(draft?.form.tools.direct).toEqual(['read_dms']);
    expect(draft?.form.tools.custom).toEqual([]);
    expect(draft?.form.permissionMode).toBe(EMPTY_CREATE_FORM.permissionMode);
  });

  it('keeps the schedule and custom properties, and drops malformed ones', () => {
    const draft = parseStoredDraft(
      stored({
        name: 'Digest',
        schedule: { kind: 'repeat', cron: '0 9 * * 1-5', timezone: 'Asia/Kolkata', task: '' },
        customProperties: [
          { id: 'p1', type: 'number', title: 'Budget', value: '500' },
          { id: 'p2', type: 'colour', title: 'Bad', value: 'x' },
        ],
      }),
      NOW,
    );
    expect(draft?.form.schedule).toMatchObject({ kind: 'repeat', cron: '0 9 * * 1-5' });
    expect(draft?.form.customProperties).toEqual([
      { id: 'p1', type: 'number', title: 'Budget', value: '500' },
    ]);

    const old = parseStoredDraft(stored({ name: 'Old shape' }), NOW);
    expect(old?.form.schedule).toBeNull();
    expect(old?.form.customProperties).toEqual([]);
  });

  it('drops expired, foreign-version, empty and corrupt drafts', () => {
    expect(parseStoredDraft(stored({ name: 'Old' }, NOW - DRAFT_MAX_AGE_MS - 1), NOW)).toBeNull();
    expect(parseStoredDraft(stored({ name: 'Next' }, NOW, 3), NOW)).toBeNull();
    expect(parseStoredDraft(stored({}), NOW)).toBeNull();
    expect(parseStoredDraft('{not json', NOW)).toBeNull();
    expect(parseStoredDraft(null, NOW)).toBeNull();
  });

  it('keeps a saved draft however old, and drops an unsaved autosave after a day', () => {
    const storage = memoryStorage();
    const form = { ...EMPTY_CREATE_FORM, name: 'Digest' };
    const saved = agentDraftStorageKey('ws', 'u', 'saved');
    const unsaved = agentDraftStorageKey('ws', 'u', 'unsaved');
    const longAgo = NOW - 90 * 24 * 60 * 60 * 1000;
    writeAgentDraft(saved, form, { kept: true, now: longAgo }, storage);
    writeAgentDraft(
      unsaved,
      form,
      { kept: false, now: NOW - UNSAVED_DRAFT_MAX_AGE_MS - 1 },
      storage,
    );
    expect(readAgentDraft(saved, storage)?.form.name).toBe('Digest');
    expect(parseStoredDraft(storage.getItem(saved), NOW)?.kept).toBe(true);
    expect(parseStoredDraft(storage.getItem(unsaved), NOW)).toBeNull();
  });
});

describe('listSavedAgentDrafts', () => {
  const form = (name: string) => ({ ...EMPTY_CREATE_FORM, name });

  it('lists only the drafts the user saved, newest first, and clears expired ones', () => {
    const storage = memoryStorage();
    const key = (id: string) => agentDraftStorageKey('ws', 'u', id);
    writeAgentDraft(key('old'), form('Old'), { kept: true, now: NOW - 5000 }, storage);
    writeAgentDraft(key('new'), form('New'), { kept: true, now: NOW - 1000 }, storage);
    writeAgentDraft(key('autosave'), form('Autosave'), { kept: false, now: NOW - 1000 }, storage);
    writeAgentDraft(
      key('stale'),
      form('Stale'),
      { kept: false, now: NOW - UNSAVED_DRAFT_MAX_AGE_MS - 1 },
      storage,
    );
    storage.setItem(buildChatStorageKey(key('stale')), '{}');
    writeAgentDraft(
      agentDraftStorageKey('ws', 'other', 'x'),
      form('Theirs'),
      { kept: true, now: NOW },
      storage,
    );

    const drafts = listSavedAgentDrafts('ws', 'u', { now: NOW }, storage);
    expect(drafts.map(draft => draft.id)).toEqual(['new', 'old']);
    expect(storage.getItem(key('stale'))).toBeNull();
    expect(storage.getItem(buildChatStorageKey(key('stale')))).toBeNull();
    expect(storage.getItem(key('autosave'))).not.toBeNull();
  });

  it('moves the old single draft, and its Build chat, to an id and keeps it', () => {
    const legacy = 'xyne.agentCreateDraft.v1:ws:u';
    const storage = memoryStorage({
      [legacy]: stored({ name: 'From before' }),
      [`${legacy}:chat`]: '{"v":1}',
    });
    const drafts = listSavedAgentDrafts('ws', 'u', { now: NOW, newId: () => 'moved' }, storage);
    expect(drafts.map(draft => [draft.id, draft.form.name])).toEqual([['moved', 'From before']]);
    expect(storage.getItem(legacy)).toBeNull();
    expect(storage.getItem(buildChatStorageKey(agentDraftStorageKey('ws', 'u', 'moved')))).toBe(
      '{"v":1}',
    );
  });
});
