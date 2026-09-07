import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, PencilLine } from 'lucide-react';
import { toast } from 'sonner';
import { useFlow } from '../FlowContext';
import Avatar from '../../ui/Avatar/Avatar';
import { useUser } from '../../../hooks/useUsers';
import { cn } from '../../../utils/classNames';

import type { FlowAction, FlowComponent, UserQuestionItem, UserQuestionOption } from '@xyne/shared';

interface UserQuestionNodeProps {
  node: FlowComponent;
  children?: React.ReactNode;
}

type Answers = Record<string, string | string[]>;
const SKIP_QUESTION_OPTION = 'Skip this question';

const optionLabel = (option: UserQuestionOption): string =>
  typeof option === 'string' ? option : option.label;
const optionDescription = (option: UserQuestionOption): string | undefined =>
  typeof option === 'string' ? undefined : option.description;

/** 14px square tick box — unchecked outline, or filled with the inverse check. */
const OptionCheck: React.FC<{ checked: boolean }> = ({ checked }) => (
  <span className='flex size-5 shrink-0 items-center justify-center'>
    <span
      className={cn(
        'flex size-3.5 items-center justify-center rounded',
        checked
          ? 'border-[0.875px] border-foreground/10 bg-foreground text-background'
          : 'border-[1.2px] border-foreground/40',
      )}
    >
      {checked && <Check className='size-3' strokeWidth={2.75} />}
    </span>
  </span>
);

