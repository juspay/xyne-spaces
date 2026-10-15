import type { RefObject } from 'react';
import { InteractionManager } from 'react-native';
import type { EnrichedTextInputInstance } from 'react-native-enriched';

import type { EmojiPickerSelection } from '@/src/components/emoji-picker';
import { getMtlsEmojiUri } from '@/src/hooks/useMtlsEmoji';

import { COMPOSER_INPUT_INLINE_EMOJI_SIZE } from '../composer-input-typography';
import { appendTextToComposerHtml } from './composer-html';
import {
  COMPOSER_NATIVE_DOCUMENT_END,
  planEmojiInsert,
  type ComposerCaret,
  type EmojiInsertPlan,
} from './insert-composer-emoji.plan';

export {
  COMPOSER_NATIVE_DOCUMENT_END,
  COMPOSER_NATIVE_IMAGE_CHAR,
  caretFromSelection,
  composerCustomEmojiImgTag,
  composerCustomEmojiInsertMarkup,
  planEmojiInsert,
} from './insert-composer-emoji.plan';
export type { ComposerCaret, EmojiInsertPlan } from './insert-composer-emoji.plan';

type CustomEmojiSelection = Extract<EmojiPickerSelection, { type: 'custom' }>;

export type InsertComposerEmojiArgs = {
  inputRef: RefObject<EnrichedTextInputInstance | null>;
  selection: EmojiPickerSelection;
  currentText: string;
  fallbackHtml: string;
  syncInputValue: (html: string) => void;
  /** Caret captured before the picker blurred the input. */
  caret?: ComposerCaret | null;
};

export type InsertComposerEmojiResult = {
  nextHtml: string;
  nextText: string;
};

async function readInputHtml(
  inputRef: RefObject<EnrichedTextInputInstance | null>,
  fallbackHtml: string,
): Promise<string> {
  try {
    const html = await inputRef.current?.getHTML?.();
    if (html?.trim()) return html;
  } catch {
    // Use the last known HTML snapshot.
  }
  return fallbackHtml;
}

function waitForNativeEditor(): Promise<void> {
  return new Promise(resolve => queueMicrotask(resolve));
}

/** Native commands apply on a later frame — a microtask is not enough. */
function waitForComposerNativeIdle(): Promise<void> {
  return new Promise(resolve => {
    InteractionManager.runAfterInteractions(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
  });
}

async function insertUnicodeEmoji(
  inputRef: RefObject<EnrichedTextInputInstance | null>,
  baseHtml: string,
  plan: EmojiInsertPlan,
  syncInputValue: (html: string) => void,
): Promise<InsertComposerEmojiResult> {
  const nextHtml = appendTextToComposerHtml(baseHtml, plan.textInsert, plan.nextText);
  syncInputValue(nextHtml);
  await waitForNativeEditor();
  return { nextText: plan.nextText, nextHtml: await readInputHtml(inputRef, nextHtml) };
}

/** Put the native caret where `setImage` should land. */
async function placeCaretForCustomEmoji(
  editor: EnrichedTextInputInstance,
  plan: EmojiInsertPlan,
  baseHtml: string,
): Promise<string> {
  if (!plan.isAppending) {
    editor.setSelection(plan.caret.start, plan.caret.end);
    return baseHtml;
  }

  let html = baseHtml;
  if (plan.needsSpace) {
    html = appendTextToComposerHtml(baseHtml, ' ', `${plan.currentText} `);
    editor.setValue(html);
    await waitForComposerNativeIdle();
  }
  editor.setSelection(COMPOSER_NATIVE_DOCUMENT_END, COMPOSER_NATIVE_DOCUMENT_END);
  return html;
}

async function insertCustomEmoji(
  inputRef: RefObject<EnrichedTextInputInstance | null>,
  selection: CustomEmojiSelection,
  baseHtml: string,
  plan: EmojiInsertPlan,
): Promise<InsertComposerEmojiResult> {
  const uri = await getMtlsEmojiUri(selection.emojiId);
  await waitForComposerNativeIdle();

  const editor = inputRef.current;
  if (!editor) {
    return { nextText: plan.nextText, nextHtml: baseHtml };
  }

  editor.focus();
  const workingHtml = await placeCaretForCustomEmoji(editor, plan, baseHtml);
  editor.setImage(uri, COMPOSER_INPUT_INLINE_EMOJI_SIZE, COMPOSER_INPUT_INLINE_EMOJI_SIZE);
  editor.focus();
  await waitForComposerNativeIdle();

  return { nextText: plan.nextText, nextHtml: await readInputHtml(inputRef, workingHtml) };
}

export async function insertComposerEmoji({
  inputRef,
  selection,
  currentText,
  fallbackHtml,
  syncInputValue,
  caret = null,
}: InsertComposerEmojiArgs): Promise<InsertComposerEmojiResult | null> {
  // Unicode still appends. Only custom emoji uses the saved caret.
  const plan = planEmojiInsert(currentText, selection, selection.type === 'custom' ? caret : null);
  if (!plan) return null;

  const baseHtml = await readInputHtml(inputRef, fallbackHtml);

  if (selection.type === 'custom') {
    return insertCustomEmoji(inputRef, selection, baseHtml, plan);
  }

  return insertUnicodeEmoji(inputRef, baseHtml, plan, syncInputValue);
}
