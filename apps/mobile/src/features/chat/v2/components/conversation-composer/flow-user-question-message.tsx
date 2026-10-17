import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactElement,
  type RefObject,
} from 'react';
import {
  Pressable,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { Button } from '@/src/components/ui/button';
import Avatar from '@/src/components/ui/avatar';
import { useUserSnapshot } from '@/src/components/ui/avatar/avatar.utils';
import { Check, Plus } from 'lucide-react-native';
import {
  findFirstIncompleteRequiredQuestionIndex,
  formatQuestionAnswerSummary,
  isQuestionComplete,
  SKIP_QUESTION_LABEL,
  type UserQuestionItem,
  type UserQuestionViewModel,
} from '@/src/utils/flowUserQuestionUtils';

import { dismissRegisteredComposerFocus } from '@/src/utils/composerFocusDismissRegistry';
import { suppressListTapDismissKeyboard } from '@/src/utils/listTapDismissSuppression';

import { useConversationComposer } from './conversation-composer-context';
import {
  FlowCardBody,
  FlowCardHeader,
  useFlowCardQuestionOptionColors,
  type FlowCardQuestionOptionColors,
} from './flow-card';
import { PARAGRAPH_LINE_HEIGHT } from './utils/markdownStyle';

type FlowUserQuestionMessageProps = {
  viewModel: UserQuestionViewModel;
  titleStyle: TextStyle;
  containerStyle?: StyleProp<ViewStyle>;
  canInteract: boolean;
  isSubmitting: boolean;
  answers: Record<string, string | string[]>;
  notes: Record<string, string>;
  onAnswersChange: (answers: Record<string, string | string[]>) => void;
  onNotesChange: (notes: Record<string, string>) => void;
  onSubmit: () => void;
  onValidationError: (message: string) => void;
};

const mergeAnswers = (
  current: Record<string, string | string[]>,
  questionId: string,
  value: string | string[],
): Record<string, string | string[]> => ({
  ...current,
  [questionId]: value,
});

const focusTextInput = (inputRef: RefObject<TextInput | null>): void => {
  requestAnimationFrame(() => {
    inputRef.current?.focus();
  });
};

const SELECTION_INDICATOR_SIZE = 18;

type SelectionMode = 'single' | 'multiple';

const SelectionIndicator = ({
  selected,
  mode,
  colors,
}: {
  selected: boolean;
  mode: SelectionMode;
  colors: FlowCardQuestionOptionColors;
}): ReactElement => {
  const borderColor = selected ? colors.indicatorFill : colors.indicatorEmpty;

  if (mode === 'single') {
    return (
      <View
        style={{
          width: SELECTION_INDICATOR_SIZE,
          height: SELECTION_INDICATOR_SIZE,
          borderRadius: SELECTION_INDICATOR_SIZE / 2,
          borderWidth: 1.5,
          borderColor,
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 1,
        }}
      >
        {selected ? (
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: colors.indicatorFill,
            }}
          />
        ) : null}
      </View>
    );
  }

  return (
    <View
      style={{
        width: SELECTION_INDICATOR_SIZE,
        height: SELECTION_INDICATOR_SIZE,
        borderRadius: 4,
        borderWidth: 1.5,
        borderColor,
        backgroundColor: selected ? colors.indicatorFill : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 1,
      }}
    >
      {selected ? <Check size={12} color={colors.indicatorCheck} strokeWidth={2.5} /> : null}
    </View>
  );
};

const getOptionRowStyle = (selected: boolean, colors: FlowCardQuestionOptionColors): ViewStyle => ({
  borderWidth: 1,
  borderColor: selected ? colors.borderSelected : colors.borderDefault,
  borderRadius: 8,
  paddingHorizontal: 10,
  paddingVertical: 8,
  backgroundColor: selected ? 'transparent' : colors.rowBackground,
  minWidth: 0,
});

