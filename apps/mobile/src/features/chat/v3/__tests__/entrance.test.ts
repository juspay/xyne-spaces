import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { EMPTY_ENTRANCE, flushEntrance, seedEntrance, trackEntrance } from '../model/entrance';

describe('entrance', (): void => {
  it('does not animate the rows present when the list is first revealed', (): void => {
    const seeded = seedEntrance(['a', 'b']);
    const next = trackEntrance(seeded, ['a', 'b']);
    assert.deepEqual([...next.pending], []);
    assert.equal(next, seeded);
  });

  it('animates only messages appended after the previously known tail', (): void => {
    const seeded = seedEntrance(['a', 'b']);
    const next = trackEntrance(seeded, ['a', 'b', 'c']);
    assert.deepEqual([...next.pending], ['c']);
    const flushed = flushEntrance(next);
    assert.deepEqual([...flushed.pending], []);
    assert.equal(trackEntrance(flushed, ['a', 'b', 'c']), flushed);
  });

  it('does not animate older messages prepended during pagination', (): void => {
    const seeded = seedEntrance(['b', 'c']);
    const next = trackEntrance(seeded, ['a', 'b', 'c']);
    assert.deepEqual([...next.pending], []);
  });

  it('does not animate when a cache window replacement removes the old tail', (): void => {
    const seeded = seedEntrance(['a', 'b']);
    const next = trackEntrance(seeded, ['c', 'd']);
    assert.deepEqual([...next.pending], []);
    assert.deepEqual([...next.seen], ['c', 'd']);
  });

  it('stays empty until the first reveal', (): void => {
    assert.equal(trackEntrance(EMPTY_ENTRANCE, ['a']), EMPTY_ENTRANCE);
  });
});

describe('RowEntrance wiring', (): void => {
  it('uses the list recycling hook for recycled cells', (): void => {
    const source = readFileSync(new URL('../rows/RowEntrance.tsx', import.meta.url), 'utf8');
    assert.match(source, /useRecyclingEffect/);
    assert.doesNotMatch(source, /useEffect\([\s\S]*conversationId/);
  });
});
