import { describe, expect, it } from 'vitest';
import { createdWindows, loadProjectTicketsWindowed } from '../lib/load';
import { ticket } from './fixtures';
import { fakeClient } from './fake-client';

const DAY = 86_400_000;

describe('createdWindows', () => {
  it('covers all time in contiguous, non-overlapping windows, finest near now', () => {
    const now = Date.UTC(2026, 8, 28);
    const w = createdWindows(now);
    expect(w[0].start).toBeUndefined();
    expect(w.at(-1)!.end).toBeUndefined();
    for (let i = 1; i < w.length; i++) expect(w[i].start).toBe(w[i - 1].end! + 1);
    const last = w.at(-1)!;
    expect(now - last.start!).toBeLessThanOrEqual(31 * DAY);
    expect(w.length).toBeGreaterThanOrEqual(12);
  });
});

describe('loadProjectTicketsWindowed', () => {
  it('fetches each window and returns every ticket exactly once', async () => {
    const rows = [1, 500, 999, 1000, 1500, 1999, 2000, 5000].map(c => ticket(`t${c}`, { createdAt: c, merchantId: null }));
    const { client, calls } = fakeClient({ kanban: { p1: rows } });
    const got = await loadProjectTicketsWindowed(client, 'p1', ['g-mid'], () => undefined, [
      { end: 999 },
      { start: 1000, end: 1999 },
      { start: 2000 },
    ]);
    expect(got.map(t => t.id).sort()).toEqual(rows.map(t => t.id).sort());
    expect(calls.listKanban.map(c => [c.filters.createdDateStart, c.filters.createdDateEnd])).toEqual(
      expect.arrayContaining([[undefined, 999], [1000, 1999], [2000, undefined]]),
    );
    expect(calls.listKanban.every(c => c.filters.merchantIds === undefined && c.formEntityValueFieldIds?.[0] === 'g-mid')).toBe(true);
  });
});
