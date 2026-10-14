import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Alert, Text, View } from 'react-native';
import {
  EnrichedTextInput,
  type EnrichedTextInputProps,
  type OnChangeHtmlEvent,
  type OnChangeSelectionEvent,
  type OnChangeStateEvent,
  type OnChangeTextEvent,
  type OnPasteImagesEvent,
  type HtmlStyle,
} from 'react-native-enriched';
import { type NativeSyntheticEvent, Platform } from 'react-native';
import { useCSSVariable } from 'uniwind';

import {
  useChatInputActions,
  useChatInputComposerState,
  useChatInputConversation,
  useChatInputHandlers,
  useChatInputPanelState,
  useChatInputText,
} from './input-composer-context';
import { ChatInput } from './input-composer';
import {
  COMPOSER_INPUT_FONT_SIZE,
  COMPOSER_INPUT_COLLAPSED_HEIGHT,
  COMPOSER_INPUT_EXPANDED_MAX_HEIGHT,
  COMPOSER_INPUT_LINE_HEIGHT,
  COMPOSER_STATUS_PLACEHOLDER_TEXT_WIDTH,
  PLACEHOLDER_MAX_LENGTH,
  composerInputLeadingInset,
  composerInputTrailingInset,
} from './composer-input-typography';
import { ComposerUnfocusedPreview } from './composer-unfocused-preview';
import { shouldShowComposerStatusPlaceholder } from './utils/composer-status-placeholder.utils';
import { shouldRenderComposerUnfocusedTextPreview } from './utils/composer-unfocused-preview-visibility.utils';
import { cn } from '@/src/utils/cn';
import { getRichMessageClipboardForPlainText } from '@/src/utils/richMessageClipboard';
import { ReactionEmojiDisplay } from '../chat/message/reactions/reaction-emoji-display';
import { useComposerDmPeerStatusEmoji } from './hooks/useComposerDmPeerStatusEmoji';
import { plainTextToHtml } from '@/src/utils/plainTextToHtml';
import { wrapForEnrichedSetValue } from '@/src/utils/storedHtmlToComposerHtml';
import * as Clipboard from 'expo-clipboard';
import { useDraftAttachments } from '@/src/hooks/useDraftAttachments';
import { SELF_MENTION_INDICATOR, ensureSelfMentionIndicator } from '@/src/utils/mention-indicator';
import {
  ingestComposerAttachments,
  pastedImagesToComposerAttachments,
} from './utils/pasteComposerAttachments';

type InputProps = EnrichedTextInputProps & {
  className?: string;
  disabled?: boolean;
};

const normalizePastedText = (value: string): string =>
  value.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ');

const nativeTextMatchesMultilineClipboard = (
  nativeText: string,
  clipboardText: string,
): boolean => {
  const native = normalizePastedText(nativeText);
  const clipboard = normalizePastedText(clipboardText);
  if (!clipboard.includes('\n')) return false;
  // Correct multiline input needs no repair. Only accept the two exact
  // transformations produced by the native editor when it flattens pasted
  // div-based HTML; do not collapse arbitrary whitespace because that could
  // make IME, dictation, suggestion, or autofill input match the clipboard.
  if (native.includes('\n')) return false;

  return native === clipboard.replace(/\n/g, '') || native === clipboard.replace(/\n/g, ' ');
};

const DEFAULT_MENTION_INDICATORS = ['@', '#'];

