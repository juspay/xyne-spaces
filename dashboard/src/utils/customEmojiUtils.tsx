import { API_BASE_URL } from '../config';
import { ReactElement } from 'react';

// Helper to check if emojiName is a custom emoji
const isCustomEmoji = (emojiName: string): boolean => {
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

const convertCustomEmojiUrls = (htmlContent: string): string => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlContent, 'text/html');

  const images = doc.querySelectorAll<HTMLImageElement>('img[data-emoji-id]');

  images.forEach(img => {
    const emojiId = img.getAttribute('data-emoji-id');
    const src = img.getAttribute('src');

    // Only replace blob URLs
    if (!emojiId || !src || !src.startsWith('blob:')) return;

    img.setAttribute('src', `${API_BASE_URL}/emojis/${emojiId}/stream`);

    // Optional cleanup
    img.setAttribute('data-emoji', 'true');
    img.removeAttribute('emojiid'); // cleanup accidental attr
  });

  return doc.body.innerHTML;
};

// Helper to render emoji
const renderEmoji = (emojiName: string): ReactElement => {
  const customEmoji = parseCustomEmoji(emojiName);
  const imageUrl = `${API_BASE_URL}/emojis/${customEmoji?.emojiId}/stream`;
  if (customEmoji) {
    return <img src={imageUrl} alt={customEmoji.name} className='w-4 h-4 object-contain' />;
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