const getInlineTextInputStyle = (
  colors: FlowCardQuestionOptionColors,
  minHeight: number,
): TextStyle => ({
  minHeight,
  borderWidth: 1,
  borderColor: colors.inputBorder,
  borderRadius: 8,
  paddingHorizontal: 10,
  paddingVertical: 8,
  textAlignVertical: 'top',
  color: colors.inputText,
  backgroundColor: colors.inputBackground,
});

const FlowUserQuestionMessageComponent = ({
  viewModel,
  titleStyle,
  containerStyle,
  canInteract,
  isSubmitting,
  answers,
  notes,
  onAnswersChange,
  onNotesChange,
  onSubmit,
  onValidationError,
}: FlowUserQuestionMessageProps): ReactElement => {
  const { suppressBubblePress } = useConversationComposer();
  const optionColors = useFlowCardQuestionOptionColors();
  const [activeIndex, setActiveIndex] = useState(0);
  const [showSomethingElse, setShowSomethingElse] = useState(false);
  const somethingElseInputRef = useRef<TextInput>(null);
  const openEndedInputRef = useRef<TextInput>(null);

  const prepareInlineTextInputFocus = useCallback((): void => {
    suppressBubblePress();
    suppressListTapDismissKeyboard();
    dismissRegisteredComposerFocus();
  }, [suppressBubblePress]);

  const handleTextInputPressIn = useCallback(
    (event: GestureResponderEvent, inputRef: RefObject<TextInput | null>): void => {
      event.stopPropagation();
      prepareInlineTextInputFocus();
      focusTextInput(inputRef);
    },
    [prepareInlineTextInputFocus],
  );

  const handleTextInputFocus = useCallback((): void => {
    prepareInlineTextInputFocus();
  }, [prepareInlineTextInputFocus]);

  useEffect(() => {
    if (!showSomethingElse) return;
    prepareInlineTextInputFocus();
    focusTextInput(somethingElseInputRef);
  }, [prepareInlineTextInputFocus, showSomethingElse, activeIndex]);

  const isTerminal = viewModel.phase !== 'pending';
  const totalQuestions = viewModel.questions.length;
  const activeQuestion = viewModel.questions[activeIndex];
  const headerTitle =
    totalQuestions > 1 && !isTerminal
      ? `${viewModel.title}  ${activeIndex + 1}/${totalQuestions}`
      : viewModel.title;

  const resetSomethingElse = useCallback((): void => {
    setShowSomethingElse(false);
  }, []);

  const clearQuestionCustomNote = useCallback(
    (questionId: string): void => {
      if (!notes[questionId]) return;
      onNotesChange({ ...notes, [questionId]: '' });
    },
    [notes, onNotesChange],
  );

  const clearQuestionAnswers = useCallback(
    (question: UserQuestionItem): void => {
      // Omit the key entirely. Backend treats `answers[id] === ''` as an
      // invalid option even when a "Something else" note is present (400).
      if (!(question.id in answers)) return;
      const next = { ...answers };
      delete next[question.id];
      onAnswersChange(next);
    },
    [answers, onAnswersChange],
  );

  const selectPredefinedOption = useCallback(
    (question: UserQuestionItem, value: string | string[]): void => {
      resetSomethingElse();
      clearQuestionCustomNote(question.id);
      onAnswersChange(mergeAnswers(answers, question.id, value));
    },
    [answers, clearQuestionCustomNote, onAnswersChange, resetSomethingElse],
  );

  const openCustomAnswer = useCallback(
    (question: UserQuestionItem): void => {
      clearQuestionAnswers(question);
      prepareInlineTextInputFocus();
      setShowSomethingElse(true);
    },
    [clearQuestionAnswers, prepareInlineTextInputFocus],
  );

  const goToQuestion = useCallback(
    (index: number): void => {
      setActiveIndex(index);
      resetSomethingElse();
    },
    [resetSomethingElse],
  );

  const writeSkipAnswer = useCallback(
    (question: UserQuestionItem): void => {
      onAnswersChange(
        mergeAnswers(
          answers,
          question.id,
          question.type === 'multiple_choice' ? [SKIP_QUESTION_LABEL] : SKIP_QUESTION_LABEL,
        ),
      );
    },
    [answers, onAnswersChange],
  );

  const handleSkip = useCallback((): void => {
    if (!activeQuestion || !canInteract || isSubmitting) return;
    writeSkipAnswer(activeQuestion);
    if (activeIndex >= totalQuestions - 1) {
      onSubmit();
      return;
    }
    goToQuestion(activeIndex + 1);
  }, [
    activeIndex,
    activeQuestion,
    canInteract,
    goToQuestion,
    isSubmitting,
    onSubmit,
    totalQuestions,
    writeSkipAnswer,
  ]);

  const handleBack = useCallback((): void => {
    if (activeIndex <= 0) return;
    goToQuestion(activeIndex - 1);
  }, [activeIndex, goToQuestion]);

  const validateAllRequired = useCallback((): number => {
    const incompleteIndex = findFirstIncompleteRequiredQuestionIndex(
      viewModel.questions,
      answers,
      notes,
    );
    if (incompleteIndex >= 0) {
      onValidationError('Please answer each required question before submitting.');
      goToQuestion(incompleteIndex);
    }
    return incompleteIndex;
  }, [answers, goToQuestion, notes, onValidationError, viewModel.questions]);

  const handleNext = useCallback((): void => {
    if (!activeQuestion || !canInteract || isSubmitting) return;

    if (activeQuestion.required && !isQuestionComplete(activeQuestion, answers, notes)) {
      onValidationError('Please answer this question before continuing.');
      return;
    }

    if (activeIndex >= totalQuestions - 1) {
      if (validateAllRequired() >= 0) return;
      onSubmit();
      return;
    }

    goToQuestion(activeIndex + 1);
  }, [
    activeIndex,
    activeQuestion,
    answers,
    canInteract,
    goToQuestion,
    isSubmitting,
    notes,
    onSubmit,
    onValidationError,
    totalQuestions,
    validateAllRequired,
  ]);

  const renderOptionRow = (
    question: UserQuestionItem,
    option: { label: string; description?: string },
    selected: boolean,
    selectionMode: SelectionMode,
    onPress: () => void,
  ): ReactElement => {
    const live = canInteract && !isSubmitting;
    const rowStyle = getOptionRowStyle(selected, optionColors);

    const content = (
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, minWidth: 0 }}>
        <SelectionIndicator selected={selected} mode={selectionMode} colors={optionColors} />
        <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
          <Text className='text-sm font-medium text-foreground'>{option.label}</Text>
          {option.description ? (
            <Text className='text-xs text-foreground'>{option.description}</Text>
          ) : null}
        </View>
      </View>
    );

    if (!live) {
      return (
        <View key={`${question.id}-${option.label}`} style={rowStyle}>
          {content}
        </View>
      );
    }

    return (
      <Pressable
        key={`${question.id}-${option.label}`}
        accessibilityRole={selectionMode === 'single' ? 'radio' : 'checkbox'}
        accessibilityState={{ selected, checked: selected }}
        onPressIn={event => {
          event.stopPropagation();
          suppressBubblePress();
        }}
        onPress={event => {
          event.stopPropagation();
          onPress();
        }}
        style={({ pressed }) => [rowStyle, pressed ? { opacity: 0.75 } : null]}
      >
        {content}
      </Pressable>
    );
  };

  const renderInlineTextInput = (
    inputRef: RefObject<TextInput | null>,
    inputProps: ComponentProps<typeof TextInput>,
  ): ReactElement => (
    <View
      onStartShouldSetResponderCapture={() => {
        prepareInlineTextInputFocus();
        return false;
      }}
    >
      <TextInput
        ref={inputRef}
        showSoftInputOnFocus
        placeholderTextColor={optionColors.inputPlaceholder}
        onPressIn={event => handleTextInputPressIn(event, inputRef)}
        onFocus={handleTextInputFocus}
        {...inputProps}
      />
    </View>
  );

  const renderQuestionInput = (question: UserQuestionItem): ReactElement | null => {
    if (question.type === 'open_ended') {
      const answer = answers[question.id];
      const value = typeof answer === 'string' ? answer : '';
      return renderInlineTextInput(openEndedInputRef, {
        value,
        editable: canInteract && !isSubmitting,
        multiline: true,
        placeholder: question.placeholder || 'Type your answer',
        onChangeText: text => onAnswersChange(mergeAnswers(answers, question.id, text)),
        style: getInlineTextInputStyle(optionColors, 88),
      });
    }

    if (question.type === 'single_choice') {
      const selected = typeof answers[question.id] === 'string' ? answers[question.id] : '';
      return (
        <View style={{ gap: 8 }}>
          {question.options.map(option =>
            renderOptionRow(question, option, selected === option.label, 'single', () => {
              selectPredefinedOption(question, option.label);
            }),
          )}
        </View>
      );
    }

    const selectedValues = Array.isArray(answers[question.id])
      ? (answers[question.id] as string[])
      : [];

    return (
      <View style={{ gap: 8 }}>
        {question.options.map(option =>
          renderOptionRow(
            question,
            option,
            selectedValues.includes(option.label),
            'multiple',
            () => {
              const isCurrentlySelected = selectedValues.includes(option.label);
              const next = isCurrentlySelected
                ? selectedValues.filter(item => item !== option.label)
                : [...selectedValues, option.label];

              if (!isCurrentlySelected) {
                resetSomethingElse();
                clearQuestionCustomNote(question.id);
              }
              onAnswersChange(mergeAnswers(answers, question.id, next));
            },
          ),
        )}
      </View>
    );
  };

  const renderSomethingElse = (question: UserQuestionItem): ReactElement | null => {
    if (question.type === 'open_ended') return null;

    const noteValue = notes[question.id] ?? '';
    const selectionMode: SelectionMode =
      question.type === 'multiple_choice' ? 'multiple' : 'single';
    const isCustomActive = showSomethingElse || noteValue.trim().length > 0;
    const rowStyle = getOptionRowStyle(isCustomActive, optionColors);
    const live = canInteract && !isSubmitting;

    const rowContent = (
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, minWidth: 0 }}>
        {isCustomActive ? (
          <SelectionIndicator selected mode={selectionMode} colors={optionColors} />
        ) : (
          <View
            style={{
              width: SELECTION_INDICATOR_SIZE,
              height: SELECTION_INDICATOR_SIZE,
              borderRadius: selectionMode === 'single' ? SELECTION_INDICATOR_SIZE / 2 : 4,
              borderWidth: 1.5,
              borderColor: optionColors.indicatorEmpty,
              borderStyle: 'dashed',
              alignItems: 'center',
              justifyContent: 'center',
              marginTop: 1,
            }}
          >
            <Plus size={11} color={optionColors.plusIcon} strokeWidth={2.5} />
          </View>
        )}
        <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
          <Text className='text-sm font-medium text-foreground'>Something else...</Text>
          <Text className='text-xs text-foreground'>
            {isCustomActive ? 'Add a custom answer below' : 'Tap to add a custom answer'}
          </Text>
        </View>
      </View>
    );

    const openCustomAnswerForQuestion = (): void => {
      openCustomAnswer(question);
    };

    return (
      <View style={{ gap: 8 }}>
        {live ? (
          <Pressable
            accessibilityRole='button'
            accessibilityHint='Opens a field to type a custom answer'
            onPressIn={event => {
              event.stopPropagation();
              prepareInlineTextInputFocus();
            }}
            onPress={event => {
              event.stopPropagation();
              openCustomAnswerForQuestion();
            }}
            style={({ pressed }) => [rowStyle, pressed ? { opacity: 0.75 } : null]}
          >
            {rowContent}
          </Pressable>
        ) : noteValue ? (
          <View style={rowStyle}>{rowContent}</View>
        ) : null}
        {isCustomActive
          ? renderInlineTextInput(somethingElseInputRef, {
              value: noteValue,
              editable: canInteract && !isSubmitting,
              multiline: true,
              placeholder: 'Add a custom answer',
              onChangeText: text => onNotesChange({ ...notes, [question.id]: text }),
              style: getInlineTextInputStyle(optionColors, 72),
            })
          : null}
      </View>
    );
  };

  const terminalContent = useMemo(
    () =>
      viewModel.questions.map(question => (
        <View key={question.id} style={{ gap: 4, minWidth: 0 }}>
          <Text className='text-sm font-semibold text-foreground'>{question.question}</Text>
          <Text className='text-sm text-foreground'>
            {formatQuestionAnswerSummary(
              question,
              viewModel.persistedAnswers,
              viewModel.persistedNotes,
              viewModel.phase,
            )}
          </Text>
        </View>
      )),
    [viewModel.persistedAnswers, viewModel.persistedNotes, viewModel.phase, viewModel.questions],
  );

  const submitterUserId = viewModel.submitterUserId;
  const submitter = useUserSnapshot(submitterUserId ?? '');
  const submitterName =
    submitter?.displayName?.trim() ||
    submitter?.name?.trim() ||
    viewModel.submitterNameFallback?.trim() ||
    (submitterUserId ? 'You' : undefined);

  return (
    <FlowCardBody containerStyle={containerStyle} gap={8}>
      <FlowCardHeader
        title={headerTitle}
        titleStyle={{
          fontSize: titleStyle.fontSize,
          lineHeight: titleStyle.lineHeight ?? PARAGRAPH_LINE_HEIGHT,
        }}
      />

      {isTerminal ? (
        <View style={{ gap: 10 }}>{terminalContent}</View>
      ) : activeQuestion ? (
        <View style={{ gap: 10, minWidth: 0 }}>
          <Text className='text-base text-foreground'>{activeQuestion.question}</Text>
          {renderQuestionInput(activeQuestion)}
          {renderSomethingElse(activeQuestion)}
        </View>
      ) : null}

      {isTerminal && viewModel.submitterLabel ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            minWidth: 0,
            marginTop: 2,
          }}
        >
          <Text className='text-xs font-semibold text-gray-500'>{viewModel.submitterLabel}</Text>
          <View
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}
          >
            {submitterUserId ? (
              <Avatar userIds={[submitterUserId]} size={18} rounded={false} />
            ) : null}
            {submitterName ? (
              <Text className='shrink text-xs font-semibold text-foreground' numberOfLines={1}>
                {submitterName}
              </Text>
            ) : null}
          </View>
        </View>
      ) : viewModel.auditLine ? (
        <Text className='text-sm text-foreground'>{viewModel.auditLine}</Text>
      ) : null}

      {!isTerminal && canInteract ? (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 8,
            marginTop: 2,
            minWidth: 0,
            maxWidth: '100%',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <Button
            size='xs'
            label='Skip'
            variant='secondary'
            disabled={isSubmitting}
            loading={isSubmitting}
            onPressIn={event => {
              event.stopPropagation();
              suppressBubblePress();
            }}
            onPress={event => {
              event.stopPropagation();
              handleSkip();
            }}
          />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {activeIndex > 0 ? (
              <Button
                size='xs'
                label='Back'
                variant='secondary'
                disabled={isSubmitting}
                onPressIn={event => {
                  event.stopPropagation();
                  suppressBubblePress();
                }}
                onPress={event => {
                  event.stopPropagation();
                  handleBack();
                }}
              />
            ) : null}
            <Button
              size='xs'
              label={activeIndex >= totalQuestions - 1 ? 'Submit' : 'Next'}
              variant='primary'
              disabled={isSubmitting}
              loading={isSubmitting}
              onPressIn={event => {
                event.stopPropagation();
                suppressBubblePress();
              }}
              onPress={event => {
                event.stopPropagation();
                handleNext();
              }}
            />
          </View>
        </View>
      ) : null}
    </FlowCardBody>
  );
};

const FlowUserQuestionMessage = memo(FlowUserQuestionMessageComponent);
FlowUserQuestionMessage.displayName = 'FlowUserQuestionMessage';

export { FlowUserQuestionMessage };