/**
 * The thread counterpart to PlanNode: one self-contained FlowJSON artifact
 * instead of a trail of button messages. One prompt is shown at a time and
 * Back/Next page through the set; answers live in FlowRenderer state, so
 * paging never loses input.
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
  const { state, data, updateFieldValue, executeAction } = useFlow();
  const [activeIndex, setActiveIndex] = useState(0);
  // Tracks prompts whose "Something else…" row is open but still empty; a row
  // with text is derived from `notes` instead so it survives paging.
  const [customOpen, setCustomOpen] = useState<Record<string, boolean>>({});
  // Skip-then-submit writes an answer and submits in one click. Deferring the
  // submit to an effect lets the field write commit first, so executeAction
  // never reads the pre-skip values.
  const [submitRequested, setSubmitRequested] = useState(false);
  const customInputRef = useRef<HTMLTextAreaElement | null>(null);

  // Question-set cards posted before terminal phases were introduced do not
  // have `phase`. Treat them as pending so opening an older thread never tries
  // to read a non-existent persisted `answers` object.
  const phase = props?.phase ?? 'pending';
  const terminal = phase !== 'pending';
  const answers = useMemo(
    () => (terminal ? (props?.answers ?? {}) : (state.values['answers'] ?? {})) as Answers,
    [terminal, props?.answers, state.values],
  );
  const notes = useMemo(
    () =>
      (terminal ? (props?.notes ?? {}) : (state.values['notes'] ?? {})) as Record<string, string>,
    [terminal, props?.notes, state.values],
  );
  const questions = useMemo(() => props?.questions ?? [], [props?.questions]);
  const activeQuestion = questions[activeIndex];
  const submitterId = typeof data['userId'] === 'string' ? data['userId'] : '';
  const submitter = useUser(submitterId);

  const isQuestionComplete = useCallback(
    (question: UserQuestionItem) => {
      const answer = answers[question.id];
      const answered = Array.isArray(answer)
        ? answer.length > 0
        : typeof answer === 'string' && answer.trim().length > 0;
      return answered || Boolean(notes[question.id]?.trim());
    },
    [answers, notes],
  );

  useEffect(() => {
    if (!submitRequested) return;
    setSubmitRequested(false);
    const unanswered = questions.find(
      question => question.required !== false && !isQuestionComplete(question),
    );
    if (unanswered) {
      setActiveIndex(
        Math.max(
          0,
          questions.findIndex(question => question.id === unanswered.id),
        ),
      );
      toast.error('Please answer each required question before submitting.');
      return;
    }
    if (props?.submitAction) void executeAction(props.submitAction);
  }, [submitRequested, questions, isQuestionComplete, props?.submitAction, executeAction]);

  if (!props || !activeQuestion) return null;

  const total = questions.length;
  const isLast = activeIndex === total - 1;
  const disabled = state.submitting;
  const selectedAnswer = answers[activeQuestion.id];
  const customValue = notes[activeQuestion.id] ?? '';
  const customActive = Boolean(customOpen[activeQuestion.id]) || customValue.length > 0;
  // The tool appends a stock skip option; the footer's Skip button is its home
  // in this layout, so it never renders as a row.
  const choices =
    activeQuestion.type === 'open_ended'
      ? []
      : activeQuestion.options.filter(option => optionLabel(option) !== SKIP_QUESTION_OPTION);

  const updateAnswer = (questionId: string, value: string | string[]): void => {
    updateFieldValue('answers', { ...answers, [questionId]: value });
  };

  const updateNote = (questionId: string, value: string): void => {
    updateFieldValue('notes', { ...notes, [questionId]: value });
  };

  const chooseOption = (option: string): void => {
    if (activeQuestion.type === 'multiple_choice') {
      const selected = Array.isArray(selectedAnswer) ? selectedAnswer : [];
      updateAnswer(
        activeQuestion.id,
        selected.includes(option)
          ? selected.filter(value => value !== option)
          : [...selected, option],
      );
      return;
    }
    updateAnswer(activeQuestion.id, selectedAnswer === option ? '' : option);
  };

  const isChosen = (option: string): boolean =>
    Array.isArray(selectedAnswer) ? selectedAnswer.includes(option) : selectedAnswer === option;

  const skip = (): void => {
    updateAnswer(
      activeQuestion.id,
      activeQuestion.type === 'multiple_choice' ? [SKIP_QUESTION_OPTION] : SKIP_QUESTION_OPTION,
    );
    if (isLast) setSubmitRequested(true);
    else setActiveIndex(activeIndex + 1);
  };

  const advance = (): void => {
    if (isLast) setSubmitRequested(true);
    else setActiveIndex(activeIndex + 1);
  };

  const answerSummary = (question: UserQuestionItem): string => {
    const answer = answers[question.id];
    const parts = Array.isArray(answer)
      ? answer.filter(Boolean)
      : typeof answer === 'string' && answer.trim()
        ? [answer.trim()]
        : [];
    const note = notes[question.id]?.trim();
    if (note) parts.push(note);
    return parts.length ? parts.join(', ') : '—';
  };

  if (terminal) {
    return (
      <section
        className='flex w-[428px] max-w-full flex-col rounded-2xl bg-foreground/[0.06]'
        style={node.style}
      >
        <div className='flex flex-col gap-4 rounded-2xl border border-foreground/[0.06] bg-background px-4 py-3'>
          {questions.map((question, index) => (
            <React.Fragment key={question.id}>
              {index > 0 && <div className='h-px w-full shrink-0 bg-foreground/10' />}
              <div className='flex flex-col gap-2'>
                <p className='text-sm font-medium leading-5 tracking-[-0.07px] text-foreground/80'>
                  {question.question}
                </p>
                <p className='text-sm font-semibold leading-5 text-foreground'>
                  {phase === 'answered' ? answerSummary(question) : 'Dismissed'}
                </p>
              </div>
            </React.Fragment>
          ))}
        </div>
        <div className='flex items-center gap-1.5 px-4 py-2'>
          <span className='text-xs font-semibold leading-5 text-foreground/60'>
            {phase === 'answered' ? 'Submitted by' : 'Dismissed by'}
          </span>
          <div className='flex items-center gap-1.5'>
            {submitterId && (
              <Avatar userId={submitterId} size='xs' showActiveStatus={false} className='rounded' />
            )}
            <span className='text-xs font-semibold leading-5 text-foreground'>
              {submitter?.name ?? 'You'}
            </span>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      className='flex w-[428px] max-w-full flex-col rounded-2xl bg-foreground/[0.06]'
      style={node.style}
    >
      <div className='flex items-start rounded-2xl border border-foreground/[0.06] bg-background p-3'>
        <div className='flex min-w-0 flex-1 flex-col gap-4'>
          <div className='flex h-6 items-center pl-1'>
            <div className='flex items-center gap-1 text-sm font-semibold leading-5 text-foreground/60'>
              <span className='tracking-[-0.5px]'>Question</span>
              {total > 1 && (
                <span className='tabular-nums tracking-[-0.2px]'>
                  {activeIndex + 1}/{total}
                </span>
              )}
            </div>
          </div>

          <div className='flex flex-col gap-4'>
            <p className='pl-1 text-sm font-medium leading-5 tracking-[-0.07px] text-foreground'>
              {activeQuestion.question}
            </p>

            <div className='flex flex-col gap-2'>
              {activeQuestion.type === 'open_ended' && (
                <textarea
                  value={typeof selectedAnswer === 'string' ? selectedAnswer : ''}
                  data-track-category='USER_QUESTION_ARTIFACT'
                  data-track-name='EDIT_OPEN_ENDED_ANSWER'
                  onChange={event => updateAnswer(activeQuestion.id, event.target.value)}
                  placeholder={activeQuestion.placeholder ?? 'Type your answer…'}
                  disabled={disabled}
                  rows={3}
                  className='w-full resize-y rounded-lg border border-foreground/10 bg-transparent px-1.5 py-1.5 text-sm font-medium leading-5 text-foreground outline-none placeholder:text-foreground/40 focus:border-foreground/20 disabled:cursor-not-allowed disabled:opacity-60'
                />
              )}

              {choices.map(option => {
                const label = optionLabel(option);
                const description = optionDescription(option);
                const chosen = isChosen(label);
                return (
                  <button
                    key={label}
                    type='button'
                    data-track-category='USER_QUESTION_ARTIFACT'
                    data-track-name='SELECT_QUESTION_OPTION'
                    onClick={() => chooseOption(label)}
                    disabled={disabled}
                    className={cn(
                      'flex w-full items-start gap-1.5 rounded-lg border p-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                      chosen
                        ? 'border-foreground/10 bg-foreground/[0.08]'
                        : 'border-foreground/10 hover:border-foreground/[0.06] hover:bg-foreground/[0.04]',
                    )}
                  >
                    <OptionCheck checked={chosen} />
                    <span className='flex min-w-0 flex-1 flex-col gap-1'>
                      <span className='text-sm font-semibold leading-5 text-foreground'>
                        {label}
                      </span>
                      {description && (
                        <span className='text-xs font-normal leading-5 text-foreground/60'>
                          {description}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}

              {activeQuestion.type !== 'open_ended' &&
                (customActive ? (
                  <div className='flex w-full items-start gap-1.5 rounded-lg border border-foreground/10 bg-foreground/[0.08] p-1.5'>
                    <OptionCheck checked />
                    <textarea
                      ref={customInputRef}
                      value={customValue}
                      data-track-category='USER_QUESTION_ARTIFACT'
                      data-track-name='EDIT_CUSTOM_ANSWER'
                      onChange={event => {
                        event.target.style.height = 'auto';
                        event.target.style.height = `${event.target.scrollHeight}px`;
                        updateNote(activeQuestion.id, event.target.value);
                      }}
                      onBlur={() => {
                        if (!customValue.trim()) {
                          setCustomOpen({ ...customOpen, [activeQuestion.id]: false });
                        }
                      }}
                      placeholder='Type your own answer…'
                      disabled={disabled}
                      rows={1}
                      className='min-w-0 flex-1 resize-none self-center bg-transparent text-sm font-semibold leading-5 text-foreground outline-none placeholder:font-semibold placeholder:text-foreground/60 disabled:cursor-not-allowed'
                    />
                  </div>
                ) : (
                  <button
                    type='button'
                    data-track-category='USER_QUESTION_ARTIFACT'
                    data-track-name='OPEN_CUSTOM_ANSWER'
                    onClick={() => {
                      setCustomOpen({ ...customOpen, [activeQuestion.id]: true });
                      window.requestAnimationFrame(() => customInputRef.current?.focus());
                    }}
                    disabled={disabled}
                    className='flex w-full items-start gap-1.5 rounded-lg border border-dashed border-foreground/10 px-1.5 py-2 text-left transition-colors hover:bg-foreground/[0.04] disabled:cursor-not-allowed disabled:opacity-60'
                  >
                    <span className='flex size-5 shrink-0 items-center justify-center'>
                      <PencilLine className='size-3.5 text-foreground/60' strokeWidth={2} />
                    </span>
                    <span className='text-sm font-semibold leading-5 text-foreground/60'>
                      Something else...
                    </span>
                  </button>
                ))}
            </div>
          </div>
        </div>
      </div>

      <footer className='flex items-center justify-between px-3 py-2'>
        <button
          type='button'
          data-track-category='USER_QUESTION_ARTIFACT'
          data-track-name='SKIP_QUESTION'
          onClick={skip}
          disabled={disabled}
          className='flex h-7 items-center rounded-[10px] px-1.5 text-sm font-semibold leading-5 text-foreground transition-colors hover:bg-foreground/[0.06] disabled:cursor-not-allowed disabled:opacity-60'
        >
          <span className='px-1'>Skip</span>
        </button>
        <div className='flex items-center gap-2'>
          {activeIndex > 0 && (
            <button
              type='button'
              data-track-category='USER_QUESTION_ARTIFACT'
              data-track-name='PREVIOUS_QUESTION'
              onClick={() => setActiveIndex(activeIndex - 1)}
              disabled={disabled}
              className='flex h-7 items-center rounded-[10px] px-1.5 text-sm font-semibold leading-5 text-foreground transition-colors hover:bg-foreground/[0.06] disabled:cursor-not-allowed disabled:opacity-60'
            >
              <span className='px-1'>Back</span>
            </button>
          )}
          <button
            type='button'
            data-track-category='USER_QUESTION_ARTIFACT'
            data-track-name={isLast ? 'SUBMIT_ANSWERS' : 'NEXT_QUESTION'}
            onClick={advance}
            disabled={disabled}
            className='flex h-7 items-center rounded-lg border border-foreground/10 bg-background px-1.5 text-sm font-semibold leading-5 text-foreground transition-colors hover:bg-foreground/[0.04] disabled:cursor-not-allowed disabled:opacity-60'
            data-ph-capture-attribute-track-id='user_question_submit'
          >
            <span className='px-1'>{isLast ? 'Submit' : 'Next'}</span>
          </button>
        </div>
      </footer>
    </section>
  );
};
