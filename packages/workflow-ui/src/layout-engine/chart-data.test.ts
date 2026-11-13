import { describe, expect, it } from 'vitest';
import { chartPoints, resolveChart } from './chart-data.js';

// The real campaign step's output shapes — the reason the contract is written
// the way it is.
const funnel = [
  { stage: 'Eligible (matched rules)', count: 260 },
  { stage: 'Contactable', count: 221 },
  { stage: 'Total activated', count: 80 },
];
const segments = [
  { segment: 'Dormant', contactable: 142, activated: 33, activationRate: '23.2%' },
  { segment: 'Low usage', contactable: 79, activated: 47, activationRate: '59.5%' },
];

describe('resolveChart — the contract', () => {
  it('needs no props when the data matches: one text column, one numeric', () => {
    const r = resolveChart(funnel);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.xKey).toBe('stage');
    expect(r.yKey).toBe('count');
  });

  it('counts a numeric string as numeric — drivers and JSON stringify numbers', () => {
    const r = resolveChart([{ stage: 'A', count: '260' }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.yKey).toBe('count');
  });

  it('does NOT count a formatted number as numeric', () => {
    // '23.2%' is text; plotting it would give a NaN axis. Name the category
    // explicitly so this asserts the *numeric* rule and not the text one —
    // otherwise both columns are text and it fails on ambiguity first.
    const r = resolveChart([{ stage: 'A', rate: '23.2%' }], 'stage');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('numeric');
  });

  it('one stray label makes the whole column text', () => {
    const r = resolveChart([{ k: 'A', v: 1 }, { k: 'B', v: 'n/a' }]);
    expect(r.ok).toBe(false);
  });
});

describe('resolveChart — ambiguity is an error, never a guess', () => {
  // The guard that matters: a guess would resolve by key insertion order, so
  // reordering keys in the emitting step would silently plot a different axis.
  it('refuses two text columns and names them', () => {
    const r = resolveChart(segments);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain('segment');
      expect(r.message).toContain('activationRate');
      expect(r.message).toContain('x=');
    }
  });

  it('refuses two numeric columns and names them', () => {
    const r = resolveChart(segments, 'segment');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain('contactable');
      expect(r.message).toContain('activated');
      expect(r.message).toContain('y=');
    }
  });

  it('resolves once both are named', () => {
    const r = resolveChart(segments, 'segment', 'activated');
    expect(r.ok).toBe(true);
    if (r.ok) expect([r.xKey, r.yKey]).toEqual(['segment', 'activated']);
  });

  it('key order does not decide the axis — the same data resolves the same way', () => {
    const reordered = segments.map((s) => ({
      activationRate: s.activationRate,
      activated: s.activated,
      segment: s.segment,
      contactable: s.contactable,
    }));
    // Still refused, rather than silently picking activationRate as the axis.
    expect(resolveChart(reordered).ok).toBe(false);
    expect(resolveChart(reordered, 'segment', 'activated')).toMatchObject({
      ok: true,
      xKey: 'segment',
      yKey: 'activated',
    });
  });
});

describe('resolveChart — violations', () => {
  it.each([
    ['a non-array', 'not an array' as unknown, 'array'],
    ['an empty array', [] as unknown, 'No data'],
    ['rows that are not objects', [1, 2, 3] as unknown, 'No data'],
  ])('reports %s', (_label, data, expected) => {
    const r = resolveChart(data);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain(expected);
  });

  it('reports an unknown column rather than falling back', () => {
    const r = resolveChart(funnel, 'nope');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('nope');
  });

  it('refuses a non-numeric y even when named explicitly', () => {
    const r = resolveChart(segments, 'segment', 'activationRate');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('not numeric');
  });
});

describe('chartPoints', () => {
  it('preserves array order — a funnel IS its order', () => {
    const r = resolveChart(funnel);
    if (!r.ok) throw new Error(r.message);
    expect(chartPoints(r.rows, r.xKey, r.yKey).map((p) => p.value)).toEqual([260, 221, 80]);
  });

  it('makes a missing value a gap, not a zero', () => {
    // A zero is a claim about the data; absence is not.
    const rows = [{ k: 'A', v: 5 }, { k: 'B' }, { k: 'C', v: null }];
    const pts = chartPoints(rows, 'k', 'v');
    expect(pts.map((p) => p.value)).toEqual([5, null, null]);
  });

  it('coerces numeric strings so the axis is numeric', () => {
    expect(chartPoints([{ k: 'A', v: '260' }], 'k', 'v')[0]?.value).toBe(260);
  });
});
