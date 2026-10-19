import { useCallback, useEffect, useLayoutEffect, useRef, type MutableRefObject } from 'react';
import {
  prepareEditComposerContent,
  storedEditContentNeedsCustomEmojiHydration,
  type EditComposerContent,
} from '@/src/utils/prepareEditComposerContent';
import {
  countComposerMentions,
  countSpecialMentionTypeAttrs,
} from '@/src/utils/composerMentionHtml';
import type { ChatInputEditingMessage } from '../input-composer.types';

const composerTextKey = (value: string): string => value.replace(/\u00a0/g, ' ');

export type EditBaselineState = {
  mentionCount: number;
  specialMentionCount: number;
  text: string;
};

type UseComposerEditBaselineParams = {
  editingMessage: ChatInputEditingMessage | null;
  editInitialContent: EditComposerContent | null;
  suppressDraftSync: boolean;
  htmlRef: MutableRefObject<string>;
  textRef: MutableRefObject<string>;
  setTextState: (text: string) => void;
  syncInputValue: (value: string) => void;
  scheduleFocusAtEnd: (visibleEnd?: number, expectedText?: string) => void;
  clearScheduledFocus: () => void;
  scheduleDraftPersist: () => void;
};

type UseComposerEditBaselineReturn = {
  editBaselineRef: MutableRefObject<EditBaselineState>;
  clearEditBaseline: () => void;
  setHtmlState: (html: string) => void;
};

export function useComposerEditBaseline({
  editingMessage,
  editInitialContent,
  suppressDraftSync,
  htmlRef,
  textRef,
  setTextState,
  syncInputValue,
  scheduleFocusAtEnd,
  clearScheduledFocus,
  scheduleDraftPersist,
}: UseComposerEditBaselineParams): UseComposerEditBaselineReturn {
  const editBaselineRef = useRef<EditBaselineState>({
    mentionCount: editInitialContent ? countComposerMentions(editInitialContent.html) : 0,
    specialMentionCount: editInitialContent
      ? countSpecialMentionTypeAttrs(editInitialContent.html)
      : 0,
    text: editInitialContent?.text ?? '',
  });
  const isInitialMentionGuardActiveRef = useRef(editBaselineRef.current.mentionCount > 0);
  // Which edit target has already populated the composer. The populate effect
  // below must run exactly ONCE per target, but its deps (setTextState) change
  // identity on every render -- setText depends on scheduleDraftPersist, which
  // depends on the userDrafts Zero query that emits a fresh array on every
  // update. This ref makes the effect idempotent regardless of how often it
  // re-fires.
  const populatedEditKeyRef = useRef<string | null>(null);

  const clearEditBaseline = useCallback((): void => {
    editBaselineRef.current = { mentionCount: 0, specialMentionCount: 0, text: '' };
    isInitialMentionGuardActiveRef.current = false;
    populatedEditKeyRef.current = null;
  }, []);

  /**
   * Persists new HTML to the ref and saves a draft, but guards against
   * the native input stripping mentions from the edit-mode baseline on mount.
   */
  const setHtmlState = useCallback(
    (next: string): void => {
      const { mentionCount, specialMentionCount, text: baselineText } = editBaselineRef.current;
      if (isInitialMentionGuardActiveRef.current) {
        const textUnchanged = composerTextKey(textRef.current) === composerTextKey(baselineText);
        if (!textUnchanged) {
          isInitialMentionGuardActiveRef.current = false;
        } else {
          const nextMentionCount = countComposerMentions(next);
          if (nextMentionCount < mentionCount) return;
          if (specialMentionCount > 0 && countSpecialMentionTypeAttrs(next) < specialMentionCount) {
            return;
          }
          isInitialMentionGuardActiveRef.current = false;
        }
      }

      htmlRef.current = next;
      scheduleDraftPersist();
    },
    [htmlRef, scheduleDraftPersist, textRef],
  );

  // Populate the edit baseline synchronously before paint when entering edit mode.
  useLayoutEffect(() => {
    if (!suppressDraftSync || !editingMessage || !editInitialContent) return;

    // Populate once per edit target. Re-running would re-arm scheduleFocusAtEnd's
    // 400ms timer (yanking the caret to the end mid-edit) AND revert the user's
    // in-progress text via setTextState(editInitialContent.text).
    if (populatedEditKeyRef.current === editingMessage.messageId) return;
    populatedEditKeyRef.current = editingMessage.messageId;

    htmlRef.current = editInitialContent.html;
    editBaselineRef.current = {
      mentionCount: countComposerMentions(editInitialContent.html),
      specialMentionCount: countSpecialMentionTypeAttrs(editInitialContent.html),
      text: editInitialContent.text,
    };
    isInitialMentionGuardActiveRef.current = editBaselineRef.current.mentionCount > 0;
    setTextState(editInitialContent.text);
    scheduleFocusAtEnd(editInitialContent.text.length, editInitialContent.text);
  }, [
    editInitialContent,
    editingMessage,
    htmlRef,
    scheduleFocusAtEnd,
    setTextState,
    suppressDraftSync,
  ]);

  // Async hydration of custom emojis in edit content (resolves to native file:// URIs).
  useEffect(() => {
    if (!editingMessage || !editInitialContent) return;
    if (!storedEditContentNeedsCustomEmojiHydration(editingMessage.content)) return;

    const initialText = editInitialContent.text;
    let cancelled = false;

    void prepareEditComposerContent(editingMessage.content)
      .then(({ html, text }) => {
        if (cancelled || html === htmlRef.current) return;

        // Never clobber user edits that arrived before async hydration finished.
        if (composerTextKey(textRef.current) !== composerTextKey(initialText)) return;

        htmlRef.current = html;
        editBaselineRef.current = {
          mentionCount: countComposerMentions(html),
          specialMentionCount: countSpecialMentionTypeAttrs(html),
          text,
        };
        isInitialMentionGuardActiveRef.current = editBaselineRef.current.mentionCount > 0;
        setTextState(text);
        syncInputValue(html);
        scheduleFocusAtEnd(text.length, text);
      })
      .catch(() => {
        // Keep the safe initial shortcode fallback if cached emoji hydration fails.
      });

    return (): void => {
      cancelled = true;
    };
  }, [
    editInitialContent,
    editingMessage,
    htmlRef,
    scheduleFocusAtEnd,
    setTextState,
    syncInputValue,
    textRef,
  ]);

  // Clear any pending scheduled focus when not in edit mode.
  useEffect(() => {
    if (editingMessage) return;
    populatedEditKeyRef.current = null;
    clearScheduledFocus();
    return (): void => {
      clearScheduledFocus();
    };
  }, [clearScheduledFocus, editingMessage]);

  return { editBaselineRef, clearEditBaseline, setHtmlState };
}
