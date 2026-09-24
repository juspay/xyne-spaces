import { Categories, type CategoryConfig } from 'emoji-picker-react';

/**
 * Picker categories with the library's own "suggested" row removed.
 *
 * `emoji-picker-react` renders a built-in Frequently Used category by default, counted only
 * from clicks inside its grid. Spaces counts every reaction surface and can rank custom
 * emojis, so leaving both on shows the same heading twice with lists that drift apart.
 * Our row is the one source of truth; the library's is switched off here.
 */
export const EMOJI_PICKER_CATEGORIES: CategoryConfig[] = [
  { category: Categories.CUSTOM, name: 'Custom Emojis' },
  { category: Categories.SMILEYS_PEOPLE, name: 'Smileys & People' },
  { category: Categories.ANIMALS_NATURE, name: 'Animals & Nature' },
  { category: Categories.FOOD_DRINK, name: 'Food & Drink' },
  { category: Categories.TRAVEL_PLACES, name: 'Travel & Places' },
  { category: Categories.ACTIVITIES, name: 'Activities' },
  { category: Categories.OBJECTS, name: 'Objects' },
  { category: Categories.SYMBOLS, name: 'Symbols' },
  { category: Categories.FLAGS, name: 'Flags' },
];
