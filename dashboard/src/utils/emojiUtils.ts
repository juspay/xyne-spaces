import { htmlToPlainText } from './sanitizer';
const MAX_LARGE_EMOJIS = 23;

/**
 * Regular expression to match modern Unicode emojis robustly.
 * This pattern correctly matches:
 * - Single emojis and multi-codepoint emojis
 * - ZWJ (Zero Width Joiner) sequences (e.g., 👩‍🍼, 👨‍👩‍👧‍👦, 👩‍💻)
 * - Skin tone modifiers (e.g., 👩🏻, 👨🏿)
 * - Flag sequences (e.g., 🇺🇸, 🇬🇧)
 * - Variation selectors (e.g., ❤️)
 */
const EMOJI_REGEX = new RegExp(
  [
    // Flag sequences (Regional Indicator pairs)
    '(?:\\p{RI}\\p{RI})',
    '|',
    // Emoji with optional modifiers, variation selectors, and ZWJ sequences
    '(?:',
    '[\\p{Emoji_Presentation}\\p{Extended_Pictographic}]',
    '(?:\\p{Emoji_Modifier})?', // Optional skin tone
    '(?:\\uFE0F)?', // Optional variation selector
    '(?:', // ZWJ sequence (repeatable)
    '\\u200D', // Zero Width Joiner
    '[\\p{Emoji_Presentation}\\p{Extended_Pictographic}]',
    '(?:\\p{Emoji_Modifier})?', // Optional skin tone
    '(?:\\uFE0F)?', // Optional variation selector
    ')*',
    ')',
  ].join(''),
  'gu',
);

export type MessageToken = { type: 'text'; content: string } | { type: 'emoji'; content: string };

/**
 * Tokenizes a message string into text and emoji segments.
 * This allows for different styling of emojis vs text.
 *
 * @param content - The message content to tokenize
 * @param skipEmojiWrapping - If true, returns all tokens as 'text' to avoid wrapping (for emoji-only messages)
 * @returns Array of tokens with type and content
 */
export function tokenizeMessage(content: string, skipEmojiWrapping = false): MessageToken[] {
  const tokens: MessageToken[] = [];
  let lastIndex = 0;

  const matches = Array.from(content.matchAll(EMOJI_REGEX));

  matches.forEach(match => {
    const emoji = match[0];
    const matchIndex = match.index ?? 0;

    if (matchIndex > lastIndex) {
      const textSegment = content.substring(lastIndex, matchIndex);
      tokens.push({ type: 'text', content: textSegment });
    }

    // Add emoji segment - as 'text' if skipEmojiWrapping, else as 'emoji' for wrapping
    tokens.push({ type: skipEmojiWrapping ? 'text' : 'emoji', content: emoji });

    lastIndex = matchIndex + emoji.length;
  });

  if (lastIndex < content.length) {
    tokens.push({ type: 'text', content: content.substring(lastIndex) });
  }

  if (tokens.length === 0) {
    tokens.push({ type: 'text', content });
  }

  return tokens;
}

export const EmojiSize = {
  SMALL: 'sm',
  MEDIUM: 'md',
  LARGE: 'lg',
  XL: 'xl',
} as const;

export type EmojiSizeValue = (typeof EmojiSize)[keyof typeof EmojiSize];

export function isEmojiOnly(text: string): boolean {
  if (!text || !text.trim()) {
    return false;
  }

  const hasStructuralTags = /<(code|pre|ul|ol|li|blockquote|h[1-6]|table|tr|td|th)[\s>]/i.test(
    text,
  );
  if (hasStructuralTags) {
    return false;
  }

  // Count custom emoji images via regex
  const customEmojiPattern = /<img[^>]*data-emoji-id="[^"]*"[^>]*>/gi;
  const customEmojiMatches = text.match(customEmojiPattern) || [];
  const customEmojiCount = customEmojiMatches.length;

  // Remove custom emoji images from HTML
  const textWithoutCustomEmojis = text.replace(customEmojiPattern, '');

  // Now process as before
  const strippedText = htmlToPlainText(textWithoutCustomEmojis);

  if (!strippedText && customEmojiCount === 0) {
    return false;
  }

  const emojiMatches = Array.from(strippedText.matchAll(EMOJI_REGEX));
  const unicodeEmojiCount = emojiMatches.length;

  const totalEmojiCount = customEmojiCount + unicodeEmojiCount;

  const remainingText = strippedText.replace(EMOJI_REGEX, '').trim();

  const isPureEmoji = remainingText.length === 0;
  const isWithinLimit = totalEmojiCount > 0 && totalEmojiCount <= MAX_LARGE_EMOJIS;

  const result = isPureEmoji && isWithinLimit;

  return result;
}

export function getEmojiFontSizeClass(text: string): string {
  if (isEmojiOnly(text)) {
    return 'text-2xl md:text-3xl';
  }

  return 'text-sm';
}

export function getEmojiCustomSizeClass(size: EmojiSizeValue): string {
  const sizeMap: Record<EmojiSizeValue, string> = {
    [EmojiSize.SMALL]: 'text-sm',
    [EmojiSize.MEDIUM]: 'text-lg',
    [EmojiSize.LARGE]: 'text-2xl',
    [EmojiSize.XL]: 'text-3xl sm:text-4xl',
  };

  return sizeMap[size] || sizeMap[EmojiSize.MEDIUM];
}

export function getEmojiCustomSizeInPx(size: EmojiSizeValue): number {
  const sizeMap: Record<EmojiSizeValue, number> = {
    [EmojiSize.SMALL]: 16,
    [EmojiSize.MEDIUM]: 20,
    [EmojiSize.LARGE]: 24,
    [EmojiSize.XL]: 30,
  };

  return sizeMap[size] || sizeMap[EmojiSize.MEDIUM];
}
