import { ReactElement } from 'react';
import { SmilePlus } from 'lucide-react';
import { API_BASE_URL } from '../config';
import type { EmojiPickerEmoji } from '../hooks/useCustomEmojis';
import {
  findCustomEmoji,
  findUnicodeEmoji,
  findUnicodeEmojiName,
  preloadEmojiData,
  unifiedToEmoji,
} from './emojiLookup';

// Warm the lazily-loaded emoji-datasource cache once at module load so the
// synchronous `findUnicodeEmoji` lookup below can resolve standard shortcodes
// (e.g. `:white_check_mark:`) without every caller needing its own effect.
preloadEmojiData();

// Helper to check if emojiName is a custom emoji
const isCustomEmoji = (emojiName: string | null | undefined): boolean => {
  if (!emojiName) return false;
  return emojiName.startsWith('custom:');
};

// Helper to parse custom emoji
const parseCustomEmoji = (emojiName: string): { emojiId: string; name: string } | null => {
  if (!isCustomEmoji(emojiName)) return null;
  // Format: custom:{emojiId}:{name}:{imageUrl}

  const parts = emojiName.split(':');
  if (parts.length < 3 || !parts[1] || !parts[2]) return null;
  return {
    emojiId: parts[1],
    name: parts[2],
  };
};

/**
 * A shortcode is a bare or colon-wrapped identifier like `done_green` or
 * `:arrow_up:`. A real unicode emoji character ("✅") is NOT a shortcode and is
 * rendered verbatim. Slack-migrated reactions arrive colon-wrapped, which is why
 * they need resolving instead of being printed as text.
 */
const isShortcode = (value: string): boolean => /^:?[a-z0-9_+-]+:?$/i.test(value);

/** Strip surrounding colons / whitespace so `:done_green:` becomes `done_green`. */
const normalizeEmojiKey = (raw: string): string => raw.replace(/^:+|:+$/g, '').trim();

// Helper to get display name for emoji
const getEmojiDisplayName = (emojiName: string): string => {
  const customEmoji = parseCustomEmoji(emojiName);
  if (customEmoji) {
    return `:${customEmoji.name}:`;
  }
  const unicodeEmojiName = findUnicodeEmojiName(emojiName);
  return unicodeEmojiName ? `:${unicodeEmojiName}:` : emojiName;
};

/**
 * Convert custom emoji blob URLs to relative API paths.
 * This ensures emoji URLs are portable across web and desktop apps.
 *
 * Stores only relative path like: /api/emojis/{emojiId}/stream
 * Full URL is constructed at render time based on current environment.
 */
const convertCustomEmojiUrls = (htmlContent: string): string => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlContent, 'text/html');

  const images = doc.querySelectorAll<HTMLImageElement>('img[data-emoji-id]');

  images.forEach(img => {
    const emojiId = img.getAttribute('data-emoji-id');

    if (!emojiId) return;

    // Convert to relative path (no hostname) - works in both web and desktop
    // Full URL constructed at render time using window.location.origin
    img.setAttribute('src', `/api/emojis/${emojiId}/stream`);
    img.setAttribute('data-emoji', 'true');
    img.removeAttribute('emojiid'); // cleanup accidental attr
  });

  return doc.body.innerHTML;
};

// Render an emoji image (custom-emoji stream) inside a sized wrapper, with a
// hidden text fallback shown only if the image fails to load.
const renderEmojiImage = (src: string, name: string, customSizeClass: string): ReactElement => (
  <span
    className={`group inline-flex items-center justify-center flex-shrink-0 ${customSizeClass}`}
  >
    <img
      src={src}
      alt={name}
      title={name}
      className='w-full h-full object-contain'
      style={{ filter: 'url(#emoji-brightness-cap)' }}
      onError={e => {
        const target = e.target as HTMLImageElement;
        target.style.display = 'none';
        // Show the fallback span if image fails
        const fallback = target.nextElementSibling as HTMLSpanElement;
        if (fallback) fallback.style.display = 'inline';
      }}
    />
    <span
      className='hidden text-[10px] text-muted-foreground font-medium'
      style={{ display: 'none' }}
    >
      :{name}:
    </span>
  </span>
);

/**
 * Render an emoji key for display.
 *
 * Resolution order (a `:shortcode:` never falls through to raw text):
 *   1. `custom:{id}:{name}`        → workspace custom-emoji image stream
 *   2. `:name:` in `customEmojis`  → that workspace emoji's image (Slack-migrated case)
 *   3. `:name:` standard shortcode → unicode character
 *   4. a literal unicode character → rendered as-is
 *   5. anything unresolvable       → a neutral icon (never overflowing raw text)
 *
 * `customEmojis` is optional so existing callers keep working; pass the list
 * from `useCustomEmojis()` at reaction-display sites to resolve migrated custom
 * emoji by name.
 */
const renderEmoji = (
  emojiName: string | null | undefined,
  customSizeClass = 'w-5 h-5',
  unicodeSizeClass = 'text-base',
  customEmojis?: EmojiPickerEmoji[] | null,
): ReactElement => {
  if (!emojiName) return <span className={`${unicodeSizeClass} leading-none`} />;

  // 1. custom:{id}:{name} — resolve to the emoji stream image.
  const customEmoji = parseCustomEmoji(emojiName);
  if (customEmoji) {
    const imageUrl = `${API_BASE_URL}/emojis/${customEmoji.emojiId}/stream`;
    return renderEmojiImage(imageUrl, customEmoji.name, customSizeClass);
  }

  // A real unicode emoji character (not a shortcode) — render it directly.
  if (!isShortcode(emojiName)) {
    return <span className={`${unicodeSizeClass} leading-none`}>{emojiName}</span>;
  }

  const key = normalizeEmojiKey(emojiName);

  // 2. Workspace custom emoji looked up by name.
  const workspaceEmoji = findCustomEmoji(key, customEmojis);
  if (workspaceEmoji) {
    return renderEmojiImage(workspaceEmoji.imgUrl, key, customSizeClass);
  }

  // 3. Standard unicode emoji shortcode (e.g. :arrow_up: → ⬆️).
  const unicode = findUnicodeEmoji(key);
  if (unicode) {
    return (
      <span className={`${unicodeSizeClass} leading-none`}>{unifiedToEmoji(unicode.unified)}</span>
    );
  }

  // 4. Unresolvable (e.g. custom emoji deleted after migration) — neutral icon,
  // never the raw shortcode text that would overflow neighbouring rows.
  return <SmilePlus className='text-muted-foreground' aria-label={key} />;
};

export {
  getEmojiDisplayName,
  parseCustomEmoji,
  isCustomEmoji,
  renderEmoji,
  convertCustomEmojiUrls,
};
