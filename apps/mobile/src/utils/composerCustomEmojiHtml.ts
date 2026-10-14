const COMPOSER_CUSTOM_EMOJI_IMG =
  /<img\b[^>]*(?:\bdata-emoji-id=["'][^"']+["']|\bsrc=["'](?:file:\/\/[^"']*\/emojis\/[^"']+|\/api\/emojis\/[^"']+\/stream)["'])/i;

/** Dashboard, API-stream, or native cached custom-emoji images in HTML. */
export function hasCustomEmojiInComposerHtml(html: string): boolean {
  if (!html) return false;
  return COMPOSER_CUSTOM_EMOJI_IMG.test(html);
}
