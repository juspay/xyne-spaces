import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  mapDeskListItem,
  type MapDeskListItemInput,
} from '@/src/features/xyne-desks/list/utils/map-desk-list-item';

const input = (overrides: Partial<MapDeskListItemInput> = {}): MapDeskListItemInput => ({
  id: 'desk-1',
  name: 'Support',
  type: 'EMAIL',
  description: 'Customer support desk',
  isJoined: true,
  ...overrides,
});

describe('mapDeskListItem', () => {
  it('maps and trims a fully-populated desk', () => {
    assert.deepEqual(mapDeskListItem(input({ name: '  Support  ', description: '  Desk  ' })), {
      id: 'desk-1',
      name: 'Support',
      isJoined: true,
      type: 'EMAIL',
      description: 'Desk',
    });
  });

  it('falls back to the id when the name is missing or blank', () => {
    assert.equal(mapDeskListItem(input({ name: null })).name, 'desk-1');
    assert.equal(mapDeskListItem(input({ name: '   ' })).name, 'desk-1');
  });

  it('defaults the type to EMAIL when absent', () => {
    assert.equal(mapDeskListItem(input({ type: null })).type, 'EMAIL');
    assert.equal(mapDeskListItem(input({ type: 'CHANNEL' })).type, 'CHANNEL');
  });

  it('normalizes empty/whitespace descriptions to null', () => {
    assert.equal(mapDeskListItem(input({ description: '   ' })).description, null);
    assert.equal(mapDeskListItem(input({ description: null })).description, null);
    assert.equal(mapDeskListItem(input({ description: undefined })).description, null);
  });
});
