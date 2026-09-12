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
// Components that render reaction emoji should ALSO call `useEmojiDataReady()`
// so they re-render if they mount before this load lands.
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

/**
 * The outcome of resolving an emoji key, independent of how it is rendered.
 * Extracted as a pure, side-effect-free function so the resolution chain can be
 * reasoned about (and unit-tested) without React:
 *   - `empty`   → no key supplied
 *   - `image`   → render an <img> (custom: stream, or workspace custom-by-name)
 *   - `unicode` → render a standard unicode emoji character
 *   - `literal` → the value is already a unicode emoji char; render as-is
 *   - `fallback`→ unresolvable shortcode; render a neutral icon, never raw text
 */
type EmojiResolution =
  | { kind: 'empty' }
  | { kind: 'image'; src: string; name: string }
  | { kind: 'unicode'; char: string }
  | { kind: 'literal'; text: string }
  | { kind: 'fallback'; key: string };

/**
 * Resolve an emoji key to a display decision. Pure — no JSX, no I/O.
 *
 * Resolution order (a `:shortcode:` never falls through to raw text):
 *   1. `custom:{id}:{name}`        → workspace custom-emoji image stream
 *   2. literal unicode emoji char  → rendered as-is
 *   3. `:name:` in `customEmojis`  → that workspace emoji's image (Slack-migrated case)
 *   4. `:name:` standard shortcode → unicode character
 *   5. anything unresolvable       → neutral fallback
 *
 * `customEmojis` is optional so existing callers keep working; pass the list
 * from `useCustomEmojis()` at reaction-display sites to resolve migrated custom
 * emoji by name. The unicode branch depends on the emoji-datasource cache being
 * warm (see `preloadEmojiData` / `useEmojiDataReady`).
 */
const resolveReactionEmoji = (
  emojiName: string | null | undefined,
  customEmojis?: EmojiPickerEmoji[] | null,
): EmojiResolution => {
  if (!emojiName) return { kind: 'empty' };

  // 1. custom:{id}:{name} — resolve to the emoji stream image.
  const customEmoji = parseCustomEmoji(emojiName);
  if (customEmoji) {
    return {
      kind: 'image',
      src: `${API_BASE_URL}/emojis/${customEmoji.emojiId}/stream`,
      name: customEmoji.name,
    };
  }

  // 2. A real unicode emoji character (not a shortcode) — render it directly.
  if (!isShortcode(emojiName)) {
    return { kind: 'literal', text: emojiName };
  }

  const key = normalizeEmojiKey(emojiName);

  // 3. Workspace custom emoji looked up by name.
  const workspaceEmoji = findCustomEmoji(key, customEmojis);
  if (workspaceEmoji) {
    return { kind: 'image', src: workspaceEmoji.imgUrl, name: key };
  }

  // 4. Standard unicode emoji shortcode (e.g. :arrow_up: → ⬆️).
  const unicode = findUnicodeEmoji(key);
  if (unicode) {
    return { kind: 'unicode', char: unifiedToEmoji(unicode.unified) };
  }

  // 5. Unresolvable (e.g. custom emoji deleted after migration).
  return { kind: 'fallback', key };
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

interface RenderEmojiOptions {
  /**
   * Workspace custom-emoji list from `useCustomEmojis()`. Enables resolving
   * Slack-migrated `:name:` reactions to their custom-emoji image.
   */
  customEmojis?: EmojiPickerEmoji[] | null | undefined;
}

/**
 * Render an emoji key for display. Thin rendering wrapper over
 * `resolveReactionEmoji`; all resolution precedence lives there.
 *
 * The first three params stay positional for backward-compatibility with the
 * ~30 existing call sites; new behaviour is passed via the `options` object so
 * callers never have to supply positional `undefined` placeholders.
 */
const renderEmoji = (
  emojiName: string | null | undefined,
  customSizeClass = 'w-5 h-5',
  unicodeSizeClass = 'text-base',
  options?: RenderEmojiOptions,
): ReactElement => {
  const resolved = resolveReactionEmoji(emojiName, options?.customEmojis);

  if (resolved.kind === 'image') {
    return renderEmojiImage(resolved.src, resolved.name, customSizeClass);
  }
  if (resolved.kind === 'unicode') {
    return <span className={`${unicodeSizeClass} leading-none`}>{resolved.char}</span>;
  }
  if (resolved.kind === 'literal') {
    return <span className={`${unicodeSizeClass} leading-none`}>{resolved.text}</span>;
  }
  if (resolved.kind === 'fallback') {
    return <SmilePlus className='text-muted-foreground' aria-label={resolved.key} />;
  }
  // kind === 'empty'
  return <span className={`${unicodeSizeClass} leading-none`} />;
};

export {
  getEmojiDisplayName,
  parseCustomEmoji,
  isCustomEmoji,
  resolveReactionEmoji,
  renderEmoji,
  convertCustomEmojiUrls,
};
export type { EmojiResolution, RenderEmojiOptions };
