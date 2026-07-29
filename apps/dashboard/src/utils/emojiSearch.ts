import type { EmojiPickerEmoji } from '../hooks/useCustomEmojis';

export interface EmojiSearchResult {
  id: string;
  shortName: string;
  allNames: string[];
  unified?: string;
  native?: string;
  customImgUrl?: string;
  customEmojiId?: string;
  isCustom: boolean;
}

export function unifiedToNative(unified: string): string {
  return unified
    .split('-')
    .map(code => String.fromCodePoint(parseInt(code, 16)))
    .join('');
}

let unicodeIndex: EmojiSearchResult[] | null = null;

async function getUnicodeIndex(): Promise<EmojiSearchResult[]> {
  if (!unicodeIndex) {
    const { default: emojiData } = await import('emoji-datasource/emoji.json');
    unicodeIndex = emojiData.map(entry => ({
      id: entry.short_name,
      shortName: entry.short_name,
      allNames: entry.short_names,
      unified: entry.unified,
      native: unifiedToNative(entry.unified),
      isCustom: false,
    }));
  }
  return unicodeIndex;
}

export async function searchEmojis(
  query: string,
  customEmojis: EmojiPickerEmoji[],
  maxResults: number = 8,
): Promise<EmojiSearchResult[]> {
  const lowerQuery = query.toLowerCase();
  if (lowerQuery.length < 2) return [];

  const results: EmojiSearchResult[] = [];

  // Search custom emojis first
  for (const ce of customEmojis) {
    if (results.length >= maxResults) break;
    const matches = ce.names.some(n => n.toLowerCase().startsWith(lowerQuery));
    if (matches && ce.names.length > 0) {
      results.push({
        id: `custom-${ce.id}`,
        shortName: ce.names[0]!,
        allNames: ce.names,
        customImgUrl: ce.imgUrl,
        customEmojiId: ce.id,
        isCustom: true,
      });
    }
  }

  if (results.length >= maxResults) return results;

  // Search unicode emojis: prefix matches first, then substring matches
  const unicode = await getUnicodeIndex();
  const prefixMatches: EmojiSearchResult[] = [];
  const containsMatches: EmojiSearchResult[] = [];

  for (const entry of unicode) {
    const hasPrefix = entry.allNames.some(n => n.startsWith(lowerQuery));
    if (hasPrefix) {
      prefixMatches.push(entry);
    } else {
      const hasContains = entry.allNames.some(n => n.includes(lowerQuery));
      if (hasContains) {
        containsMatches.push(entry);
      }
    }
    // Early exit once we have enough candidates
    if (prefixMatches.length + containsMatches.length >= maxResults * 3) break;
  }

  const remaining = maxResults - results.length;
  results.push(...prefixMatches.slice(0, remaining));
  if (results.length < maxResults) {
    results.push(...containsMatches.slice(0, maxResults - results.length));
  }

  return results;
}
