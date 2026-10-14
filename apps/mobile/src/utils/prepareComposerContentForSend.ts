import {
  composerHtmlHasSendableBody,
  transformComposerCustomEmojiHtmlForSend,
} from '@/src/utils/customEmoji';
import { plainTextToHtml } from '@/src/utils/plainTextToHtml';
import { rawHtmlTransformer } from '@/src/utils/rawHtmlTransformer';

function decodeNumericHtmlEntities(html: string): string {
  return html
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => {
      const value = Number.parseInt(hex, 16);
      return Number.isNaN(value) ? _m : String.fromCodePoint(value);
    })
    .replace(/&#([0-9]+);/g, (_m, dec: string) => {
      const value = Number.parseInt(dec, 10);
      return Number.isNaN(value) ? _m : String.fromCodePoint(value);
    });
}

/**
 * Normalize composer HTML for persist/send. Returns null when there is no sendable
 * body (plain text or custom emoji images).
 */
export function buildComposerContentForSend(text: string, html: string): string | null {
  const htmlBeforeTransform = composerHtmlHasSendableBody(html) ? html : plainTextToHtml(text);
  const htmlWithCustomEmoji = transformComposerCustomEmojiHtmlForSend(htmlBeforeTransform, text);
  const htmlWithDecodedEmoji = decodeNumericHtmlEntities(htmlWithCustomEmoji);
  const transformedHtml = rawHtmlTransformer(htmlWithDecodedEmoji);
  return composerHtmlHasSendableBody(transformedHtml) ? transformedHtml : null;
}
