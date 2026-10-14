import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { mapEmailChannelsToListItems } from '@/src/features/xyne-desks/list/utils/map-email-channels-to-list-items';

describe('mapEmailChannelsToListItems', () => {
  it('returns an empty array for null/undefined input', () => {
    assert.deepEqual(mapEmailChannelsToListItems(null, new Set()), []);
    assert.deepEqual(mapEmailChannelsToListItems(undefined, new Set()), []);
  });

  it('skips channels without an id', () => {
    const items = mapEmailChannelsToListItems(
      [
        { id: '', name: 'Ghost' },
        { id: 'c1', name: 'Real' },
      ],
      new Set(),
    );
    assert.equal(items.length, 1);
    assert.equal(items[0]?.id, 'c1');
  });

  it('marks joined channels using the joinedChannelIds set', () => {
    const items = mapEmailChannelsToListItems([{ id: 'c1', name: 'Alpha' }], new Set(['c1']));
    assert.equal(items[0]?.isJoined, true);
  });

  it('sorts joined channels before unjoined ones', () => {
    const items = mapEmailChannelsToListItems(
      [
        { id: 'c1', name: 'Zeta' },
        { id: 'c2', name: 'Alpha' },
      ],
      new Set(['c1']),
    );
    // c1 is joined, so it wins over the alphabetically-earlier unjoined c2.
    assert.deepEqual(
      items.map(i => i.id),
      ['c1', 'c2'],
    );
  });

  it('sorts by name within the same joined group', () => {
    const items = mapEmailChannelsToListItems(
      [
        { id: 'c1', name: 'Bravo' },
        { id: 'c2', name: 'Alpha' },
      ],
      new Set(),
    );
    assert.deepEqual(
      items.map(i => i.name),
      ['Alpha', 'Bravo'],
    );
  });
});
