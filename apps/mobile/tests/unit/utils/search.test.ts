import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildDefaultSearchParams,
  buildVespaSearchParams,
  sanitizeSearchQuery,
} from '@/src/utils/search';
import { SearchableEntityType } from '@/src/types/search';
import type { GlobalSearchFilters, VespaSearchFilters } from '@/src/types/search';

describe('sanitizeSearchQuery', () => {
  it('trims surrounding whitespace', () => {
    assert.equal(sanitizeSearchQuery('  hello  '), 'hello');
  });

  it('removes control characters', () => {
    assert.equal(sanitizeSearchQuery('a\u0000b\u001Fc\u007Fd'), 'abcd');
  });

  it('truncates to 500 characters', () => {
    assert.equal(sanitizeSearchQuery('a'.repeat(600)).length, 500);
  });
});

describe('buildDefaultSearchParams', () => {
  it('includes only the query for a minimal filter', () => {
    const filters: GlobalSearchFilters = { query: 'hi' };
    assert.deepEqual(buildDefaultSearchParams(filters), { query: 'hi' });
  });

  it('serializes list, numeric and object fields', () => {
    const filters: GlobalSearchFilters = {
      query: 'hi',
      entityTypes: [SearchableEntityType.USERS, SearchableEntityType.MESSAGES],
      channelIds: ['c1', 'c2'],
      page: 2,
      limit: 10,
    };
    const params = buildDefaultSearchParams(filters);
    assert.equal(params['query'], 'hi');
    assert.equal(params['entityTypes'], 'users,messages');
    assert.equal(params['channelIds'], 'c1,c2');
    assert.equal(params['page'], '2');
    assert.equal(params['limit'], '10');
  });
});

describe('buildVespaSearchParams', () => {
  it('maps query to q and keeps only provided fields', () => {
    const filters: VespaSearchFilters = { query: 'hi' };
    assert.deepEqual(buildVespaSearchParams(filters), { q: 'hi' });
  });

  it('maps with -> withUser and stringifies zero/false correctly', () => {
    const filters: VespaSearchFilters = {
      query: 'q',
      with: 'bob',
      offset: 0,
      onlyMyChannels: false,
    };
    const params = buildVespaSearchParams(filters);
    assert.equal(params['q'], 'q');
    assert.equal(params['withUser'], 'bob');
    assert.equal(params['offset'], '0');
    assert.equal(params['onlyMyChannels'], 'false');
  });

  it('serializes onlyMyChannels true for the "Only my channels" toggle', () => {
    const filters: VespaSearchFilters = { query: 'q', onlyMyChannels: true };
    assert.equal(buildVespaSearchParams(filters)['onlyMyChannels'], 'true');
  });
});
