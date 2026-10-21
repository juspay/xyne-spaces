import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  EMOJI_PICKER_HEADER_HEIGHT,
  EMOJI_PICKER_ROW_HEIGHT,
} from '@/src/components/emoji-picker/emoji-picker.constants';
import {
  CUSTOM_CATEGORY_ID,
  FREQUENT_CATEGORY_ID,
} from '@/src/components/emoji-picker/emoji-picker.data';
import {
  buildBrowseListItems,
  buildPickerItemLayouts,
  buildSearchListItems,
} from '@/src/components/emoji-picker/emoji-picker.list-builders';

type LayoutInput = Parameters<typeof buildPickerItemLayouts>[0];

const asLayoutInput = (value: unknown): LayoutInput => value as LayoutInput;

describe('buildPickerItemLayouts', () => {
  it('returns an empty array for no items', () => {
    assert.deepEqual(buildPickerItemLayouts(asLayoutInput([])), []);
  });

  it('accumulates offsets using header and row heights', () => {
    const layouts = buildPickerItemLayouts(
      asLayoutInput([{ kind: 'header' }, { kind: 'emoji-row' }, { kind: 'emoji-row' }]),
    );
    assert.deepEqual(layouts, [
      { index: 0, length: EMOJI_PICKER_HEADER_HEIGHT, offset: 8 },
      { index: 1, length: EMOJI_PICKER_ROW_HEIGHT, offset: 8 + EMOJI_PICKER_HEADER_HEIGHT },
      {
        index: 2,
        length: EMOJI_PICKER_ROW_HEIGHT,
        offset: 8 + EMOJI_PICKER_HEADER_HEIGHT + EMOJI_PICKER_ROW_HEIGHT,
      },
    ]);
  });
});

describe('buildSearchListItems', () => {
  it('returns nothing for an empty query', () => {
    assert.deepEqual(buildSearchListItems('', [], true), []);
  });

  it('returns nothing when nothing matches', () => {
    assert.deepEqual(buildSearchListItems('zzzzznomatchzzzzz', [], true), []);
  });

  it('lists matching custom emojis before unicode emojis', () => {
    const items = buildSearchListItems('smile', [{ id: 'c1', name: 'smile_custom' }], true);
    assert.ok(items.length > 0);
    assert.equal(items[0]?.kind, 'custom-row');
    assert.ok(items.every(item => item.kind === 'custom-row' || item.kind === 'emoji-row'));
  });

  it('omits custom emojis when showCustom is false', () => {
    const items = buildSearchListItems('smile', [{ id: 'c1', name: 'smile_custom' }], false);
    assert.ok(items.every(item => item.kind !== 'custom-row'));
  });
});

describe('buildBrowseListItems', () => {
  it('leads with the frequently-used header and its rows', () => {
    const data = buildBrowseListItems(['😀', '😃'], [], false);
    assert.equal(data.items[0]?.kind, 'header');
    assert.equal(data.categoryIndices[FREQUENT_CATEGORY_ID], 0);
    assert.equal(data.categoryIds[0], FREQUENT_CATEGORY_ID);
    assert.equal(data.items[1]?.kind, 'emoji-row');
  });

  it('includes a custom section only when showCustom is true', () => {
    const shown = buildBrowseListItems(['😀'], [{ id: 'c1', name: 'party' }], true);
    assert.ok(shown.categoryIds.includes(CUSTOM_CATEGORY_ID));
    assert.ok(shown.items.some(item => item.kind === 'custom-row'));

    const hidden = buildBrowseListItems(['😀'], [{ id: 'c1', name: 'party' }], false);
    assert.ok(!hidden.categoryIds.includes(CUSTOM_CATEGORY_ID));
    assert.ok(!hidden.items.some(item => item.kind === 'custom-row'));
  });
});
