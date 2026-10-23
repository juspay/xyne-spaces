import {
  CUSTOM_CATEGORY_ID,
  EMOJI_PICKER_COLUMNS,
  FREQUENT_CATEGORY_ID,
  ORDERED_EMOJIS,
  STATIC_UNICODE_PICKER_ITEMS,
  type EmojiEntry,
} from './emoji-picker.data';
import { EMOJI_PICKER_HEADER_HEIGHT, EMOJI_PICKER_ROW_HEIGHT } from './emoji-picker.constants';
import type { EmojiPickerItemLayout, PickerListItem } from './emoji-picker.types';

type CustomEmojiListItem = {
  id: string;
  name: string;
};

function chunk<T>(arr: readonly T[], size: number): T[][] {
  if (arr.length === 0) return [];
  const out: T[][] = new Array(Math.ceil(arr.length / size));
  for (let i = 0, j = 0; i < arr.length; i += size, j += 1) {
    out[j] = arr.slice(i, i + size);
  }
  return out;
}

export type BrowseListData = {
  items: PickerListItem[];
  categoryIndices: Record<string, number>;
  categoryIds: string[];
};

export function buildPickerItemLayouts(items: readonly PickerListItem[]): EmojiPickerItemLayout[] {
  let offset = 8;
  return items.map((item, index) => {
    const length = item.kind === 'header' ? EMOJI_PICKER_HEADER_HEIGHT : EMOJI_PICKER_ROW_HEIGHT;
    const layout = { index, length, offset };
    offset += length;
    return layout;
  });
}

export function buildBrowseListItems(
  frequentEmojis: readonly string[],
  customEmojis: readonly CustomEmojiListItem[],
  showCustom: boolean,
): BrowseListData {
  const items: PickerListItem[] = [];
  const categoryIndices: Record<string, number> = {};
  const categoryIds: string[] = [];

  if (frequentEmojis.length > 0) {
    categoryIndices[FREQUENT_CATEGORY_ID] = items.length;
    categoryIds.push(FREQUENT_CATEGORY_ID);
    items.push({
      kind: 'header',
      id: 'h-frequent',
      categoryId: FREQUENT_CATEGORY_ID,
      label: 'Frequently used',
    });

    const frequentEntries: EmojiEntry[] = frequentEmojis.map(emoji => ({
      emoji,
      name: emoji,
      slug: emoji,
    }));
    chunk(frequentEntries, EMOJI_PICKER_COLUMNS).forEach((row, index) => {
      items.push({
        kind: 'emoji-row',
        id: `e-frequent-${index}`,
        row,
      });
    });
  }

  if (showCustom && customEmojis.length > 0) {
    categoryIndices[CUSTOM_CATEGORY_ID] = items.length;
    categoryIds.push(CUSTOM_CATEGORY_ID);
    items.push({
      kind: 'header',
      id: 'h-custom',
      categoryId: CUSTOM_CATEGORY_ID,
      label: 'Custom',
    });

    chunk(customEmojis, EMOJI_PICKER_COLUMNS).forEach((row, index) => {
      items.push({
        kind: 'custom-row',
        id: `c-custom-${index}`,
        row,
      });
    });
  }

  for (const item of STATIC_UNICODE_PICKER_ITEMS) {
    if (item.kind === 'header') {
      categoryIndices[item.categoryId] = items.length;
      categoryIds.push(item.categoryId);
    }
    items.push(item);
  }

  return { items, categoryIndices, categoryIds };
}

export function buildSearchListItems(
  query: string,
  customEmojis: readonly CustomEmojiListItem[],
  showCustom: boolean,
): PickerListItem[] {
  if (query.length === 0) return [];

  const items: PickerListItem[] = [];

  if (showCustom) {
    const filteredCustom = customEmojis.filter(emoji => emoji.name.toLowerCase().includes(query));
    chunk(filteredCustom, EMOJI_PICKER_COLUMNS).forEach((row, index) => {
      items.push({
        kind: 'custom-row',
        id: `s-c-${index}`,
        row,
      });
    });
  }

  const filteredUnicode = ORDERED_EMOJIS.filter(
    emoji => emoji.name.toLowerCase().includes(query) || emoji.slug.toLowerCase().includes(query),
  );
  chunk(filteredUnicode, EMOJI_PICKER_COLUMNS).forEach((row, index) => {
    items.push({
      kind: 'emoji-row',
      id: `s-e-${index}`,
      row,
    });
  });

  return items;
}
