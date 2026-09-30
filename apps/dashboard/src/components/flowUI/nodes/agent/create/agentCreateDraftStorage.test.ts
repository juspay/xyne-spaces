import { describe, expect, it } from 'vitest';
import {
  agentDraftStorageKey,
  DRAFT_MAX_AGE_MS,
  isDraftWorthKeeping,
  parseStoredDraft,
} from './agentCreateDraftStorage';
import { EMPTY_CREATE_FORM } from './types';

const NOW = 1_800_000_000_000;

const stored = (form: Record<string, unknown>, savedAt = NOW - 1000, v = 1): string =>
  JSON.stringify({ v, savedAt, form });

describe('agentCreateDraftStorage', () => {
  it('keys drafts per workspace and user', () => {
    expect(agentDraftStorageKey('ws1', 'u1')).not.toBe(agentDraftStorageKey('ws2', 'u1'));
    expect(agentDraftStorageKey('ws1', 'u1')).not.toBe(agentDraftStorageKey('ws1', 'u2'));
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
    expect(parseStoredDraft(stored({ name: 'Next' }, NOW, 2), NOW)).toBeNull();
    expect(parseStoredDraft(stored({}), NOW)).toBeNull();
    expect(parseStoredDraft('{not json', NOW)).toBeNull();
    expect(parseStoredDraft(null, NOW)).toBeNull();
  });
});
