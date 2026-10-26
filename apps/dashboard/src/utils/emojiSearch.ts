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

/**
 * The token this result is tracked under by the frequent-emoji store — the same format the
 * reaction layer records (a unicode char, or `custom:<emojiId>:<name>`), so the colon flow
 * and reactions feed one ranking. The custom name is the emoji's first alias, matching the
 * reaction token even when the user picked the emoji by one of its other aliases.
 */
export function emojiUsageToken(emoji: EmojiSearchResult): string {
  if (emoji.isCustom && emoji.customEmojiId) {
    return `custom:${emoji.customEmojiId}:${emoji.shortName}`;
  }
  return emoji.native ?? '';
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

/**
 * `usageRanks` maps a frequent-emoji token (see `emojiUsageToken`) to its rank, 0 = most used.
 * When given, matches are ordered by usage *within* each tier — custom-emoji prefix matches,
 * then unicode prefix matches, then substring matches — and unranked matches keep the dataset
 * order after the ranked ones. Omitting it (or passing an empty map) keeps the plain dataset
 * order.
 */
export async function searchEmojis(
  query: string,
  customEmojis: EmojiPickerEmoji[],
  maxResults: number = 8,
  usageRanks?: Map<string, number>,
): Promise<EmojiSearchResult[]> {
  const lowerQuery = query.toLowerCase();
  if (lowerQuery.length < 2) return [];

  const byUsageRank = (a: EmojiSearchResult, b: EmojiSearchResult): number => {
    const rankA = usageRanks?.get(emojiUsageToken(a)) ?? Number.POSITIVE_INFINITY;
    const rankB = usageRanks?.get(emojiUsageToken(b)) ?? Number.POSITIVE_INFINITY;
    return rankA - rankB;
  };
  const hasRanks = !!usageRanks && usageRanks.size > 0;

  const results: EmojiSearchResult[] = [];

  // Search custom emojis first
  const customMatches: EmojiSearchResult[] = [];
  for (const ce of customEmojis) {
    const matches = ce.names.some(n => n.toLowerCase().startsWith(lowerQuery));
    if (matches && ce.names.length > 0) {
      customMatches.push({
        id: `custom-${ce.id}`,
        shortName: ce.names[0]!,
        allNames: ce.names,
        customImgUrl: ce.imgUrl,
        customEmojiId: ce.id,
        isCustom: true,
      });
    }
  }
  if (hasRanks) customMatches.sort(byUsageRank);
  results.push(...customMatches.slice(0, maxResults));

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
    // No early exit: a frequently used emoji late in the dataset must still be found —
    // the full scan stays sub-millisecond.
  }

  if (hasRanks) {
    // Array#sort is stable, so equal ranks keep the dataset order.
    prefixMatches.sort(byUsageRank);
    containsMatches.sort(byUsageRank);
  }

  const remaining = maxResults - results.length;
  results.push(...prefixMatches.slice(0, remaining));
  if (results.length < maxResults) {
    results.push(...containsMatches.slice(0, maxResults - results.length));
  }

  return results;
}
