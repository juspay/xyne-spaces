import { useCallback, useRef, type MutableRefObject, type RefObject } from 'react';
import type { EnrichedTextInputInstance } from 'react-native-enriched';

type UseComposerFocusManagerReturn = {
  scheduleFocusAtEnd: (visibleEnd?: number, expectedText?: string) => void;
  notifyComposerNativeTextChange: (nativeText: string) => void;
  notifyUserSelectionChange: (start: number, end: number) => void;
  clearScheduledFocus: () => void;
};

/** Normalizes NBSP to a regular space so native/JS text comparisons line up. */
const composerTextKey = (value: string): string => value.replace(/\u00a0/g, ' ');

/**
 * Manages deferred focus-at-end scheduling for the composer.
 *
 * Native `setValue` / `defaultValue` apply asynchronously, so we can't call
 * `setSelection` + `focus` immediately. Instead we register a pending target
 * position plus the exact text we expect native to hold once our programmatic
 * populate settles, and only drop the caret to the end when the next
 * `onChangeText` is that populate echo.
 *
 * This text gate is what keeps the caret from being yanked to the end mid-edit:
 * a user keystroke (typing or deleting) produces text that differs from the
 * scheduled baseline, so we treat it as the user taking over and abandon the
 * pending jump instead of applying it. Previously the jump was applied on the
 * *next* `onChangeText` unconditionally, and the only thing meant to cancel it
 * was a native selection event on the focus-tap — which iOS does not reliably
 * emit on focus, so the pending jump survived into the user's first keystroke
 * and made mid-text editing/deletion impossible.
 */
export function useComposerFocusManager(
  inputRef: RefObject<EnrichedTextInputInstance | null>,
  textRef: MutableRefObject<string>,
): UseComposerFocusManagerReturn {
  const pendingFocusEndRef = useRef<number | null>(null);
  // Normalized text we expect native to echo for the programmatic populate this
  // schedule belongs to. `null` means "no text gate" (legacy: apply on any change).
  const expectedTextRef = useRef<string | null>(null);
  const focusRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearScheduledFocus = useCallback((): void => {
    pendingFocusEndRef.current = null;
    expectedTextRef.current = null;
    if (focusRetryTimeoutRef.current !== null) {
      clearTimeout(focusRetryTimeoutRef.current);
      focusRetryTimeoutRef.current = null;
    }
  }, []);

  const applyScheduledFocusAtEnd = useCallback((): boolean => {
    const end = pendingFocusEndRef.current;
    if (end === null || !inputRef.current) return false;

    inputRef.current.setSelection(end, end);
    inputRef.current.focus();
    pendingFocusEndRef.current = null;
    expectedTextRef.current = null;

    if (focusRetryTimeoutRef.current !== null) {
      clearTimeout(focusRetryTimeoutRef.current);
      focusRetryTimeoutRef.current = null;
    }

    return true;
  }, [inputRef]);

  const scheduleFocusAtEnd = useCallback(
    (visibleEnd?: number, expectedText?: string): void => {
      const end = visibleEnd ?? textRef.current.length;
      pendingFocusEndRef.current = end;
      expectedTextRef.current = expectedText != null ? composerTextKey(expectedText) : null;

      if (focusRetryTimeoutRef.current !== null) {
        clearTimeout(focusRetryTimeoutRef.current);
      }

      focusRetryTimeoutRef.current = setTimeout(() => {
        if (pendingFocusEndRef.current === null) return;
        const expected = expectedTextRef.current;
        // If the content has diverged from the programmatic baseline, the user
        // has started editing — never yank their caret to the end.
        if (expected !== null && composerTextKey(textRef.current) !== expected) {
          clearScheduledFocus();
          return;
        }
        applyScheduledFocusAtEnd();
      }, 400);
    },
    [applyScheduledFocusAtEnd, clearScheduledFocus, textRef],
  );

  const notifyComposerNativeTextChange = useCallback(
    (nativeText: string): void => {
      if (pendingFocusEndRef.current === null) return;
      const target = pendingFocusEndRef.current;
      const expected = expectedTextRef.current;

      // Divergent text means the user has started editing (typing/deleting).
      // We must NOT move their caret to the end. Preserve the original focus
      // intent -- make sure the field is focused (a no-op if it already is,
      // e.g. the user just tapped into it) -- then drop the schedule so no
      // later change yanks the caret to the end mid-edit.
      if (expected !== null && composerTextKey(nativeText) !== expected) {
        inputRef.current?.focus();
        clearScheduledFocus();
        return;
      }

      if (target > 0 && nativeText.length === 0) return;
      applyScheduledFocusAtEnd();
    },
    [applyScheduledFocusAtEnd, clearScheduledFocus, inputRef],
  );

  /**
   * Called on every native selection change. A scheduled "focus at end" exists
   * only to drop the caret after a programmatic setValue settles. Once the user
   * positions their own caret anywhere other than that pending target, abandon
   * the scheduled jump. This is a secondary safety net; the primary guard is the
   * expected-text check in notifyComposerNativeTextChange, because iOS does not
   * reliably emit a selection change on the focus-tap.
   */
  const notifyUserSelectionChange = useCallback(
    (start: number, end: number): void => {
      const target = pendingFocusEndRef.current;
      if (target === null) return;
      // Ignore the collapsed selection our own applyScheduledFocusAtEnd emits.
      if (start === target && end === target) return;
      clearScheduledFocus();
    },
    [clearScheduledFocus],
  );

  return {
    scheduleFocusAtEnd,
    notifyComposerNativeTextChange,
    notifyUserSelectionChange,
    clearScheduledFocus,
  };
}
