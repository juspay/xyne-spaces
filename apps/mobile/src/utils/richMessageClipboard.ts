import {
  prepareEditComposerContent,
  storedEditContentNeedsCustomEmojiHydration,
} from '@/src/utils/prepareEditComposerContent';
import {
  storedHtmlToComposerHtml,
  wrapForEnrichedSetValue,
} from '@/src/utils/storedHtmlToComposerHtml';

const RICH_MESSAGE_CLIPBOARD_TTL_MS = 10 * 60 * 1000;

type RichMessageClipboardEntry = {
  plainText: string;
  composerHtml: string;
  copiedAt: number;
  hydratedComposerHtml?: string;
  hydration?: Promise<string | null>;
};

let richMessageClipboard: RichMessageClipboardEntry | null = null;

const normalizeClipboardText = (value: string): string =>
  value.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ');

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const setRichMessageClipboard = ({
  plainText,
  storedHtml,
}: {
  plainText: string;
  storedHtml: string;
}): void => {
  const normalizedPlain = normalizeClipboardText(plainText);
  if (!normalizedPlain.trim() || !storedHtml.trim()) {
    richMessageClipboard = null;
    return;
  }

  const copiedAt = Date.now();
  const fallbackHtml = storedHtmlToComposerHtml(storedHtml);
  const hydration = storedEditContentNeedsCustomEmojiHydration(storedHtml)
    ? prepareEditComposerContent(storedHtml)
        .then(({ html }) => {
          if (
            richMessageClipboard &&
            richMessageClipboard.copiedAt === copiedAt &&
            richMessageClipboard.plainText === normalizedPlain
          ) {
            richMessageClipboard = {
              ...richMessageClipboard,
              composerHtml: html,
              hydratedComposerHtml: html,
            };
          }
          return html;
        })
        .catch(() => {
          // Keep the synchronous shortcode fallback; never surface raw emoji HTML.
          return null;
        })
    : undefined;

  richMessageClipboard = {
    plainText: normalizedPlain,
    composerHtml: fallbackHtml,
    copiedAt,
    ...(hydration ? { hydration } : {}),
  };
};

export const setRichEmailClipboard = (email: string): void => {
  const normalizedPlain = normalizeClipboardText(email).trim();
  if (!normalizedPlain || /\s/.test(normalizedPlain) || !normalizedPlain.includes('@')) {
    richMessageClipboard = null;
    return;
  }

  const escapedEmail = escapeHtml(normalizedPlain);
  richMessageClipboard = {
    plainText: normalizedPlain,
    composerHtml: wrapForEnrichedSetValue(
      `<p><a href="mailto:${escapedEmail}">${escapedEmail}</a></p>`,
    ),
    copiedAt: Date.now(),
  };
};

export const getRichMessageClipboardForPlainText = (
  pastedPlainText: string,
): RichMessageClipboardEntry | null => {
  const entry = richMessageClipboard;
  if (!entry) return null;

  if (Date.now() - entry.copiedAt > RICH_MESSAGE_CLIPBOARD_TTL_MS) {
    richMessageClipboard = null;
    return null;
  }

  if (normalizeClipboardText(pastedPlainText) !== entry.plainText) {
    return null;
  }
  return entry;
};
