import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { SearchFilterChip, SearchScope } from '@/src/features/global-search/types';
import {
  buildSearchRequest,
  toSearchParams,
  type SearchRequest,
  type SearchRequestInput,
} from '@/src/features/global-search/utils/search-request';
import type { GlobalSearchTab } from '@/src/features/global-search/utils/search-tabs';

const scope: SearchScope = { channelId: 'chan-1', label: 'engineering' };

function from(id: string): SearchFilterChip {
  return { id, label: id, prefix: 'from:', entityType: 'user' };
}

function inside(id: string): SearchFilterChip {
  return { id, label: id, prefix: 'in:', entityType: 'channel' };
}

function input(overrides: Partial<SearchRequestInput> = {}): SearchRequestInput {
  return {
    tab: 'messages',
    query: '',
    chips: [],
    onlyMyChannels: false,
    scope: null,
    ...overrides,
  };
}

function params(overrides: Partial<SearchRequestInput>): Record<string, string> {
  const request = buildSearchRequest(input(overrides));
  assert.ok(request, 'expected a request to be built');
  return toSearchParams(request);
}

describe('global search request', () => {
  describe('empty scoped search', () => {
    it('sends nothing when a scoped screen has just opened', () => {
      assert.equal(buildSearchRequest(input({ scope })), null);
    });

    it('sends nothing for whitespace', () => {
      assert.equal(buildSearchRequest(input({ scope, query: '   ' })), null);
    });

    it('does not let a chip alone start a scoped search', () => {
      assert.equal(buildSearchRequest(input({ scope, chips: [from('u1')] })), null);
    });

    it('does not let the toggle alone start a scoped search', () => {
      assert.equal(buildSearchRequest(input({ scope, onlyMyChannels: true })), null);
    });

    it('searches the locked conversation once there is text', () => {
      const sent = params({ scope, query: 'deploy' });

      assert.equal(sent['q'], 'deploy');
      assert.equal(sent['in'], 'chan-1');
      assert.equal(sent['type'], 'messages');
    });

    it('cannot be escaped by an in: chip the user added', () => {
      const sent = params({ scope, query: 'deploy', chips: [inside('other')] });

      assert.equal(sent['in'], 'chan-1');
    });

    it('drops a toggle left over from an unscoped session', () => {
      const sent = params({ scope, query: 'deploy', onlyMyChannels: true });

      assert.equal(sent['onlyMyChannels'], 'false');
    });

    it('keeps from: chips alongside the scope', () => {
      const sent = params({ scope, query: 'deploy', chips: [from('u1')] });

      assert.equal(sent['from'], 'u1');
      assert.equal(sent['in'], 'chan-1');
    });
  });

  describe('tab-based gating', () => {
    const localTabs: GlobalSearchTab[] = ['chats', 'channels'];
    const remoteTabs: GlobalSearchTab[] = ['messages', 'tickets', 'files', 'calls'];

    for (const tab of localTabs) {
      it(`never sends a request on ${tab}`, () => {
        assert.equal(buildSearchRequest(input({ tab, query: 'deploy' })), null);
        assert.equal(buildSearchRequest(input({ tab, chips: [from('u1')] })), null);
        assert.equal(
          buildSearchRequest(input({ tab, query: 'deploy', chips: [inside('c1')] })),
          null,
        );
      });
    }

    for (const tab of remoteTabs) {
      it(`asks only for ${tab} on the ${tab} tab`, () => {
        const request = buildSearchRequest(input({ tab, query: 'deploy' }));

        assert.equal(request?.category, tab);
      });
    }

    it('sends each category its own type and apps', () => {
      const wire = remoteTabs.map(tab => {
        const sent = params({ tab, query: 'deploy' });
        return [sent['type'], sent['apps']];
      });

      assert.deepEqual(wire, [
        ['messages', 'chat'],
        ['tickets', 'ticket'],
        ['files', 'file'],
        ['calls', 'call'],
      ]);
    });

    it('searches messages in scoped search whatever tab was active', () => {
      const request = buildSearchRequest(input({ tab: 'chats', scope, query: 'deploy' }));

      assert.equal(request?.category, 'messages');
    });

    it('sends nothing with no text and no chips', () => {
      assert.equal(buildSearchRequest(input()), null);
    });

    it('does not treat the toggle alone as a query', () => {
      assert.equal(buildSearchRequest(input({ onlyMyChannels: true })), null);
    });
  });

  describe('filter serialization', () => {
    it('comma-joins several chips of one prefix in the order picked', () => {
      const sent = params({ query: 'deploy', chips: [from('u2'), inside('c1'), from('u1')] });

      assert.equal(sent['from'], 'u2,u1');
      assert.equal(sent['in'], 'c1');
    });

    it('sends from: chips as a participant filter on calls', () => {
      const sent = params({ tab: 'calls', query: 'standup', chips: [from('u1')] });

      assert.equal(sent['withUser'], 'u1');
      assert.equal(sent['from'], undefined);
    });

    it('omits filters that are not set', () => {
      const sent = params({ query: 'deploy' });

      assert.equal(sent['from'], undefined);
      assert.equal(sent['in'], undefined);
      assert.equal(sent['onlyMyChannels'], undefined);
      assert.equal(sent['filterOnly'], undefined);
    });

    it('marks a chip-only search as filter-only', () => {
      const sent = params({ chips: [from('u1')] });

      assert.equal(sent['q'], '');
      assert.equal(sent['filterOnly'], 'true');
    });

    it('does not mark a search with text as filter-only', () => {
      const sent = params({ query: 'deploy', chips: [from('u1')] });

      assert.equal(sent['filterOnly'], undefined);
    });

    it('stops in: from being narrowed to joined channels', () => {
      const sent = params({ query: 'deploy', chips: [inside('c1')] });

      assert.equal(sent['onlyMyChannels'], 'false');
    });

    it('lets the toggle override what in: implies', () => {
      const sent = params({ query: 'deploy', chips: [inside('c1')], onlyMyChannels: true });

      assert.equal(sent['onlyMyChannels'], 'true');
    });

    it('sends the toggle on its own when there is text', () => {
      const sent = params({ query: 'deploy', onlyMyChannels: true });

      assert.equal(sent['onlyMyChannels'], 'true');
    });

    it('asks for one lean page of 25', () => {
      const sent = params({ query: 'deploy' });

      assert.equal(sent['limit'], '25');
      assert.equal(sent['offset'], '0');
      assert.equal(sent['presentationSummary'], 'lean');
    });

    it('trims and strips control characters from the text', () => {
      const sent = params({ query: '  dep\u0000loy  ' });

      assert.equal(sent['q'], 'deploy');
    });

    it('gives equal requests equal params, so they share one cache entry', () => {
      const first = buildSearchRequest(input({ query: 'deploy', chips: [from('u1')] }));
      const second = buildSearchRequest(input({ query: 'deploy ', chips: [from('u1')] }));

      assert.deepEqual(
        toSearchParams(first as SearchRequest),
        toSearchParams(second as SearchRequest),
      );
    });
  });
});
