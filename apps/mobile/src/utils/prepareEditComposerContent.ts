import { COMPOSER_INPUT_INLINE_EMOJI_SIZE } from '@/src/components/input-composer/composer-input-typography';
import { composerHtmlToPlainText } from '@/src/components/input-composer/utils/conversation-input.utils';
import { getMtlsEmojiUri } from '@/src/hooks/useMtlsEmoji';
import { parseCustomEmojiFromImgAttrs } from '@/src/utils/customEmoji';
import { plainTextToHtml } from '@/src/utils/plainTextToHtml';
import {
  storedHtmlToComposerFragment,
  storedHtmlToComposerHtml,
  wrapForEnrichedSetValue,
} from '@/src/utils/storedHtmlToComposerHtml';

const CUSTOM_EMOJI_IMG = /<img\b([^>]*)\/?>/gi;
const API_STREAM_EMOJI = /\/api\/emojis\/[^"']+\/stream/i;

/**
 * Replace dashboard / API custom emoji `<img>` tags with native `file://` images —
 * the same shape `EnrichedTextInput` produces after `setImage` (see insert-composer-emoji).
 */
async function enrichCustomEmojiImgsForComposer(html: string): Promise<string> {
  const replacements: { tag: string; emojiId: string }[] = [];

  for (const match of html.matchAll(CUSTOM_EMOJI_IMG)) {
    const tag = match[0];
    const parsed = parseCustomEmojiFromImgAttrs(match[1] ?? '');
    if (parsed) {
      replacements.push({ tag, emojiId: parsed.emojiId });
    }
  }

  if (replacements.length === 0) return html;

  let result = html;
  const size = COMPOSER_INPUT_INLINE_EMOJI_SIZE;

  for (const { tag, emojiId } of replacements) {
    const uri = await getMtlsEmojiUri(emojiId);
    const nativeTag = `<img src="${uri}" width="${size}" height="${size}"/>`;
    result = result.split(tag).join(nativeTag);
  }

  return result;
}

export type EditComposerContent = {
  html: string;
  text: string;
};

function formatEditPlainText(text: string): string {
  return text.length > 0 && !/\s$/.test(text) ? `${text} ` : text;
}

/** Twin bodies are often plain `\n\n` text; TipTap messages are HTML tags. */
const looksLikeHtml = (value: string): boolean => /<[a-z][\s\S]*>/i.test(value);

/**
 * Synchronous edit load — mirrors web passing `message.content` into TipTap on mount.
 * Plain Twin bodies become `<p>` / `<p><br></p>` so iOS keeps blank lines.
 */
export function getEditComposerInitialContent(storedHtml: string): EditComposerContent {
  if (storedHtml.trim().length === 0) {
    return { html: '', text: '' };
  }
  if (!looksLikeHtml(storedHtml)) {
    return {
      text: formatEditPlainText(storedHtml),
      html: wrapForEnrichedSetValue(plainTextToHtml(storedHtml)),
    };
  }
  return {
    text: formatEditPlainText(composerHtmlToPlainText(storedHtml)),
    html: storedHtmlToComposerHtml(storedHtml),
  };
}

/** True when edit load needs async `file://` resolution for dashboard custom emoji `<img>` tags. */
export function storedEditContentNeedsCustomEmojiHydration(storedHtml: string): boolean {
  for (const match of storedHtml.matchAll(CUSTOM_EMOJI_IMG)) {
    if (parseCustomEmojiFromImgAttrs(match[1] ?? '')) return true;
  }
  return false;
}

/**
 * Stored message HTML → composer display HTML + plain text for edit mode.
 * Custom emojis are resolved to cached `file://` URIs before `setValue`.
 */
export async function prepareEditComposerContent(storedHtml: string): Promise<EditComposerContent> {
  const initial = getEditComposerInitialContent(storedHtml);
  if (!looksLikeHtml(storedHtml) || !storedEditContentNeedsCustomEmojiHydration(storedHtml)) {
    return initial;
  }
  const fragment = storedHtmlToComposerFragment(storedHtml);
  const withNativeEmojis = await enrichCustomEmojiImgsForComposer(fragment);
  return {
    text: initial.text,
    html: wrapForEnrichedSetValue(withNativeEmojis),
  };
}

/** True when draft HTML still has custom emoji `<img>` tags that native `setValue` cannot render. */
export function draftHtmlNeedsCustomEmojiHydration(html: string): boolean {
  return storedEditContentNeedsCustomEmojiHydration(html) || API_STREAM_EMOJI.test(html);
}

function recoverDraftHtmlAndText(text: string, html: string): { text: string; html: string } {
  const trimmedText = text.trim();
  if (/^<html\b/i.test(trimmedText)) {
    return { html: text, text: composerHtmlToPlainText(text) };
  }
  return { text, html };
}

/**
 * Draft text/html → composer display values for `setValue`.
 * Resolves API stream custom emoji imgs to native `file://` URIs and recovers
 * drafts corrupted when a prior restore passed send-format HTML to the native input.
 */
export async function prepareDraftComposerContent(
  text: string,
  html: string,
): Promise<{ text: string; html: string }> {
  const { text: draftText, html: draftHtml } = recoverDraftHtmlAndText(text, html);
  const fragment = storedHtmlToComposerFragment(draftHtml);
  const bodyHtml = draftHtmlNeedsCustomEmojiHydration(fragment)
    ? await enrichCustomEmojiImgsForComposer(fragment)
    : fragment;

  return {
    text: draftText,
    html: wrapForEnrichedSetValue(bodyHtml),
  };
}
