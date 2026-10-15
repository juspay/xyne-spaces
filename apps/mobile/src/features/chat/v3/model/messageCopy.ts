import { hasCustomEmojiInComposerHtml } from '@/src/utils/composerCustomEmojiHtml';
import { decodeBasicEntitiesExact, HTML_TAG_OR_EMPTY, stripHtmlTags } from '@/src/utils/htmlText';

const EMOJI_IMG_RE = /<img[^>]*data-emoji="true"[^>]*>/i;

const stripComposerHtmlForContentCheck = (html: string): string =>
  stripHtmlTags(html.replace(/<br\s*\/?>/gi, '\n'), HTML_TAG_OR_EMPTY)
    .replace(/&nbsp;/gi, ' ')
    .trim();

/**
 * Convert channel message HTML to the text users expect from Copy Message.
 * Channel messages may contain block markup and composer emoji images, so
 * this intentionally preserves block boundaries before stripping the tags.
 */
export const channelHtmlToPlainText = (html: string): string => {
  let text = html.replace(/<br\s*\/?\s*>/gi, '\n');
  text = text.replace(/<\/(p|div|h[1-6]|li)>/gi, '\n');
  text = text.replace(/<img[^>]*data-emoji="true"[^>]*alt="([^"]*)"[^>]*>/gi, '$1');
  return decodeBasicEntitiesExact(stripHtmlTags(text, HTML_TAG_OR_EMPTY)).trim();
};

/** Channel HTML containing only an emoji image is still copyable. */
export const channelHtmlHasTextContent = (html: string): boolean => {
  const stripped = stripHtmlTags(html, HTML_TAG_OR_EMPTY).trim();
  return stripped.length > 0 || EMOJI_IMG_RE.test(html);
};

/** Thread actions use the composer sendability contract for copy visibility. */
export const composerHtmlHasSendableBody = (html: string): boolean => {
  if (!html.trim()) return false;
  if (hasCustomEmojiInComposerHtml(html)) return true;
  return stripComposerHtmlForContentCheck(html).length > 0;
};
