import { describe, expect, it } from 'vitest';
import { claimEntrance } from './createMotion';

describe('claimEntrance', () => {
  it('spaces entrances that land together and never holds back a lone one', () => {
    const t = 1_000;
    // A burst: each one starts a gap after the one before.
    expect(claimEntrance(0.12, t)).toBe(0);
    expect(claimEntrance(0.12, t)).toBeCloseTo(0.12);
    expect(claimEntrance(0.06, t)).toBeCloseTo(0.24);
    // Later, with the queue drained, the next one starts at once.
    expect(claimEntrance(0.12, t + 5)).toBe(0);
  });

  it('caps the wait however much lands at once', () => {
    const t = 2_000;
    for (let i = 0; i < 40; i += 1) claimEntrance(0.12, t);
    expect(claimEntrance(0.12, t)).toBeCloseTo(1.2);
  });
});
