import { describe, expect, it } from 'vitest';
import { pageWindow, pillSummary, selectAll, threadLines } from '../lib/ui';

describe('threadLines', () => {
  it('draws nothing for a root without children', () => {
    expect(threadLines(0, [], true, false, 18)).toEqual([]);
  });

  it('drops a rail below a root that has children', () => {
    expect(threadLines(0, [], true, true, 18)).toEqual([{ l: '16.25px', t: '28px', h: 'calc(100% - 28px)', w: '0', bb: 'none', r: '0' }]);
  });

  it('draws an elbow into a child, and continues the rail past a child that is not last', () => {
    const mid = threadLines(1, [], false, false, 18);
    expect(mid).toEqual([
      { l: '16.25px', t: '0', h: '18px', w: '14px', bb: '1.5px solid var(--t6)', r: '7px' },
      { l: '16.25px', t: '18px', h: 'calc(100% - 18px)', w: '0', bb: 'none', r: '0' },
    ]);
    expect(threadLines(1, [], true, false, 18)).toHaveLength(1);
  });

  it('keeps ancestor rails that continue past this row', () => {
    const lines = threadLines(2, [true], true, false, 18);
    expect(lines[0]).toEqual({ l: '16.25px', t: '0', h: '100%', w: '0', bb: 'none', r: '0' });
    expect(lines[1]).toMatchObject({ l: '40.25px', h: '18px', w: '14px' });
  });

  it('shifts every line right when the tree starts after leading columns', () => {
    expect(threadLines(0, [], true, true, 18, 138)).toEqual([{ l: '144.25px', t: '28px', h: 'calc(100% - 28px)', w: '0', bb: 'none', r: '0' }]);
    const lines = threadLines(2, [true], false, false, 18, 138);
    expect(lines.map(l => l.l)).toEqual(['144.25px', '168.25px', '168.25px']);
    expect(lines[1]).toMatchObject({ h: '18px', w: '14px' });
  });
});

describe('pageWindow', () => {
  it('lists every page when there are few', () => {
    expect(pageWindow(2, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it('shows the ends and a window around the current page, with gaps', () => {
    expect(pageWindow(1, 104)).toEqual([1, 2, 3, null, 104]);
    expect(pageWindow(50, 104)).toEqual([1, null, 49, 50, 51, null, 104]);
    expect(pageWindow(104, 104)).toEqual([1, null, 102, 103, 104]);
    expect(pageWindow(3, 104)).toEqual([1, 2, 3, 4, null, 104]);
  });
});

describe('selectAll', () => {
  it('adds every shown option that is not picked yet, keeping earlier picks', () => {
    expect(selectAll(['a', 'b', 'c'], ['x', 'b'])).toEqual({ all: false, next: ['x', 'b', 'a', 'c'] });
  });

  it('unpicks just the shown options once they are all picked', () => {
    expect(selectAll(['a', 'b'], ['x', 'a', 'b'])).toEqual({ all: true, next: ['x'] });
  });

  it('treats an empty list as nothing to select', () => {
    expect(selectAll([], ['x'])).toEqual({ all: false, next: ['x'] });
  });
});

describe('pillSummary', () => {
  const opts = ['a', 'b', 'c'];
  it('shows nothing when nothing is picked', () => {
    expect(pillSummary([], opts, 2)).toEqual({ kind: 'none' });
  });
  it('names picks up to the limit, then shows a count', () => {
    expect(pillSummary(['a'], opts, 1)).toEqual({ kind: 'names', values: ['a'] });
    expect(pillSummary(['a', 'b'], opts, 1)).toEqual({ kind: 'count', n: 2 });
    expect(pillSummary(['a', 'b'], opts, 2)).toEqual({ kind: 'names', values: ['a', 'b'] });
  });
  it('says All when every option is picked', () => {
    expect(pillSummary(['a', 'b', 'c'], opts, 1)).toEqual({ kind: 'all' });
    expect(pillSummary(['a'], ['a'], 1)).toEqual({ kind: 'names', values: ['a'] });
  });
});
