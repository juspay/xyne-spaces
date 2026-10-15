import { memo, useCallback, useEffect, useRef, type ReactElement } from 'react';
import { TextInput, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import {
  findFirstIncompleteRequiredQuestionIndex,
  isQuestionComplete,
  SKIP_QUESTION_LABEL,
  type UserQuestionItem,
  type UserQuestionViewModel,
} from '@/src/utils/flowUserQuestionUtils';
import { dismissRegisteredComposerFocus } from '@/src/utils/composerFocusDismissRegistry';
import { suppressListTapDismissKeyboard } from '@/src/utils/listTapDismissSuppression';

import { FlowCardBody, FlowCardHeader, useFlowCardQuestionOptionColors } from './FlowCard';
import { FlowUserQuestionActions } from './FlowUserQuestionActions';
import { FlowUserQuestionActiveBody } from './FlowUserQuestionActiveBody';
import { FlowUserQuestionTerminal } from './FlowUserQuestionTerminal';
import { mergeFlowQuestionAnswer, removeFlowQuestionAnswer } from './userQuestionState';
import { useRecyclingState } from '../useRecyclingState';
import { focusFlowQuestionInput } from './FlowUserQuestionControls';

type FlowUserQuestionCardProps = {
  viewModel: UserQuestionViewModel;
  titleStyle: Pick<TextStyle, 'fontSize' | 'lineHeight'>;
  containerStyle?: StyleProp<ViewStyle>;
  recyclingKey: string;
  canInteract: boolean;
  isSubmitting: boolean;
  answers: Record<string, string | string[]>;
  notes: Record<string, string>;
  onAnswersChange: (answers: Record<string, string | string[]>) => void;
  onNotesChange: (notes: Record<string, string>) => void;
  onSubmit: () => void;
  onValidationError: (message: string) => void;
};

export const FlowUserQuestionCard = memo(function FlowUserQuestionCard({
  viewModel,
  titleStyle,
  containerStyle,
  recyclingKey,
  canInteract,
  isSubmitting,
  answers,
  notes,
  onAnswersChange,
  onNotesChange,
  onSubmit,
  onValidationError,
}: FlowUserQuestionCardProps): ReactElement {
  const colors = useFlowCardQuestionOptionColors();
  const [activeIndex, setActiveIndex] = useRecyclingState(`${recyclingKey}:question-index`, 0);
  const [showSomethingElse, setShowSomethingElse] = useRecyclingState(
    `${recyclingKey}:question-custom`,
    false,
  );
  const somethingElseInputRef = useRef<TextInput>(null);
  const openEndedInputRef = useRef<TextInput>(null);
  const totalQuestions = viewModel.questions.length;
  const currentIndex = Math.min(Math.max(activeIndex, 0), Math.max(totalQuestions - 1, 0));
  const activeQuestion = viewModel.questions[currentIndex];
  const isTerminal = viewModel.phase !== 'pending';

  const prepareInlineTextInputFocus = useCallback((): void => {
    suppressListTapDismissKeyboard();
    dismissRegisteredComposerFocus();
  }, []);

  useEffect(() => {
    if (!showSomethingElse || isTerminal) return;
    prepareInlineTextInputFocus();
    focusFlowQuestionInput(somethingElseInputRef);
  }, [currentIndex, isTerminal, prepareInlineTextInputFocus, showSomethingElse]);

  const resetSomethingElse = useCallback((): void => {
    setShowSomethingElse(false);
  }, [setShowSomethingElse]);

  const clearQuestionCustomNote = useCallback(
    (questionId: string): void => {
      if (!notes[questionId]) return;
      onNotesChange({ ...notes, [questionId]: '' });
    },
    [notes, onNotesChange],
  );

  const clearQuestionAnswers = useCallback(
    (question: UserQuestionItem): void => {
      const next = removeFlowQuestionAnswer(answers, question);
      if (next !== answers) onAnswersChange(next);
    },
    [answers, onAnswersChange],
  );

  const selectPredefinedOption = useCallback(
    (question: UserQuestionItem, value: string): void => {
      resetSomethingElse();
      clearQuestionCustomNote(question.id);
      onAnswersChange(mergeFlowQuestionAnswer(answers, question.id, value));
    },
    [answers, clearQuestionCustomNote, onAnswersChange, resetSomethingElse],
  );

  const openCustomAnswer = useCallback(
    (question: UserQuestionItem): void => {
      clearQuestionAnswers(question);
      prepareInlineTextInputFocus();
      setShowSomethingElse(true);
    },
    [clearQuestionAnswers, prepareInlineTextInputFocus, setShowSomethingElse],
  );

  const goToQuestion = useCallback(
    (index: number): void => {
      setActiveIndex(Math.min(Math.max(index, 0), Math.max(totalQuestions - 1, 0)));
      resetSomethingElse();
    },
    [resetSomethingElse, setActiveIndex, totalQuestions],
  );

  const writeSkipAnswer = useCallback(
    (question: UserQuestionItem): void => {
      onAnswersChange(
        mergeFlowQuestionAnswer(
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
    if (currentIndex >= totalQuestions - 1) {
      onSubmit();
    } else {
      goToQuestion(currentIndex + 1);
    }
  }, [
    activeQuestion,
    canInteract,
    currentIndex,
    goToQuestion,
    isSubmitting,
    onSubmit,
    totalQuestions,
    writeSkipAnswer,
  ]);

  const handleBack = useCallback((): void => {
    if (currentIndex > 0) goToQuestion(currentIndex - 1);
  }, [currentIndex, goToQuestion]);

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
    if (currentIndex >= totalQuestions - 1) {
      if (validateAllRequired() < 0) onSubmit();
    } else {
      goToQuestion(currentIndex + 1);
    }
  }, [
    activeQuestion,
    answers,
    canInteract,
    currentIndex,
    goToQuestion,
    isSubmitting,
    notes,
    onSubmit,
    onValidationError,
    totalQuestions,
    validateAllRequired,
  ]);

  const headerTitle =
    totalQuestions > 1 && !isTerminal
      ? `${viewModel.title}  ${currentIndex + 1}/${totalQuestions}`
      : viewModel.title;

  return (
    <FlowCardBody containerStyle={containerStyle} gap={8}>
      <FlowCardHeader
        title={headerTitle}
        titleStyle={{ fontSize: titleStyle.fontSize, lineHeight: titleStyle.lineHeight ?? 20 }}
      />
      {isTerminal ? (
        <FlowUserQuestionTerminal viewModel={viewModel} />
      ) : activeQuestion ? (
        <FlowUserQuestionActiveBody
          question={activeQuestion}
          answers={answers}
          notes={notes}
          canInteract={canInteract}
          isSubmitting={isSubmitting}
          showSomethingElse={showSomethingElse}
          colors={colors}
          somethingElseInputRef={somethingElseInputRef}
          openEndedInputRef={openEndedInputRef}
          onPrepareFocus={prepareInlineTextInputFocus}
          onAnswersChange={onAnswersChange}
          onNotesChange={onNotesChange}
          onSelectPredefined={selectPredefinedOption}
          onResetSomethingElse={resetSomethingElse}
          onClearQuestionCustomNote={clearQuestionCustomNote}
          onOpenCustomAnswer={openCustomAnswer}
        />
      ) : null}
      {!isTerminal && canInteract ? (
        <FlowUserQuestionActions
          currentIndex={currentIndex}
          totalQuestions={totalQuestions}
          isSubmitting={isSubmitting}
          onSkip={handleSkip}
          onBack={handleBack}
          onNext={handleNext}
        />
      ) : null}
    </FlowCardBody>
  );
});
FlowUserQuestionCard.displayName = 'FlowUserQuestionCard';
