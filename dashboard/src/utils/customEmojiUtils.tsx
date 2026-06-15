import { ReactElement } from 'react';
import { API_BASE_URL } from '../config';

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

// Helper to get display name for emoji
const getEmojiDisplayName = (emojiName: string): string => {
  const customEmoji = parseCustomEmoji(emojiName);
  if (customEmoji) {
    return `:${customEmoji.name}:`;
  }
  return emojiName;
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

// Helper to render emoji
const renderEmoji = (
  emojiName: string | null | undefined,
  customSizeClass = 'w-5 h-5',
): ReactElement => {
  if (!emojiName) return <span className='text-base leading-none' />;

  const customEmoji = parseCustomEmoji(emojiName);
  if (customEmoji) {
    const imageUrl = `${API_BASE_URL}/emojis/${customEmoji.emojiId}/stream`;

    return (
      <span
        className={`group inline-flex items-center justify-center flex-shrink-0 ${customSizeClass}`}
      >
        <img
          src={imageUrl}
          alt={customEmoji.name}
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
          :{customEmoji.name}:
        </span>
      </span>
    );
  }
  return <span className='text-base leading-none'>{emojiName}</span>;
};

export {
  getEmojiDisplayName,
  parseCustomEmoji,
  isCustomEmoji,
  renderEmoji,
  convertCustomEmojiUrls,
};
