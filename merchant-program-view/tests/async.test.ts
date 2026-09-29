import { describe, expect, it } from 'vitest';
import { chunk, mapLimit, retryOnce } from '../lib/async';

describe('async helpers', () => {
  it('chunk splits into fixed-size parts', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });

  it('mapLimit keeps order and never exceeds the limit', async () => {
    let active = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6], 2, async n => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise(r => setTimeout(r, 5));
      active -= 1;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50, 60]);
    expect(peak).toBe(2);
  });

  it('retryOnce retries a failure once, then gives up', async () => {
    let n = 0;
    await expect(retryOnce(async () => (++n === 1 ? Promise.reject(new Error('x')) : 'ok'), 1)).resolves.toBe('ok');
    let m = 0;
    await expect(
      retryOnce(async () => {
        m += 1;
        throw new Error('always');
      }, 1),
    ).rejects.toThrow('always');
    expect(m).toBe(2);
  });
});