const InputComponent = ({
  className,
  disabled = false,
  editable = true,
  placeholder,
  onChangeText,
  onChangeHtml,
  onChangeState,
  onChangeSelection,
  onStartMention,
  onChangeMention,
  onEndMention,
  onFocus,
  onBlur,
  mentionIndicators,
  style: _restStyle,
  allowFontScaling: _allowFontScaling,
  ...restProps
}: InputProps): ReactElement => {
  const {
    setIsFormattingVisibleState,
    setIsMentionOpenState,
    setMentionModeState,
    setMentionQueryState,
    setAttachments,
    beginAttachmentMutation,
    endAttachmentMutation,
  } = useChatInputActions();
  const { editDefaultValue, conversationId, threadId, isEditing, isTwinEditing } =
    useChatInputConversation();
  const statusEmoji = useComposerDmPeerStatusEmoji();
  const {
    inputRef,
    placeholder: defaultPlaceholder,
    setInputFocused,
    setTextState,
    setHtmlState,
    setStyleState,
    setSelection,
    notifyComposerNativeTextChange,
    notifyUserSelectionChange,
    flushDraftPersist,
  } = useChatInputHandlers();
  const { isInputFocused } = useChatInputPanelState();
  const { attachments } = useChatInputComposerState();
  const { hasComposerContent } = useChatInputText();
  const { addAttachments: uploadDraftAttachments } = useDraftAttachments();
  const inputTextColor = useCSSVariable('--color-foreground') as string;
  const placeholderTextColor = useCSSVariable('--color-secondary-foreground') as string;
  const cursorColor = useCSSVariable('--color-primary') as string;
  const mentionBg = useCSSVariable('--color-mention-other-bg') as string;
  const mentionText = useCSSVariable('--color-mention-other-text') as string;
  const mentionYouBg = useCSSVariable('--color-mention-you-bg') as string;
  const mentionYouText = useCSSVariable('--color-mention-you-text') as string;
  const codeHighlightText = useCSSVariable('--color-conversation-input-code-text') as string;
  const codeHighlightBackground = useCSSVariable(
    '--color-conversation-input-code-background',
  ) as string;
  const brand = useCSSVariable('--color-brand') as string;
  const muted = useCSSVariable('--color-muted') as string;
  const actionPrimary = useCSSVariable('--color-action-primary') as string;
  const pendingRichPasteRef = useRef<{
    plainText: string;
    composerHtml: string;
  } | null>(null);
  const pendingRichPasteHydrationRef = useRef<{
    plainText: string;
    copiedAt: number;
  } | null>(null);
  const latestTextRef = useRef('');
  const latestHtmlRef = useRef(editDefaultValue ?? '');
  const [unfocusedPreviewText, setUnfocusedPreviewText] = useState('');
  const [unfocusedPreviewHtml, setUnfocusedPreviewHtml] = useState('');
  const isPastingAttachmentsRef = useRef(false);

  // Schedule/send can clear composer refs while the field is blurred. The
  // unfocused Text overlay is a blur-time snapshot and must be cleared too,
  // otherwise stale text remains until the next focus.
  useEffect(() => {
    if (hasComposerContent) return;
    latestTextRef.current = '';
    latestHtmlRef.current = '';
    setUnfocusedPreviewText('');
    setUnfocusedPreviewHtml('');
  }, [hasComposerContent]);

  // Opening a chat must stay collapsed until the user taps the field. Edit
  // mode focuses via `scheduleFocusAtEnd` after populate — do not autofocus
  // here on mount, or every conversation opens with the keyboard up.
  useEffect(() => {
    if (!disabled) return;
    inputRef.current?.blur();
  }, [disabled, inputRef]);

  const htmlStyle = useMemo<HtmlStyle>(
    () => ({
      blockquote: {
        borderColor: brand,
        borderWidth: 3,
        gapWidth: 10,
        color: inputTextColor,
      },
      codeblock: {
        color: codeHighlightText,
        backgroundColor: codeHighlightBackground,
        borderRadius: 8,
      },
      code: {
        color: codeHighlightText,
        backgroundColor: codeHighlightBackground,
      },
      a: {
        color: actionPrimary,
        textDecorationLine: 'underline',
      },
      ol: {
        gapWidth: 8,
        marginLeft: 18,
        markerColor: muted,
        markerFontWeight: '500',
      },
      ul: {
        bulletColor: muted,
        bulletSize: 5,
        marginLeft: 18,
        gapWidth: 8,
      },
      mention: {
        ['@']: {
          backgroundColor: mentionBg,
          color: mentionText,
          textDecorationLine: 'none',
        },
        [SELF_MENTION_INDICATOR]: {
          backgroundColor: mentionYouBg,
          color: mentionYouText,
          textDecorationLine: 'none',
        },
      },
    }),
    [
      actionPrimary,
      brand,
      codeHighlightBackground,
      codeHighlightText,
      inputTextColor,
      mentionBg,
      mentionText,
      mentionYouBg,
      mentionYouText,
      muted,
    ],
  );

  const setMentionSession = useCallback(
    (indicator: string, query = ''): void => {
      setIsMentionOpenState(true);
      setMentionModeState(indicator === '#' ? '#' : '@');
      setMentionQueryState(query);
    },
    [setIsMentionOpenState, setMentionModeState, setMentionQueryState],
  );

  const resetMentionSession = useCallback((): void => {
    setIsMentionOpenState(false);
    setMentionQueryState('');
    setMentionModeState('@');
  }, [setIsMentionOpenState, setMentionModeState, setMentionQueryState]);

  const handleChangeText = useCallback(
    (e: NativeSyntheticEvent<OnChangeTextEvent>): void => {
      const nativeText = e.nativeEvent.value ?? '';
      const previousText = latestTextRef.current;
      const richPaste =
        previousText.length === 0 ? getRichMessageClipboardForPlainText(nativeText) : null;

      if (richPaste) {
        const composerHtml = richPaste.hydratedComposerHtml ?? richPaste.composerHtml;
        // Mark paste consumed so native setValue → onChangeText does not re-enter this path.
        latestTextRef.current = richPaste.plainText;
        latestHtmlRef.current = composerHtml;
        pendingRichPasteRef.current = /<mention\b/i.test(composerHtml)
          ? {
              plainText: richPaste.plainText,
              composerHtml,
            }
          : null;
        pendingRichPasteHydrationRef.current =
          richPaste.hydration && !richPaste.hydratedComposerHtml
            ? {
                plainText: richPaste.plainText,
                copiedAt: richPaste.copiedAt,
              }
            : null;
        setTextState(richPaste.plainText);
        setHtmlState(composerHtml);
        notifyComposerNativeTextChange(richPaste.plainText);
        queueMicrotask(() => {
          inputRef.current?.setValue(composerHtml);
          inputRef.current?.setSelection(richPaste.plainText.length, richPaste.plainText.length);
        });

        if (richPaste.hydration && !richPaste.hydratedComposerHtml) {
          void richPaste.hydration.then(hydratedHtml => {
            const pendingHydration = pendingRichPasteHydrationRef.current;
            if (!hydratedHtml || !pendingHydration) return;
            if (
              pendingHydration.copiedAt !== richPaste.copiedAt ||
              pendingHydration.plainText !== richPaste.plainText
            ) {
              return;
            }
            if (latestTextRef.current.replace(/\u00a0/g, ' ') !== richPaste.plainText) {
              return;
            }

            pendingRichPasteRef.current = /<mention\b/i.test(hydratedHtml)
              ? {
                  plainText: richPaste.plainText,
                  composerHtml: hydratedHtml,
                }
              : null;
            pendingRichPasteHydrationRef.current = null;
            latestHtmlRef.current = hydratedHtml;
            setHtmlState(hydratedHtml);
            queueMicrotask(() => {
              inputRef.current?.setValue(hydratedHtml);
              inputRef.current?.setSelection(
                richPaste.plainText.length,
                richPaste.plainText.length,
              );
            });
          });
        }

        onChangeText?.(e);
        return;
      }

      pendingRichPasteHydrationRef.current = null;
      pendingRichPasteRef.current = null;
      latestTextRef.current = nativeText;
      setTextState(nativeText);
      notifyComposerNativeTextChange(nativeText);
      onChangeText?.(e);

      // Some clipboard HTML (notably div-based content on iOS) is parsed as one line by
      // the native editor. Compare the just-inserted value with the plain clipboard and
      // restore its line breaks. Limit this to an empty composer so existing rich styles
      // cannot be overwritten by the plain-text fallback.
      if (previousText.length === 0 && nativeText.length > 1) {
        void Clipboard.getStringAsync()
          .then(clipboardValue => {
            if (latestTextRef.current !== nativeText) return;
            if (!nativeTextMatchesMultilineClipboard(nativeText, clipboardValue)) return;

            const pastedText = normalizePastedText(clipboardValue);
            const composerHtml = wrapForEnrichedSetValue(plainTextToHtml(pastedText));
            latestTextRef.current = pastedText;
            latestHtmlRef.current = composerHtml;
            setTextState(pastedText);
            setHtmlState(composerHtml);
            notifyComposerNativeTextChange(pastedText);
            queueMicrotask(() => {
              inputRef.current?.setValue(composerHtml);
              inputRef.current?.setSelection(pastedText.length, pastedText.length);
            });
          })
          .catch(error => {
            console.warn(
              '[Composer] Failed to read clipboard; keeping native paste result.',
              error,
            );
          });
      }
    },
    [inputRef, notifyComposerNativeTextChange, onChangeText, setHtmlState, setTextState],
  );

  const handleChangeHtml = useCallback(
    (e: NativeSyntheticEvent<OnChangeHtmlEvent>): void => {
      const nativeHtml = e.nativeEvent.value ?? '';
      latestHtmlRef.current = nativeHtml;
      const pendingRichPaste = pendingRichPasteRef.current;
      if (
        pendingRichPaste &&
        /<mention\b/i.test(pendingRichPaste.composerHtml) &&
        !/<mention\b/i.test(nativeHtml)
      ) {
        return;
      }
      if (pendingRichPaste && /<mention\b/i.test(nativeHtml)) {
        pendingRichPasteRef.current = null;
      }

      setHtmlState(nativeHtml);
      onChangeHtml?.(e);
    },
    [onChangeHtml, setHtmlState],
  );

  const handleChangeState = useCallback(
    (e: NativeSyntheticEvent<OnChangeStateEvent>): void => {
      setStyleState(e.nativeEvent);
      onChangeState?.(e);
    },
    [onChangeState, setStyleState],
  );

  const handleChangeSelection = useCallback(
    (e: NativeSyntheticEvent<OnChangeSelectionEvent>): void => {
      notifyUserSelectionChange(e.nativeEvent.start, e.nativeEvent.end);
      setSelection(e.nativeEvent);
      onChangeSelection?.(e);
    },
    [notifyUserSelectionChange, onChangeSelection, setSelection],
  );

  const handleStartMention = useCallback(
    (indicator: string): void => {
      if (pendingRichPasteRef.current) return;
      setMentionSession(indicator);
      onStartMention?.(indicator);
    },
    [onStartMention, setMentionSession],
  );

  const handleChangeMention = useCallback(
    (e: Parameters<NonNullable<EnrichedTextInputProps['onChangeMention']>>[0]): void => {
      if (pendingRichPasteRef.current) return;
      setMentionSession(e.indicator, e.text ?? '');
      onChangeMention?.(e);
    },
    [onChangeMention, setMentionSession],
  );

  const handleEndMention = useCallback(
    (...args: Parameters<NonNullable<EnrichedTextInputProps['onEndMention']>>): void => {
      resetMentionSession();
      onEndMention?.(...args);
    },
    [onEndMention, resetMentionSession],
  );

  const handleFocus = useCallback(
    (...args: Parameters<NonNullable<EnrichedTextInputProps['onFocus']>>): void => {
      setInputFocused(true);
      onFocus?.(...args);
    },
    [onFocus, setInputFocused],
  );

  const handleBlur = useCallback(
    (...args: Parameters<NonNullable<EnrichedTextInputProps['onBlur']>>): void => {
      setInputFocused(false);
      setUnfocusedPreviewText(latestTextRef.current);
      setUnfocusedPreviewHtml(latestHtmlRef.current);
      flushDraftPersist();
      if (latestTextRef.current.trim().length === 0) {
        setIsFormattingVisibleState(false);
        setIsMentionOpenState(false);
      }
      onBlur?.(...args);
    },
    [
      flushDraftPersist,
      onBlur,
      setInputFocused,
      setIsFormattingVisibleState,
      setIsMentionOpenState,
    ],
  );

  const handlePasteImages = useCallback(
    (e: NativeSyntheticEvent<OnPasteImagesEvent>): void => {
      const images = e.nativeEvent.images ?? [];
      if (images.length === 0 || isPastingAttachmentsRef.current) return;

      isPastingAttachmentsRef.current = true;
      beginAttachmentMutation();

      void (async (): Promise<void> => {
        try {
          const newAttachments = await pastedImagesToComposerAttachments(images);
          if (newAttachments.length === 0) return;

          await ingestComposerAttachments({
            newAttachments,
            existingAttachments: attachments,
            setAttachments,
            uploadDraftAttachments,
            conversationId,
            threadId: threadId ?? null,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Unable to add pasted image as attachment';
          Alert.alert('Attachment unavailable', message);
        } finally {
          isPastingAttachmentsRef.current = false;
          endAttachmentMutation();
        }
      })();
    },
    [
      beginAttachmentMutation,
      conversationId,
      endAttachmentMutation,
      attachments,
      setAttachments,
      threadId,
      uploadDraftAttachments,
    ],
  );
  const resolvedPlaceholder = placeholder ?? defaultPlaceholder;
  const showUnfocusedTextPreview = shouldRenderComposerUnfocusedTextPreview({
    isInputFocused,
    html: unfocusedPreviewHtml,
    text: unfocusedPreviewText,
  });
  const showStatusPlaceholderOverlay = shouldShowComposerStatusPlaceholder({
    hasStatusEmoji: Boolean(statusEmoji),
    isInputFocused,
    hasDraft: hasComposerContent || showUnfocusedTextPreview,
  });
  const showLeadingAttach = !isInputFocused && !isEditing;
  const inputPaddingLeft = composerInputLeadingInset(isInputFocused, showLeadingAttach);
  const inputPaddingRight = composerInputTrailingInset(isInputFocused);
  const truncatedPlaceholder =
    resolvedPlaceholder.length > PLACEHOLDER_MAX_LENGTH
      ? `${resolvedPlaceholder.slice(0, PLACEHOLDER_MAX_LENGTH)}...`
      : resolvedPlaceholder;
  const nativePlaceholder = showStatusPlaceholderOverlay ? ' ' : truncatedPlaceholder;
  const resolvedMentionIndicators = useMemo(
    () => ensureSelfMentionIndicator(mentionIndicators ?? DEFAULT_MENTION_INDICATORS),
    [mentionIndicators],
  );
  const inputStyle = useMemo(
    () => ({
      fontSize: COMPOSER_INPUT_FONT_SIZE,
      lineHeight: COMPOSER_INPUT_LINE_HEIGHT,
      color: inputTextColor,
      // Focus alone must not allocate the multiline height. The native editor
      // grows from this floor only when content wraps, so the dock measures the
      // real field height and the list reserves exactly that same geometry.
      maxHeight: isInputFocused
        ? COMPOSER_INPUT_EXPANDED_MAX_HEIGHT
        : COMPOSER_INPUT_COLLAPSED_HEIGHT,
      minHeight: COMPOSER_INPUT_COLLAPSED_HEIGHT,
      // Padding must live on the native field. Wrap width is textView.frame
      // width; a padded wrapper + width 100% made the editor wrap wider than
      // the visible pill, so words/emoji jumped to the next line when the
      // caret moved.
      paddingLeft: inputPaddingLeft,
      paddingRight: inputPaddingRight,
      // Stretch to the pill on the first layout. Without an explicit width the
      // native editor shrink-wraps to the current line, so the first row leaves
      // a gap and later keystrokes reflow words that should already have fit.
      width: '100%' as const,
      alignSelf: 'stretch' as const,
    }),
    [inputPaddingLeft, inputPaddingRight, inputTextColor, isInputFocused],
  );
  return (
    <View
      className={cn(
        'relative w-full min-w-0 self-stretch gap-2 py-2.5 px-2',
        'bg-conversation-input-bg',
        isTwinEditing ? '' : 'shadow-xs',
        className,
      )}
      style={{ borderRadius: 20, overflow: 'hidden' }}
    >
      <ChatInput.AttachmentsList />
      <View className='relative w-full min-w-0'>
        {showStatusPlaceholderOverlay && statusEmoji ? (
          <View
            pointerEvents='none'
            className='absolute inset-0 z-[1] flex-row items-center overflow-hidden '
            style={{
              paddingLeft: inputPaddingLeft,
              paddingRight: inputPaddingRight,
            }}
          >
            <Text
              className='text-secondary-foreground'
              style={{
                maxWidth: COMPOSER_STATUS_PLACEHOLDER_TEXT_WIDTH,
                fontSize: COMPOSER_INPUT_FONT_SIZE,
                lineHeight: COMPOSER_INPUT_LINE_HEIGHT,
                ...(Platform.OS === 'android' ? { includeFontPadding: false } : {}),
              }}
              numberOfLines={1}
              ellipsizeMode='tail'
            >
              {resolvedPlaceholder}
            </Text>
            <View className='ml-1 shrink-0'>
              <ReactionEmojiDisplay emojiName={statusEmoji} size={COMPOSER_INPUT_FONT_SIZE} />
            </View>
          </View>
        ) : null}

        {showUnfocusedTextPreview ? (
          <View
            pointerEvents='none'
            className='absolute inset-0 z-[2] flex-row items-center overflow-hidden bg-conversation-input-bg'
            style={{
              paddingLeft: inputPaddingLeft,
              paddingRight: inputPaddingRight,
            }}
          >
            <ComposerUnfocusedPreview
              html={unfocusedPreviewHtml}
              fallbackText={unfocusedPreviewText}
              textColor={inputTextColor}
              mentionBg={mentionBg}
              mentionText={mentionText}
            />
          </View>
        ) : null}

        {!showLeadingAttach ? null : (
          <View className='absolute left-0 top-0 bottom-0 z-10 justify-center'>
            <ChatInput.AttachmentAction />
          </View>
        )}
        <EnrichedTextInput
          ref={inputRef}
          {...restProps}
          scrollEnabled={isInputFocused}
          {...(editDefaultValue ? { defaultValue: editDefaultValue } : {})}
          placeholder={nativePlaceholder}
          placeholderTextColor={placeholderTextColor}
          cursorColor={cursorColor}
          htmlStyle={htmlStyle}
          onChangeText={handleChangeText}
          onChangeHtml={handleChangeHtml}
          onChangeState={handleChangeState}
          onChangeSelection={handleChangeSelection}
          mentionIndicators={resolvedMentionIndicators}
          onStartMention={handleStartMention}
          onChangeMention={handleChangeMention}
          onEndMention={handleEndMention}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onPasteImages={handlePasteImages}
          style={inputStyle}
          allowFontScaling={false}
          editable={disabled ? false : editable}
          accessibilityState={{ disabled }}
        />
      </View>
      {isInputFocused ? (
        <View className='w-full flex-row items-center'>
          <View className='min-w-0 flex-1 flex-row items-center gap-2'>
            <ChatInput.AttachmentAction />
            <ChatInput.Actions className='' />
          </View>
          <ChatInput.Send />
        </View>
      ) : null}
    </View>
  );
};
const Input = memo(InputComponent);
Input.displayName = 'ChatInput.Input';

export { Input };
