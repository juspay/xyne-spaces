import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  SEARCH_TABS,
  filterChipTitle,
  fromFilterTitleForTab,
  initialTabForSurface,
  multiSelectChipLabel,
  placeholderForTab,
  tabHrefForSurface,
} from '@/src/features/global-search/utils/search-tabs';
import type {
  GlobalSearchTab,
  SearchSourceSurface,
} from '@/src/features/global-search/utils/search-tabs';
import type { SearchFilterChip } from '@/src/features/global-search/types';

describe('SEARCH_TABS', () => {
  it('lists the six search categories in order, Messages first', () => {
    assert.deepEqual(
      SEARCH_TABS.map(tab => tab.id),
      ['messages', 'chats', 'channels', 'calls', 'tickets', 'files'],
    );
  });

  it('labels the chats tab as DMs and gives every tab a label', () => {
    assert.equal(SEARCH_TABS.find(tab => tab.id === 'chats')?.label, 'DMs');
    for (const tab of SEARCH_TABS) {
      assert.equal(typeof tab.label, 'string');
      assert.ok(tab.label.length > 0);
    }
  });

  it('has a placeholder for every advertised tab id', () => {
    for (const tab of SEARCH_TABS) {
      assert.ok(placeholderForTab(tab.id).startsWith('Search'));
    }
  });
});

describe('initialTabForSurface', () => {
  it('maps each entry surface to its landing tab', () => {
    const expected: Record<SearchSourceSurface, GlobalSearchTab> = {
      dms: 'chats',
      channels: 'channels',
      calls: 'calls',
    };
    for (const [surface, tab] of Object.entries(expected) as [
      SearchSourceSurface,
      GlobalSearchTab,
    ][]) {
      assert.equal(initialTabForSurface(surface), tab);
    }
  });
});

describe('tabHrefForSurface', () => {
  it('maps each surface to its protected tab route', () => {
    assert.equal(tabHrefForSurface('dms'), '/(protected)/(tabs)/dms');
    assert.equal(tabHrefForSurface('channels'), '/(protected)/(tabs)/channels');
    assert.equal(tabHrefForSurface('calls'), '/(protected)/(tabs)/calls');
  });
});

describe('placeholderForTab', () => {
  it('returns a tab-specific prompt for every tab', () => {
    assert.equal(placeholderForTab('chats'), 'Search people and chats');
    assert.equal(placeholderForTab('channels'), 'Search channels');
    assert.equal(placeholderForTab('calls'), 'Search calls');
    assert.equal(placeholderForTab('tickets'), 'Search tickets');
    assert.equal(placeholderForTab('files'), 'Search files');
  });
});

function fromChip(id: string, label: string): SearchFilterChip {
  return { id, label, prefix: 'from:', entityType: 'user' };
}

describe('multiSelectChipLabel', () => {
  it('is bare while nothing is picked', () => {
    assert.equal(multiSelectChipLabel([], 'From'), 'From');
    assert.equal(multiSelectChipLabel([], 'In'), 'In');
  });

  it('keeps naming its filter once something is picked', () => {
    assert.equal(multiSelectChipLabel([fromChip('u1', 'Alice')], 'From'), 'From: Alice');
  });

  it('carries the title through to the overflow form too', () => {
    const chips = [fromChip('u1', 'Alice'), fromChip('u2', 'Bob'), fromChip('u3', 'Cleo')];
    assert.equal(multiSelectChipLabel(chips, 'From'), 'From: Alice +2');
  });

  it('leads with the first chip, so commit order decides the visible name', () => {
    const chips = [fromChip('u2', 'Bob'), fromChip('u1', 'Alice')];
    assert.equal(multiSelectChipLabel(chips, 'From'), 'From: Bob +1');
  });

  it('uses the tab-specific title, so calls read as With', () => {
    const chips = [fromChip('u1', 'Alice')];
    assert.equal(multiSelectChipLabel(chips, fromFilterTitleForTab('calls')), 'With: Alice');
  });
});

describe('filterChipTitle', () => {
  it('names an inline chip exactly as its dropdown badge does', () => {
    assert.equal(filterChipTitle('from:', 'messages'), 'From');
    assert.equal(filterChipTitle('from:', 'calls'), 'With');
  });

  it('always calls the in: filter In, whatever the category', () => {
    for (const tab of ['messages', 'chats', 'channels', 'calls', 'tickets', 'files'] as const) {
      assert.equal(filterChipTitle('in:', tab), 'In');
    }
  });
});

describe('SEARCH_TABS labels', () => {
  it('maps every tab to its category tag label', () => {
    const expected: Record<GlobalSearchTab, string> = {
      messages: 'Messages',
      chats: 'DMs',
      channels: 'Channels',
      calls: 'Calls',
      tickets: 'Tickets',
      files: 'Files',
    };

    for (const [tab, label] of Object.entries(expected)) {
      assert.equal(SEARCH_TABS.find(definition => definition.id === tab)?.label, label);
    }
  });
});

describe('fromFilterTitleForTab', () => {
  it('says With on calls, because from: chips become a participant filter there', () => {
    assert.equal(fromFilterTitleForTab('calls'), 'With');
  });

  it('says From everywhere else', () => {
    for (const tab of ['messages', 'chats', 'channels', 'tickets', 'files'] as const) {
      assert.equal(fromFilterTitleForTab(tab), 'From');
    }
  });
});
