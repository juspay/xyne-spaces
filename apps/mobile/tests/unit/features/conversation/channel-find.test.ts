import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  channelFindRequest,
  findCountLabel,
  findResultTime,
  findViewOf,
} from '@/src/features/conversation/model/channel-find';
import { toSearchParams } from '@/src/features/global-search/utils/search-request';

const scope = { channelId: 'chan-1', label: '#payments-core' };

describe('channelFindRequest', () => {
  it('sends nothing for an empty or blank query', () => {
    assert.equal(channelFindRequest('', scope), null);
    assert.equal(channelFindRequest('   ', scope), null);
  });

  it('searches messages in this channel only', () => {
    const request = channelFindRequest('refund', scope);
    assert.ok(request);
    const params = toSearchParams(request);
    assert.equal(request.category, 'messages');
    assert.equal(request.freeText, 'refund');
    assert.equal(request.exactMatch, false);
    assert.deepEqual(
      request.chips.map(chip => [chip.prefix, chip.id]),
      [['in:', 'chan-1']],
    );
    assert.equal(params['in'], 'chan-1');
  });

  it('asks for an exact phrase while the query is quoted', () => {
    assert.equal(channelFindRequest('"refund email"', scope)?.exactMatch, true);
    assert.equal(channelFindRequest('refund email', scope)?.exactMatch, false);
  });
});

describe('findViewOf', () => {
  it('draws nothing until there is a query', () => {
    assert.equal(findViewOf('', 'idle', 0), 'hidden');
    assert.equal(findViewOf('  ', 'success', 3), 'hidden');
  });

  it('keeps the last rows while the next query loads', () => {
    assert.equal(findViewOf('ref', 'loading', 0), 'loading');
    assert.equal(findViewOf('refund', 'loading', 4), 'results');
  });

  it('tells no matches from an error', () => {
    assert.equal(findViewOf('zzz', 'success', 0), 'empty');
    assert.equal(findViewOf('refund', 'error', 4), 'error');
    assert.equal(findViewOf('refund', 'success', 4), 'results');
  });
});

describe('findCountLabel', () => {
  it('counts messages', () => {
    assert.equal(findCountLabel(1, false), '1 message');
    assert.equal(findCountLabel(4, false), '4 messages');
  });

  it('marks a count with more pages to load', () => {
    assert.equal(findCountLabel(25, true), '25+ messages');
  });
});

describe('findResultTime', () => {
  // Built inside each test, as its other dates are: other test files pin TZ when they load.
  const now = (): number => new Date(2026, 10, 24, 16, 0).getTime();

  it('writes a clock for today', () => {
    assert.equal(findResultTime(new Date(2026, 10, 24, 9, 49).getTime(), now()), '9:49 am');
    assert.equal(findResultTime(new Date(2026, 10, 24, 0, 5).getTime(), now()), '12:05 am');
    assert.equal(findResultTime(new Date(2026, 10, 24, 12, 30).getTime(), now()), '12:30 pm');
  });

  it('leads with the day earlier this year, and a date alone for other years', () => {
    assert.equal(findResultTime(new Date(2026, 9, 12, 14, 40).getTime(), now()), '12 Oct, 2:40 pm');
    assert.equal(findResultTime(new Date(2025, 2, 3, 10, 0).getTime(), now()), '3 Mar 2025');
  });

  it('writes nothing without a time', () => {
    assert.equal(findResultTime(undefined, now()), '');
    assert.equal(findResultTime(0, now()), '');
    assert.equal(findResultTime(Number.NaN, now()), '');
  });
});
