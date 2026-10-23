import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type {
  DailyBriefHistoryItem,
  DailyBriefLatest,
  DailyBriefPayload,
} from '@/src/features/morning-brief/api/dailyBriefApi';
import {
  briefActionLabel,
  briefMenuLabel,
  computeSections,
  formatBriefTitle,
  selectBrief,
} from '@/src/features/morning-brief/utils/selectors';

const payload = (overrides: Partial<DailyBriefPayload> = {}): DailyBriefPayload => ({
  generated_for: 'u1',
  date: '2026-09-01',
  what_needs_you: [],
  overdue: [],
  waiting_on_others: [],
  assigned_to_you: [],
  todays_schedule: [],
  ...overrides,
});

describe('formatBriefTitle', () => {
  it('formats a bucket as "Brief // Sep 1"', () => {
    assert.equal(formatBriefTitle('2026-09-01'), 'Brief // Sep 1');
  });
  it('falls back for missing or odd dates', () => {
    assert.equal(formatBriefTitle(undefined), 'Brief');
    assert.equal(formatBriefTitle('yesterday'), 'Brief // yesterday');
  });
});

describe('briefMenuLabel', () => {
  it('formats a history row label', () => {
    assert.equal(briefMenuLabel('2026-07-29'), 'Morning Brief 29 Jul');
  });
});

describe('selectBrief', () => {
  const history: DailyBriefHistoryItem[] = [
    { date: '2026-08-31', status: 'ready', content: 'old', data: null },
  ];
  const latest: DailyBriefLatest = {
    status: 'ready',
    date: '2026-09-01',
    content: 'new',
    data: null,
    isToday: true,
  };

  it('returns the latest view when no date is selected', () => {
    assert.equal(selectBrief(null, history, latest, null)?.content, 'new');
  });

  it('resolves a selected date from history first', () => {
    assert.equal(selectBrief('2026-08-31', history, latest, null)?.content, 'old');
  });

  it('falls back to the fetched brief for out-of-window dates', () => {
    const fetched = { date: '2026-08-01', status: 'ready', content: 'fetched', data: null };
    assert.equal(selectBrief('2026-08-01', history, latest, fetched)?.content, 'fetched');
    assert.equal(selectBrief('2026-08-02', history, latest, fetched), null);
  });

  it('treats status none as no brief', () => {
    assert.equal(selectBrief(null, [], { status: 'none' }, null), null);
  });
});

describe('computeSections', () => {
  it('keeps only non-empty sections and drops blank lines', () => {
    const sections = computeSections(payload({ overdue: ['a', '  ', 'b'], what_needs_you: [''] }));
    assert.equal(sections.length, 1);
    assert.equal(sections[0]?.spec.field, 'overdue');
    assert.deepEqual(sections[0]?.lines, ['a', 'b']);
  });

  it('is empty for a missing payload', () => {
    assert.deepEqual(computeSections(null), []);
  });
});

describe('briefActionLabel', () => {
  const base = {
    loadingWithoutBrief: false,
    fetching: false,
    regenerating: false,
    briefGenerating: false,
    hasBrief: true,
  };
  it('cycles through the web labels', () => {
    assert.equal(briefActionLabel({ ...base, loadingWithoutBrief: true }), 'Loading…');
    assert.equal(briefActionLabel({ ...base, regenerating: true }), 'Regenerating…');
    assert.equal(briefActionLabel({ ...base, regenerating: true, hasBrief: false }), 'Generating…');
    assert.equal(briefActionLabel({ ...base, briefGenerating: true }), 'Generating…');
    assert.equal(briefActionLabel(base), 'Regenerate');
    assert.equal(briefActionLabel({ ...base, hasBrief: false }), 'Generate');
  });
});
