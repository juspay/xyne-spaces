import { describe, expect, it } from 'vitest';
import { loadAnswer, loadFilters, loadRange, loadMidPicks, recordMidPick, saveAnswer, saveFilters, saveRange } from '../lib/prefs';

function mem(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: k => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: k => void m.delete(k),
    clear: () => m.clear(),
    key: i => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

describe('created-range preference', () => {
  it('defaults to all time when nothing is saved', () => {
    expect(loadRange(mem())).toBe('all');
  });

  it('round-trips a saved range', () => {
    const s = mem();
    saveRange(s, 30);
    expect(loadRange(s)).toBe(30);
    saveRange(s, 'all');
    expect(loadRange(s)).toBe('all');
  });

  it('ignores values that are not one of the menu ranges', () => {
    const s = mem();
    s.setItem('mpv.createdRange', '"12"');
    expect(loadRange(s)).toBe('all');
    s.setItem('mpv.createdRange', 'not json');
    expect(loadRange(s)).toBe('all');
  });

  it('survives storage that throws or is missing', () => {
    const broken = { ...mem(), getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } } as Storage;
    expect(loadRange(broken)).toBe('all');
    expect(() => saveRange(broken, 7)).not.toThrow();
    expect(loadRange(null)).toBe('all');
  });
});

describe('merchant ID search history', () => {
  it('counts picks and ranks by count, then by most recent', () => {
    const s = mem();
    recordMidPick(s, 'swiggy', 1);
    recordMidPick(s, 'bigbasket', 2);
    recordMidPick(s, 'swiggy', 3);
    recordMidPick(s, 'zepto', 4);
    expect(loadMidPicks(s)).toEqual(['swiggy', 'zepto', 'bigbasket']);
  });

  it('keeps at most 50 merchants and survives bad or blocked storage', () => {
    const s = mem();
    for (let i = 0; i < 60; i++) recordMidPick(s, `m${i}`, i);
    expect(loadMidPicks(s)).toHaveLength(50);
    expect(loadMidPicks(s)[0]).toBe('m59');
    s.setItem('mpv.midPicks', 'nope');
    expect(loadMidPicks(s)).toEqual([]);
    expect(loadMidPicks(null)).toEqual([]);
  });
});

describe('saved filters', () => {
  const EMPTY = { tab: 'merchants', desks: [], boards: [], owners: [], health: [] };

  it('starts empty and round-trips the pills and tab', () => {
    const s = mem();
    expect(loadFilters(s)).toEqual(EMPTY);
    const f = { tab: 'tickets' as const, desks: ['Desk · support'], boards: ['Euler / ISSUE'], owners: ['Lisa Roy'], health: ['red' as const, 'amber' as const] };
    saveFilters(s, f);
    expect(loadFilters(s)).toEqual(f);
  });

  it('drops anything malformed and survives blocked storage', () => {
    const s = mem();
    s.setItem('mpv.filters', JSON.stringify({ tab: 'nope', desks: 'x', boards: [1, 'b'], owners: null, health: ['red', 'purple'] }));
    expect(loadFilters(s)).toEqual({ ...EMPTY, boards: ['b'], health: ['red'] });
    s.setItem('mpv.filters', '{not json');
    expect(loadFilters(s)).toEqual(EMPTY);
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } } as unknown as Storage;
    expect(loadFilters(blocked)).toEqual(EMPTY);
    expect(() => saveFilters(blocked, EMPTY as never)).not.toThrow();
    expect(loadFilters(null)).toEqual(EMPTY);
  });
});

describe('saved agent answers', () => {
  it('remembers each answer by key, with when it was written, until replaced', () => {
    const s = mem();
    expect(loadAnswer(s, 'why|t1')).toBeNull();
    saveAnswer(s, 'why|t1', 'first', 1000);
    saveAnswer(s, 'tldr|30|savana', 'summary', 2000);
    expect(loadAnswer(s, 'why|t1')).toEqual({ text: 'first', at: 1000 });
    saveAnswer(s, 'why|t1', 'second', 3000);
    expect(loadAnswer(s, 'why|t1')).toEqual({ text: 'second', at: 3000 });
    expect(loadAnswer(s, 'tldr|30|savana')).toEqual({ text: 'summary', at: 2000 });
  });

  it('keeps the newest 300 and survives bad or blocked storage', () => {
    const s = mem();
    for (let i = 0; i < 305; i++) saveAnswer(s, `k${i}`, 'x', i);
    expect(loadAnswer(s, 'k0')).toBeNull();
    expect(loadAnswer(s, 'k304')).toEqual({ text: 'x', at: 304 });
    s.setItem('mpv.answers', '{nope');
    expect(loadAnswer(s, 'k304')).toBeNull();
    expect(loadAnswer(null, 'a')).toBeNull();
    expect(() => saveAnswer(null, 'a', 'b')).not.toThrow();
  });
});
