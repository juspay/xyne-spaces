import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useFlow } from '../FlowContext';
import type { FlowAction, FlowComponent, UserQuestionItem } from '@xyne/shared';

interface UserQuestionNodeProps {
  node: FlowComponent;
  children?: React.ReactNode;
}

type Answers = Record<string, string | string[]>;
const SKIP_QUESTION_OPTION = 'Skip this question';

/**
 * The thread counterpart to PlanNode: one self-contained FlowJSON artifact
 * instead of a trail of button messages. A tab selects the prompt to answer;
 * answers remain in FlowRenderer state, so switching tabs never loses input.
 */
export const UserQuestionNode: React.FC<UserQuestionNodeProps> = ({ node }) => {
  const props = node.props as
    | {
        title: string;
        questions: UserQuestionItem[];
        phase?: 'pending' | 'answered' | 'declined';
        answers?: Answers;
        notes?: Record<string, string>;
        submitAction?: FlowAction;
        dismissAction?: FlowAction;
      }
    | undefined;
  const { state, updateFieldValue, executeAction } = useFlow();
  const [activeIndex, setActiveIndex] = useState(0);

  // Question-set cards posted before terminal phases were introduced do not
  // have `phase`. Treat them as pending so opening an older thread never tries
  // to read a non-existent persisted `answers` object.
  const phase = props?.phase ?? 'pending';
  const terminal = phase !== 'pending';
  const answers = (terminal ? (props?.answers ?? {}) : (state.values['answers'] ?? {})) as Answers;
  const notes = (terminal ? (props?.notes ?? {}) : (state.values['notes'] ?? {})) as Record<
    string,
    string
  >;
  const activeQuestion = props?.questions[activeIndex];
  const requiredQuestions = useMemo(
    () => props?.questions.filter(question => question.required !== false) ?? [],
    [props?.questions],
  );

  if (!props || !activeQuestion) return null;

  const updateAnswer = (questionId: string, value: string | string[]) => {
    updateFieldValue('answers', { ...answers, [questionId]: value });
  };

  const toggleMultipleChoice = (option: string, checked: boolean) => {
    const selected = Array.isArray(answers[activeQuestion.id])
      ? (answers[activeQuestion.id] as string[])
      : [];
    if (option === SKIP_QUESTION_OPTION && checked) {
      updateAnswer(activeQuestion.id, [SKIP_QUESTION_OPTION]);
      return;
    }
    updateAnswer(
      activeQuestion.id,
      checked
        ? [...selected.filter(value => value !== SKIP_QUESTION_OPTION), option]
        : selected.filter(value => value !== option),
    );
  };

  const hasAnswer = (question: UserQuestionItem) => {
    const answer = answers[question.id];
    return Array.isArray(answer)
      ? answer.length > 0
      : typeof answer === 'string' && answer.trim().length > 0;
  };

  const isQuestionComplete = (question: UserQuestionItem) =>
    hasAnswer(question) || Boolean(notes[question.id]?.trim());

  const submit = () => {
    const unanswered = requiredQuestions.find(question => !isQuestionComplete(question));
    if (unanswered) {
      const index = props.questions.findIndex(question => question.id === unanswered.id);
      setActiveIndex(Math.max(0, index));
      toast.error('Please answer each required question before submitting.');
      return;
    }
    if (props.submitAction) void executeAction(props.submitAction);
  };

  const selectedAnswer = answers[activeQuestion.id];
  return (
    <section
      className='flex w-[450px] max-w-full flex-col overflow-hidden rounded-xl border border-border bg-muted/40'
      style={node.style}
    >
      <div className={`flex flex-col gap-3 p-4 ${terminal ? 'opacity-60' : ''}`}>
        <div className='flex items-center justify-between gap-2'>
          <div className='flex items-center gap-2'>
            <span className='font-mono text-sm leading-[18px] tracking-[0.2px] text-muted-foreground'>
              Question
            </span>
            {terminal && (
              <span
                className={`rounded px-1 py-px text-xs font-semibold leading-[18px] tracking-[0.2px] ${phase === 'answered' ? 'bg-[var(--plan-chip-approved-bg)] text-[var(--plan-chip-approved-fg)]' : 'bg-destructive/10 text-destructive'}`}
              >
                {phase === 'answered' ? 'Answered' : 'Declined'}
              </span>
            )}
          </div>
          {props.questions.length > 1 && (
            <span className='shrink-0 font-mono text-xs tabular-nums text-muted-foreground'>
              {activeIndex + 1}/{props.questions.length}
            </span>
          )}
        </div>
        <div className='flex gap-2 overflow-x-auto border-b border-border'>
          {props.questions.map((question, index) => (
            <button
              key={question.id}
              type='button'
              data-track-category='USER_QUESTION_ARTIFACT'
              data-track-name='SELECT_QUESTION_TAB'
              onClick={() => setActiveIndex(index)}
              disabled={state.submitting}
              className={`shrink-0 rounded-t-xl px-3 py-2 text-sm font-medium transition-colors ${
                activeIndex === index
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
              }`}
            >
              {isQuestionComplete(question) && (
                <span
                  className='mr-1.5 inline-block size-1.5 rounded-full bg-emerald-500 align-middle'
                  aria-label='Answered or noted'
                />
              )}
              {props.questions.length === 1 ? props.title : (question.label ?? question.id)}
            </button>
          ))}
        </div>

        <div className='space-y-5'>
          <h3 className='text-lg font-semibold leading-[1.2] text-foreground'>
            {activeQuestion.question}
          </h3>

          {activeQuestion.type === 'open_ended' && (
            <div className='space-y-2'>
              <textarea
                value={typeof selectedAnswer === 'string' ? selectedAnswer : ''}
                data-track-category='USER_QUESTION_ARTIFACT'
                data-track-name='EDIT_OPEN_ENDED_ANSWER'
                onChange={event => updateAnswer(activeQuestion.id, event.target.value)}
                placeholder={activeQuestion.placeholder ?? 'Type your answer…'}
                disabled={state.submitting || terminal}
                rows={4}
                className='w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60'
              />
              {!terminal && (
                <button
                  type='button'
                  data-track-category='USER_QUESTION_ARTIFACT'
                  data-track-name='SKIP_QUESTION'
                  onClick={() => updateAnswer(activeQuestion.id, 'Skip this question')}
                  className='text-xs font-medium text-muted-foreground hover:text-foreground'
                >
                  Skip this question
                </button>
              )}
            </div>
          )}

          {activeQuestion.type === 'single_choice' && (
            <div className='space-y-3'>
              {activeQuestion.options.map(option => (
                <label
                  key={option}
                  className='flex cursor-pointer items-center gap-3 text-sm text-foreground'
                >
                  <input
                    type='radio'
                    data-track-category='USER_QUESTION_ARTIFACT'
                    data-track-name='SELECT_SINGLE_CHOICE'
                    name={activeQuestion.id}
                    checked={selectedAnswer === option}
                    disabled={state.submitting || terminal}
                    onChange={() => updateAnswer(activeQuestion.id, option)}
                    className='h-4 w-4 border-border text-primary focus:ring-ring'
                  />
                  {option}
                </label>
              ))}
            </div>
          )}

          {activeQuestion.type === 'multiple_choice' && (
            <div className='space-y-3'>
              {activeQuestion.options.map(option => {
                const selected = Array.isArray(selectedAnswer) && selectedAnswer.includes(option);
                return (
                  <label
                    key={option}
                    className='flex cursor-pointer items-center gap-3 text-sm text-foreground'
                  >
                    <input
                      type='checkbox'
                      data-track-category='USER_QUESTION_ARTIFACT'
                      data-track-name='TOGGLE_MULTIPLE_CHOICE'
                      checked={selected}
                      disabled={state.submitting || terminal}
                      onChange={event => toggleMultipleChoice(option, event.target.checked)}
                      className='h-4 w-4 rounded border-border text-primary focus:ring-ring'
                    />
                    {option}
                  </label>
                );
              })}
            </div>
          )}

          <div className='border-t border-dashed border-border pt-4'>
            <textarea
              value={notes[activeQuestion.id] ?? ''}
              data-track-category='USER_QUESTION_ARTIFACT'
              data-track-name='EDIT_QUESTION_NOTES'
              onChange={event =>
                updateFieldValue('notes', { ...notes, [activeQuestion.id]: event.target.value })
              }
              placeholder='+ Add notes (optional)'
              disabled={state.submitting || terminal}
              rows={2}
              className='w-full resize-y rounded-lg border border-dashed border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60'
            />
          </div>
        </div>
      </div>
      {phase === 'answered' && (
        <div className='border-t border-border bg-foreground/[0.03] px-4 py-3'>
          <p className='text-xs leading-[1.2] text-muted-foreground'>Answers submitted</p>
        </div>
      )}
      {phase === 'declined' && (
        <div className='border-t border-border bg-foreground/[0.03] px-4 py-3'>
          <p className='text-xs leading-[1.2] text-muted-foreground'>Question declined.</p>
        </div>
      )}
      {!terminal && (
        <footer className='flex items-center gap-2 border-t border-border bg-foreground/[0.03] px-4 py-3'>
          <button
            type='button'
            data-track-category='USER_QUESTION_ARTIFACT'
            data-track-name='SUBMIT_ANSWERS'
            onClick={submit}
            disabled={state.submitting}
            className='rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground shadow-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60'
          >
            Submit answers
          </button>
          {props.dismissAction && (
            <button
              type='button'
              data-track-category='USER_QUESTION_ARTIFACT'
              data-track-name='DISMISS_QUESTION'
              onClick={() => void executeAction(props.dismissAction!)}
              disabled={state.submitting}
              className='rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60'
            >
              Dismiss
            </button>
          )}
        </footer>
      )}
    </section>
  );
};
