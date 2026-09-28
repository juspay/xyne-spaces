import { describe, expect, it } from 'vitest';
import type { KeepAlivePane } from './KeepAliveOutlet.types';
import type { Location } from 'react-router-dom';
import { isSameLocation, shallowEqual, upsertPane } from './KeepAliveOutlet.utils';

const pane = (key: string): KeepAlivePane => ({
  key,
  element: null,
  locationContext: {} as KeepAlivePane['locationContext'],
});
const keys = (panes: KeepAlivePane[]): string[] => panes.map(p => p.key);

describe('upsertPane', () => {
  it('appends new panes as most recent', () => {
    expect(keys(upsertPane([pane('a')], pane('b'), 3))).toEqual(['a', 'b']);
  });

  it('moves a revisited pane to the most-recent end without duplicating it', () => {
    expect(keys(upsertPane([pane('a'), pane('b')], pane('a'), 3))).toEqual(['b', 'a']);
  });

  it('evicts the least-recently-active pane past max', () => {
    expect(keys(upsertPane([pane('a'), pane('b'), pane('c')], pane('d'), 3))).toEqual([
      'b',
      'c',
      'd',
    ]);
  });

  it('is idempotent for the newest pane', () => {
    const once = upsertPane([pane('a'), pane('b')], pane('b'), 2);
    expect(keys(upsertPane(once, pane('b'), 2))).toEqual(keys(once));
  });

  it('always keeps at least the active pane', () => {
    expect(keys(upsertPane([pane('a')], pane('b'), 0))).toEqual(['b']);
  });
});

const loc = (overrides: Partial<Location> = {}): Location => ({
  pathname: '/chat/dir/a',
  search: '',
  hash: '',
  state: null,
  key: 'k1',
  ...overrides,
});

describe('isSameLocation', () => {
  it('ignores the per-navigation key', () => {
    expect(isSameLocation(loc(), loc({ key: 'k2' }))).toBe(true);
  });

  it('treats undefined and null state as equal', () => {
    expect(isSameLocation(loc({ state: undefined }), loc({ state: null }))).toBe(true);
  });

  it('detects pathname, search, hash and state changes', () => {
    expect(isSameLocation(loc(), loc({ pathname: '/chat/dir/b' }))).toBe(false);
    expect(isSameLocation(loc(), loc({ search: '?tab=files' }))).toBe(false);
    expect(isSameLocation(loc(), loc({ hash: '#m1' }))).toBe(false);
    expect(isSameLocation(loc(), loc({ state: { from: 'x' } }))).toBe(false);
  });
});

describe('shallowEqual', () => {
  it('compares plain objects by own values', () => {
    expect(shallowEqual({ a: 1 }, { a: 1 })).toBe(true);
    expect(shallowEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(shallowEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it('handles undefined and primitives', () => {
    expect(shallowEqual(undefined, undefined)).toBe(true);
    expect(shallowEqual(undefined, {})).toBe(false);
    expect(shallowEqual(1, 1)).toBe(true);
  });
});
