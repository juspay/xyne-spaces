import { describe, expect, it } from 'vitest';
import { pageWindow, threadLines } from '../lib/ui';

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
