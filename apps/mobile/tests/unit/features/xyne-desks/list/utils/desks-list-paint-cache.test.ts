import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import {
  clearDesksPaintCache,
  getDesksPaintCache,
  setDesksPaintCache,
} from '@/src/features/xyne-desks/list/utils/desks-list-paint-cache';

type DeskItems = Parameters<typeof setDesksPaintCache>[1];

const items = (...markers: string[]): DeskItems =>
  markers.map(marker => ({ marker })) as unknown as DeskItems;

describe('desks-list-paint-cache', () => {
  beforeEach(() => {
    clearDesksPaintCache();
  });

  it('returns an empty array before anything is cached', () => {
    assert.deepEqual(getDesksPaintCache('s1'), []);
  });

  it('returns an empty array for an empty session key', () => {
    assert.deepEqual(getDesksPaintCache(''), []);
  });

  it('stores and returns the exact array reference', () => {
    const list = items('a', 'b');
    setDesksPaintCache('s1', list);
    assert.equal(getDesksPaintCache('s1'), list);
  });

  it('ignores writes with an empty session key', () => {
    setDesksPaintCache('', items('a'));
    assert.deepEqual(getDesksPaintCache(''), []);
  });

  it('ignores writes with an empty items array', () => {
    setDesksPaintCache('s1', items());
    assert.deepEqual(getDesksPaintCache('s1'), []);
  });

  it('keeps separate lists per session', () => {
    const a = items('a');
    const b = items('b', 'c');
    setDesksPaintCache('s1', a);
    setDesksPaintCache('s2', b);
    assert.equal(getDesksPaintCache('s1'), a);
    assert.equal(getDesksPaintCache('s2'), b);
  });

  it('clears everything when called with no session key', () => {
    setDesksPaintCache('s1', items('a'));
    setDesksPaintCache('s2', items('b'));
    clearDesksPaintCache();
    assert.deepEqual(getDesksPaintCache('s1'), []);
    assert.deepEqual(getDesksPaintCache('s2'), []);
  });

  it('clears only the named session', () => {
    setDesksPaintCache('s1', items('a'));
    setDesksPaintCache('s2', items('b'));
    clearDesksPaintCache('s1');
    assert.deepEqual(getDesksPaintCache('s1'), []);
    assert.notDeepEqual(getDesksPaintCache('s2'), []);
  });
});
