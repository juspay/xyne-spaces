import { type ReactElement, type RefObject } from 'react';
import { Text, TextInput, View } from 'react-native';

import type { FlowCardQuestionOptionColors } from './FlowCard';
import {
  FlowQuestionCustomOption,
  FlowQuestionOptionRow,
  FlowQuestionTextInput,
  flowQuestionTextInputStyle,
  type FlowQuestionSelectionMode,
} from './FlowUserQuestionControls';
import { mergeFlowQuestionAnswer, type UserQuestionItem } from './userQuestionState';

type FlowUserQuestionActiveBodyProps = {
  question: UserQuestionItem;
  answers: Record<string, string | string[]>;
  notes: Record<string, string>;
  canInteract: boolean;
  isSubmitting: boolean;
  showSomethingElse: boolean;
  colors: FlowCardQuestionOptionColors;
  somethingElseInputRef: RefObject<TextInput | null>;
  openEndedInputRef: RefObject<TextInput | null>;
  onPrepareFocus: () => void;
  onAnswersChange: (answers: Record<string, string | string[]>) => void;
  onNotesChange: (notes: Record<string, string>) => void;
  onSelectPredefined: (question: UserQuestionItem, value: string) => void;
  onResetSomethingElse: () => void;
  onClearQuestionCustomNote: (questionId: string) => void;
  onOpenCustomAnswer: (question: UserQuestionItem) => void;
};

export const FlowUserQuestionActiveBody = ({
  question,
  answers,
  notes,
  canInteract,
  isSubmitting,
  showSomethingElse,
  colors,
  somethingElseInputRef,
  openEndedInputRef,
  onPrepareFocus,
  onAnswersChange,
  onNotesChange,
  onSelectPredefined,
  onResetSomethingElse,
  onClearQuestionCustomNote,
  onOpenCustomAnswer,
}: FlowUserQuestionActiveBodyProps): ReactElement => {
  const renderQuestionInput = (): ReactElement | null => {
    if (question.type === 'open_ended') {
      const answer = answers[question.id];
      return (
        <FlowQuestionTextInput
          inputRef={openEndedInputRef}
          colors={colors}
          onPrepareFocus={onPrepareFocus}
          inputProps={{
            value: typeof answer === 'string' ? answer : '',
            editable: canInteract && !isSubmitting,
            multiline: true,
            placeholder: question.placeholder || 'Type your answer',
            onChangeText: text =>
              onAnswersChange(mergeFlowQuestionAnswer(answers, question.id, text)),
            style: flowQuestionTextInputStyle(colors, 88),
          }}
        />
      );
    }

    const selectionMode: FlowQuestionSelectionMode =
      question.type === 'multiple_choice' ? 'multiple' : 'single';
    const selectedValues = Array.isArray(answers[question.id])
      ? (answers[question.id] as string[])
      : [];
    const selected =
      question.type === 'single_choice' && typeof answers[question.id] === 'string'
        ? answers[question.id]
        : '';

    return (
      <View style={{ gap: 8 }}>
        {question.options.map(option => (
          <FlowQuestionOptionRow
            key={`${question.id}-${option.label}`}
            questionId={question.id}
            option={option}
            selected={
              question.type === 'single_choice'
                ? selected === option.label
                : selectedValues.includes(option.label)
            }
            selectionMode={selectionMode}
            live={canInteract}
            isSubmitting={isSubmitting}
            colors={colors}
            onPress={() => {
              if (question.type === 'single_choice') {
                onSelectPredefined(question, option.label);
                return;
              }
              const isSelected = selectedValues.includes(option.label);
              if (!isSelected) {
                onResetSomethingElse();
                onClearQuestionCustomNote(question.id);
              }
              onAnswersChange(
                mergeFlowQuestionAnswer(
                  answers,
                  question.id,
                  isSelected
                    ? selectedValues.filter(item => item !== option.label)
                    : [...selectedValues, option.label],
                ),
              );
            }}
          />
        ))}
      </View>
    );
  };

  const selectionMode: FlowQuestionSelectionMode =
    question.type === 'multiple_choice' ? 'multiple' : 'single';
  return (
    <View style={{ gap: 10, minWidth: 0 }}>
      <Text className='text-base text-foreground'>{question.question}</Text>
      {renderQuestionInput()}
      {question.type !== 'open_ended' ? (
        <FlowQuestionCustomOption
          question={question}
          selectionMode={selectionMode}
          isActive={showSomethingElse}
          note={notes[question.id] ?? ''}
          live={canInteract}
          isSubmitting={isSubmitting}
          colors={colors}
          inputRef={somethingElseInputRef}
          onPrepareFocus={onPrepareFocus}
          onOpen={() => onOpenCustomAnswer(question)}
          onChangeText={text => onNotesChange({ ...notes, [question.id]: text })}
        />
      ) : null}
    </View>
  );
};
