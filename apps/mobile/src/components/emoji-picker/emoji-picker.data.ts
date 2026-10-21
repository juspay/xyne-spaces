export type EmojiCategory = {
  id: string;
  label: string;
  icon: string;
  emojis: EmojiEntry[];
};

export type EmojiEntry = {
  emoji: string;
  name: string;
  slug: string;
};

type UnicodeEmoji = {
  emoji: string;
  name: string;
  slug: string;
};

type UnicodeEmojiGroup = {
  name: string;
  slug: string;
  emojis: UnicodeEmoji[];
};

import unicodeEmojiGroups from 'unicode-emoji-json/data-by-group.json';

const CATEGORY_ICONS: Record<string, string> = {
  smileys_emotion: '😀',
  people_body: '🙌',
  animals_nature: '🌿',
  food_drink: '🍔',
  travel_places: '🚗',
  activities: '⚽',
  objects: '💡',
  symbols: '❤️',
  flags: '🏳️',
};

const groups = unicodeEmojiGroups as UnicodeEmojiGroup[];

export const EMOJI_CATEGORIES: EmojiCategory[] = groups
  .map(group => ({
    id: group.slug,
    label: group.name,
    icon: CATEGORY_ICONS[group.slug] ?? group.emojis[0]?.emoji ?? '🙂',
    emojis: group.emojis.map(emoji => ({
      emoji: emoji.emoji,
      name: emoji.name,
      slug: emoji.slug,
    })),
  }))
  .filter(category => category.emojis.length > 0);

export const ORDERED_EMOJIS: EmojiEntry[] = Array.from(
  new Map(
    EMOJI_CATEGORIES.flatMap(category =>
      category.emojis.map(emoji => [emoji.emoji, emoji] as const),
    ),
  ).values(),
);

export const EMOJI_PICKER_COLUMNS = 8;
export const FREQUENT_CATEGORY_ID = 'frequent';
export const CUSTOM_CATEGORY_ID = 'custom';

function chunkEmojis<T>(arr: readonly T[], size: number): T[][] {
  if (arr.length === 0) return [];
  const out: T[][] = new Array(Math.ceil(arr.length / size));
  for (let i = 0, j = 0; i < arr.length; i += size, j += 1) {
    out[j] = arr.slice(i, i + size);
  }
  return out;
}

type StaticPickerListItem =
  | {
      kind: 'header';
      id: string;
      categoryId: string;
      label: string;
    }
  | {
      kind: 'emoji-row';
      id: string;
      row: EmojiEntry[];
    };

function buildStaticUnicodePickerItems(): StaticPickerListItem[] {
  const items: StaticPickerListItem[] = [];

  for (const category of EMOJI_CATEGORIES) {
    items.push({
      kind: 'header',
      id: `h-${category.id}`,
      categoryId: category.id,
      label: category.label,
    });

    chunkEmojis(category.emojis, EMOJI_PICKER_COLUMNS).forEach((row, index) => {
      items.push({
        kind: 'emoji-row',
        id: `e-${category.id}-${index}`,
        row,
      });
    });
  }

  return items;
}

/** Pre-chunked unicode sections — built once at module load for list performance. */
export const STATIC_UNICODE_PICKER_ITEMS = buildStaticUnicodePickerItems();
