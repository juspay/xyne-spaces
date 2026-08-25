import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMIT, MAX_LIMIT, paginate } from './core/paginate.js';

/** 0, 1, 2, … n-1 — the index doubles as the value, so slices are easy to assert on. */
const seq = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

describe('paginate', () => {
  it('returns the first DEFAULT_LIMIT rows when no options are given', () => {
    const page = paginate(seq(250));
    expect(page.items).toHaveLength(DEFAULT_LIMIT);
    expect(page.items[0]).toBe(0);
    expect(page.total).toBe(250);
    expect(page.hasMore).toBe(true);
    expect(page.nextOffset).toBe(DEFAULT_LIMIT);
  });

  it('clamps a limit above MAX_LIMIT instead of throwing', () => {
    // The whole point of the cap: an over-estimate is answered, not rejected.
    expect(() => paginate(seq(5000), { limit: 5000 })).not.toThrow();
    expect(paginate(seq(5000), { limit: 5000 }).items).toHaveLength(MAX_LIMIT);
    expect(paginate(seq(5000), { limit: Number.MAX_SAFE_INTEGER }).items).toHaveLength(MAX_LIMIT);
  });

  it('honours a limit below the cap', () => {
    const page = paginate(seq(50), { limit: 10 });
    expect(page.items).toEqual(seq(10));
    expect(page.hasMore).toBe(true);
    expect(page.nextOffset).toBe(10);
  });

  it('floors a non-positive limit at 1, so hasMore can never loop forever', () => {
    // limit: 0 would otherwise return nothing while still reporting hasMore,
    // which reads as "ask again" and never advances.
    for (const limit of [0, -1, -100]) {
      const page = paginate(seq(10), { limit });
      expect(page.items).toHaveLength(1);
      expect(page.nextOffset).toBe(1);
    }
  });

  it('walks to the end with the offsets it hands back', () => {
    const all = seq(250);
    const seen: number[] = [];
    let offset = 0;
    for (;;) {
      const page = paginate(all, { offset });
      seen.push(...page.items);
      if (!page.hasMore) break;
      offset = page.nextOffset;
    }
    expect(seen).toEqual(all);
  });

  it('reports the last page as complete rather than as having more', () => {
    const page = paginate(seq(100), { offset: 50 });
    expect(page.items).toHaveLength(50);
    expect(page.hasMore).toBe(false);
    expect(page.nextOffset).toBe(100);
  });

  it('treats a negative offset as 0', () => {
    expect(paginate(seq(10), { offset: -5 }).items[0]).toBe(0);
  });

  it('returns an empty page past the end without claiming more', () => {
    const page = paginate(seq(10), { offset: 999 });
    expect(page.items).toEqual([]);
    expect(page.hasMore).toBe(false);
    expect(page.total).toBe(10);
  });

  it('handles an empty result', () => {
    const page = paginate([]);
    expect(page.items).toEqual([]);
    expect(page.hasMore).toBe(false);
    expect(page.total).toBe(0);
    expect(page.nextOffset).toBe(0);
  });
});
