import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  mapGeneratedTagsToFilterOptions,
  type ChannelGeneratedTagItem,
} from '@/src/features/xyne-desks/tickets/utils/map-generated-tags-to-filter-options';

describe('mapGeneratedTagsToFilterOptions', () => {
  it('maps the all-generated-tags catalog payload to category:tag options', () => {
    // Mock of GET /channels/:id/tags-config/all-generated-tags
    const catalog: { tags: ChannelGeneratedTagItem[] } = {
      tags: [
        { category: 'priority', tag: 'high' },
        { category: 'intent', tag: 'refund' },
      ],
    };

    assert.deepEqual(mapGeneratedTagsToFilterOptions(catalog.tags), [
      { id: 'priority:high', label: 'high', subtitle: 'priority' },
      { id: 'intent:refund', label: 'refund', subtitle: 'intent' },
    ]);
  });

  it('skips blank category or tag rows', () => {
    const tags: ChannelGeneratedTagItem[] = [
      { category: 'priority', tag: 'high' },
      { category: '  ', tag: 'empty-category' },
      { category: 'intent', tag: '' },
    ];

    assert.deepEqual(mapGeneratedTagsToFilterOptions(tags), [
      { id: 'priority:high', label: 'high', subtitle: 'priority' },
    ]);
  });

  it('returns an empty list when the catalog has no tags', () => {
    assert.deepEqual(mapGeneratedTagsToFilterOptions([]), []);
  });
});
