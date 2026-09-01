import { ReactElement, useEffect, useState } from 'react';
import { SmilePlus } from 'lucide-react';
import { useCustomEmojis } from '../../hooks/useCustomEmojis';
import {
  findCustomEmoji,
  findUnicodeEmoji,
  loadEmojiData,
  unifiedToEmoji,
} from '../../utils/emojiLookup';
import { isCustomEmoji, parseCustomEmoji } from '../../utils/customEmojiUtils';
import { API_BASE_URL } from '../../config';

/**
 * Strip surrounding colons / whitespace from an emoji key.
 * Slack-migrated reactions are stored colon-wrapped (e.g. `:done_green:`),
 * while the lookup helpers expect the bare name (`done_green`).
 */
const normalizeEmojiKey = (raw: string): string => raw.replace(/^:+|:+$/g, '').trim();

/**
 * A shortcode is a bare/colon-wrapped identifier like `done_green` or `:arrow_up:`.
 * Anything else (a real unicode emoji character, punctuation) is treated as
 * literal content and rendered verbatim.
 */
const isShortcode = (value: string): boolean => /^:?[a-z0-9_+-]+:?$/i.test(value);

/**
 * Resolves a reaction emoji key to a real emoji for display, applying the same
 * resolution order the rest of the app uses (see ColonEmojiExtension / TextNode):
 *   1. `custom:{id}:{name}` → workspace custom-emoji image stream
 *   2. `:name:` / `name`    → workspace custom emoji looked up by name → image
 *   3. `:name:` / `name`    → standard unicode emoji shortcode → unicode char
 *   4. a literal unicode emoji character → rendered as-is
 *   5. anything unresolvable → a neutral icon (never raw overflowing text)
 *
 * This replaces `renderEmoji` at reaction-display sites so Slack-migrated
 * shortcodes render as the intended emoji instead of raw text that overflows
 * the Activity badge.
 */
export const ResolvedEmoji = ({
  emojiName,
  className = 'h-3.5 w-3.5',
}: {
  emojiName: string | null | undefined;
  className?: string;
}): ReactElement => {
  const { data: customEmojis } = useCustomEmojis();
  const [, setEmojiDataReady] = useState(false);

  // Unicode shortcode lookups depend on the lazily-loaded emoji-datasource cache.
  // Kick off the load and re-render once it is ready so `findUnicodeEmoji` can hit it.
  useEffect(() => {
    let active = true;
    void loadEmojiData().then((): void => {
      if (active) setEmojiDataReady(true);
    });
    return (): void => {
      active = false;
    };
  }, []);

  if (!emojiName) return <span className='leading-none' />;

  // 1. custom:{id}:{name} — resolve to the emoji stream image.
  if (isCustomEmoji(emojiName)) {
    const custom = parseCustomEmoji(emojiName);
    if (custom) {
      return (
        <img
          src={`${API_BASE_URL}/emojis/${custom.emojiId}/stream`}
          alt={custom.name}
          title={custom.name}
          className={`${className} object-contain`}
          style={{ filter: 'url(#emoji-brightness-cap)' }}
        />
      );
    }
  }

  // A real unicode emoji character (not a shortcode) — render it directly.
  if (!isShortcode(emojiName)) {
    return <span className='leading-none'>{emojiName}</span>;
  }

  const key = normalizeEmojiKey(emojiName);

  // 2. Workspace custom emoji looked up by name.
  const workspaceEmoji = findCustomEmoji(key, customEmojis);
  if (workspaceEmoji) {
    return (
      <img
        src={workspaceEmoji.imgUrl}
        alt={key}
        title={key}
        className={`${className} object-contain`}
        style={{ filter: 'url(#emoji-brightness-cap)' }}
      />
    );
  }

  // 3. Standard unicode emoji shortcode (e.g. :arrow_up: → ⬆️).
  const unicode = findUnicodeEmoji(key);
  if (unicode) {
    return <span className='leading-none'>{unifiedToEmoji(unicode.unified)}</span>;
  }

  // 4. Unresolvable (e.g. custom emoji deleted after migration) — neutral icon,
  // never the raw shortcode text that would overflow the badge.
  return <SmilePlus className={`${className} text-muted-foreground`} aria-label={key} />;
};
