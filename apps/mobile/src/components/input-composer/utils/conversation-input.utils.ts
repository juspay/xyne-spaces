import { computeCanSend, computeHasComposerContent } from '../input-composer-attachment-helpers';
import type { ChatInputText, ComposerAttachment } from '../input-composer.types';
import { plainTextToHtml } from '@/src/utils/plainTextToHtml';
import { stripHtmlForPlainText } from './html-plain-text';

export function composerHtmlToPlainText(html: string): string {
  const withEmojiShortcodes = html.replace(/<img\b([^>]*)\/?>/gi, (_, attrs: string) => {
    const altMatch = /\balt=["']([^"']*)["']/.exec(attrs);
    if (altMatch?.[1]) return altMatch[1];
    const fileIdMatch = /\bsrc=["']file:\/\/[^"']*\/emojis\/([^/."]+)\.[^"']+["']/.exec(attrs);
    if (fileIdMatch?.[1]) return `:${fileIdMatch[1]}:`;
    return '';
  });
  return stripHtmlForPlainText(withEmojiShortcodes);
}

/**
 * Prefer live plain text.
 * HTML fallback is only for when native `onChangeText` has not asserted a value
 * yet. After a delete, `allowHtmlFallback` must be false so stale markup cannot
 * resurrect sendable content.
 */
export function resolveComposerPlainText(
  text: string,
  html: string,
  allowHtmlFallback = true,
): string {
  if (text.trim().length > 0) return text;
  if (!allowHtmlFallback) return text;
  return composerHtmlToPlainText(html);
}

/** True when HTML has a body native `setValue` must keep (text, emoji img, mention). */
export function composerHtmlHasNativeBody(html: string): boolean {
  if (html.trim().length === 0) return false;
  if (composerHtmlToPlainText(html).trim().length > 0) return true;
  return /<img\b/i.test(html) || /<mention\b/i.test(html);
}

/**
 * Native `setValue` payload for a text/html pair.
 * Prefer HTML with a real body; empty shells (`<p></p>`) fall back to plain text
 * so a relaunch still paints a text-only draft.
 */
export function composerNativeSetValue(text: string, html: string): string {
  const body = composerHtmlHasNativeBody(html)
    ? html.trim()
    : text.trim().length > 0
      ? plainTextToHtml(text)
      : '';
  if (body.length === 0) return '';
  if (/^<html\b/i.test(body) && /<\/html>\s*$/i.test(body)) return body;
  return `<html>\n${body}\n</html>`;
}

/**
 * Skip no-op `setValue` calls. A redundant empty write makes the native editor
 * rewrap and can emit `onChangeText('')` before draft HTML has hydrated.
 */
export function shouldWriteComposerNativeValue(
  nextNative: string,
  previousNative?: string,
): boolean {
  if (nextNative === previousNative) return false;
  if (nextNative.length === 0 && (previousNative === undefined || previousNative.length === 0)) {
    return false;
  }
  return true;
}

/** Mirrors Root's text / html / `plainTextSyncedRef` trio so send eligibility is unit-testable. */
export type ComposerSendableTextState = {
  text: string;
  html: string;
  /**
   * True after `setText` asserted a value (including empty). Stale HTML must
   * not re-enable send once this is set.
   */
  plainTextSynced: boolean;
};

export const createComposerSendableTextState = (
  text = '',
  html = '',
): ComposerSendableTextState => ({
  text,
  html,
  plainTextSynced: false,
});

export const readSendableComposerText = (state: ComposerSendableTextState): string =>
  resolveComposerPlainText(state.text, state.html, !state.plainTextSynced);

/** `onChangeText` / `setText` — plain text is now authoritative, including empty. */
export const applyComposerPlainText = (
  state: ComposerSendableTextState,
  text: string,
): ComposerSendableTextState => ({
  ...state,
  text,
  plainTextSynced: true,
});

/** `onChangeHtml` / `setHtmlState` — does not change the synced flag. */
export const applyComposerHtml = (
  state: ComposerSendableTextState,
  html: string,
): ComposerSendableTextState => ({
  ...state,
  html,
});

/**
 * Pairwise replace (`resetComposerAndInput`).
 * Empty+empty is an asserted clear. HTML-only draft restore still allows fallback.
 */
export const resetComposerSendableText = (text = '', html = ''): ComposerSendableTextState => ({
  text,
  html,
  plainTextSynced: text.trim().length > 0 || composerHtmlToPlainText(html).trim().length === 0,
});

/** Same inputs Root's `syncSendUi` uses. */
export const evaluateComposerSendUi = (
  state: ComposerSendableTextState,
  attachments: readonly ComposerAttachment[],
  isSending: boolean,
  isMutatingAttachments: boolean,
): ChatInputText => {
  const sendableText = readSendableComposerText(state);
  return {
    hasComposerContent: computeHasComposerContent(sendableText, attachments),
    canSend: computeCanSend(sendableText, attachments, isSending, isMutatingAttachments),
  };
};

/**
 * Same gate as Root `send()` before it snapshots: empty sendable text and no
 * uploaded attachments is a no-op. Stale HTML is intentionally ignored here.
 */
export const shouldAttemptComposerSend = (
  state: ComposerSendableTextState,
  uploadedAttachmentCount: number,
): boolean => readSendableComposerText(state).trim().length > 0 || uploadedAttachmentCount > 0;

/**
 * Composer remount key. It changes when the conversation/thread changes or when
 * `editSession` bumps (a new edit opens or the edit target switches) — NOT when
 * edit mode simply closes. Keeping the key stable on edit-exit lets the composer
 * reset in place instead of remounting, which removes the flicker + caret jump
 * when sending or cancelling an edit. Each edit-open still gets a fresh native
 * input tree because `editSession` increments.
 */
export const getConversationInputComposerKey = (
  conversationId: string,
  threadId: string | undefined,
  editSession: number,
): string => {
  return `${conversationId}:${threadId ?? 'root'}:composer:${editSession}`;
};
