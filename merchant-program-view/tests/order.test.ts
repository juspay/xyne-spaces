import { describe, expect, it } from 'vitest';
import { DEFAULT_ORDER, fromLegacy } from '../lib/order';

describe('DEFAULT_ORDER', () => {
  it('is oldest first', () => {
    expect(DEFAULT_ORDER).toEqual({ col: 'age', dir: 'desc' });
  });
});

describe('fromLegacy', () => {
  it('maps the old "first, then" order onto a column and direction', () => {
    expect(fromLegacy('oldest')).toEqual({ col: 'age', dir: 'desc' });
    expect(fromLegacy('newest')).toEqual({ col: 'age', dir: 'asc' });
    expect(fromLegacy('priority')).toEqual({ col: 'priority', dir: 'desc' });
    expect(fromLegacy('stale')).toEqual({ col: 'updated', dir: 'desc' });
    expect(fromLegacy('recent')).toEqual({ col: 'updated', dir: 'asc' });
    expect(fromLegacy('nope')).toBeNull();
  });
});
