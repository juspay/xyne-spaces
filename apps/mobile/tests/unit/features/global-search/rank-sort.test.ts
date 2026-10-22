import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DEFAULT_STRUCTURED_FILTERS } from '@/src/features/global-search/utils/filter-model';
import {
  DEFAULT_RANK_PROFILE,
  DEFAULT_SORT_BY,
  effectiveRankProfile,
  getRankProfileOptions,
  isRankActive,
  isSortActive,
  rankDocTypeForTab,
  rankLabel,
  SORT_OPTIONS,
  sortLabel,
} from '@/src/features/global-search/utils/rank-sort';
import {
  buildSearchRequest,
  toSearchParams,
} from '@/src/features/global-search/utils/search-request';

describe('global search rank and sort', () => {
  describe('options and labels', () => {
    it('exposes Relevance / Newest / Oldest', () => {
      assert.deepEqual(
        SORT_OPTIONS.map(option => option.value),
        ['relevance', 'newest', 'oldest'],
      );
      assert.equal(sortLabel('relevance'), 'Relevance');
      assert.equal(sortLabel('newest'), 'Newest');
      assert.equal(sortLabel('oldest'), 'Oldest');
    });

    it('treats only non-default sort/rank as active (Filters badge)', () => {
      assert.equal(isSortActive(DEFAULT_SORT_BY), false);
      assert.equal(isSortActive('newest'), true);
      assert.equal(isSortActive('oldest'), true);

      assert.equal(isRankActive(DEFAULT_RANK_PROFILE), false);
      assert.equal(isRankActive('personalized'), true);
    });

    it('maps tabs onto the correct rank schema set', () => {
      assert.equal(rankDocTypeForTab('messages'), 'messages');
      assert.equal(rankDocTypeForTab('calls'), 'messages');
      assert.equal(rankDocTypeForTab('chats'), 'messages');
      assert.equal(rankDocTypeForTab('channels'), 'messages');
      assert.equal(rankDocTypeForTab('tickets'), 'tickets');
      assert.equal(rankDocTypeForTab('files'), 'files');
    });

    it('prepends the default row (value "") labeled default_native', () => {
      const options = getRankProfileOptions('messages');
      assert.equal(options[0]?.value, '');
      assert.equal(options[0]?.label, 'default_native');
      assert.ok(options.some(option => option.value === 'personalized'));
      assert.ok(
        !options.some(option => option.value === 'default_native' && option !== options[0]),
      );
    });

    it('offers ticket- and file-specific rank profiles', () => {
      const tickets = getRankProfileOptions('tickets');
      assert.ok(tickets.some(option => option.value === 'semantic_ranking'));

      const files = getRankProfileOptions('files');
      assert.ok(files.some(option => option.value === 'default_fuzzy'));
      assert.ok(!files.some(option => option.value === 'semantic_ranking'));
    });

    it('labels the empty rank pick as the tab default', () => {
      assert.equal(rankLabel('messages', ''), 'default_native');
      assert.equal(rankLabel('messages', 'personalized'), 'personalized');
      assert.equal(rankLabel('messages', 'custom_unknown'), 'custom_unknown');
    });
  });

  describe('Vespa request wiring', () => {
    it('sends orderBy and effective rankProfile on the Vespa request', () => {
      const request = buildSearchRequest({
        tab: 'messages',
        query: 'deploy',
        chips: [],
        structured: DEFAULT_STRUCTURED_FILTERS,
        onlyMyChannels: false,
        includeBotMessages: false,
        exactMatch: false,
        sortBy: 'newest',
        rankProfile: 'personalized',
        scope: null,
      });
      assert.ok(request);
      assert.equal(request.sortBy, 'newest');
      assert.equal(request.rankProfile, 'personalized');
      assert.equal(request.tab, 'messages');

      const params = toSearchParams(request);
      assert.equal(params['orderBy'], 'newest');
      assert.equal(params['rankProfile'], 'personalized');
    });

    it('omits orderBy for Relevance and omits unset rankProfile', () => {
      assert.equal(effectiveRankProfile('tickets', ''), 'default_native');

      const request = buildSearchRequest({
        tab: 'tickets',
        query: 'billing',
        chips: [],
        sortBy: 'relevance',
        rankProfile: '',
        onlyMyChannels: false,
        includeBotMessages: false,
        exactMatch: false,
        scope: null,
      });
      assert.ok(request);
      const params = toSearchParams(request);
      assert.equal(params['rankProfile'], undefined);
      assert.equal(params['orderBy'], undefined);
    });

    it('sends orderBy=oldest when Oldest is selected', () => {
      const params = toSearchParams(
        buildSearchRequest({
          tab: 'files',
          query: 'pdf',
          chips: [],
          sortBy: 'oldest',
          rankProfile: '',
          onlyMyChannels: false,
          includeBotMessages: false,
          exactMatch: false,
          scope: null,
        })!,
      );
      assert.equal(params['orderBy'], 'oldest');
      assert.equal(params['rankProfile'], undefined);
    });

    it('does not treat sort/rank alone as enough to search', () => {
      assert.equal(
        buildSearchRequest({
          tab: 'messages',
          query: '',
          chips: [],
          sortBy: 'newest',
          rankProfile: 'personalized',
          onlyMyChannels: false,
          includeBotMessages: false,
          exactMatch: false,
          scope: null,
        }),
        null,
      );
    });

    it('uses messages tab for rank defaults in scoped search', () => {
      const request = buildSearchRequest({
        tab: 'tickets',
        query: 'hello',
        chips: [],
        sortBy: 'newest',
        rankProfile: '',
        onlyMyChannels: false,
        includeBotMessages: false,
        exactMatch: false,
        scope: { channelId: 'c1', label: 'eng' },
      });
      assert.ok(request);
      assert.equal(request.tab, 'messages');
      assert.equal(request.category, 'messages');
      assert.equal(toSearchParams(request)['rankProfile'], undefined);
      assert.equal(toSearchParams(request)['orderBy'], 'newest');
    });
  });
});
