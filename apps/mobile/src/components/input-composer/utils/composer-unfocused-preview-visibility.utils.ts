import { hasCustomEmojiInComposerHtml } from '@/src/utils/composerCustomEmojiHtml';

/**
 * The native editor is the authoritative renderer for inline images. A plain
 * Text overlay would hide those images whenever the composer loses focus.
 */
export const shouldRenderComposerUnfocusedTextPreview = ({
  isInputFocused,
  html,
  text,
}: {
  isInputFocused: boolean;
  html: string;
  text: string;
}): boolean => !isInputFocused && text.trim().length > 0 && !hasCustomEmojiInComposerHtml(html);
