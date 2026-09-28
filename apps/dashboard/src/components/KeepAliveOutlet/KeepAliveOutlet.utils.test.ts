import { describe, expect, it } from 'vitest';
import type { KeepAlivePane } from './KeepAliveOutlet.types';
import { upsertPane } from './KeepAliveOutlet.utils';

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
