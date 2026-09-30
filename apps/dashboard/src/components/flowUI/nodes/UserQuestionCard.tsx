import React, { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Check, PencilLine } from 'lucide-react';
import { cn } from '../../../utils/classNames';

import type { UserQuestionItem, UserQuestionOption } from '@xyne/shared';

export type UserQuestionAnswers = Record<string, string | string[]>;
export type UserQuestionPhase = 'pending' | 'answered' | 'declined';

export const SKIP_QUESTION_OPTION = 'Skip this question';

const optionLabel = (option: UserQuestionOption): string =>
  typeof option === 'string' ? option : option.label;
const optionDescription = (option: UserQuestionOption): string | undefined =>
  typeof option === 'string' ? undefined : option.description;

/** Whether a question has an answer or a typed note. */
export function isQuestionAnswered(
  question: UserQuestionItem,
  answers: UserQuestionAnswers,
  notes: Record<string, string>,
): boolean {
  const answer = answers[question.id];
  const answered = Array.isArray(answer)
    ? answer.length > 0
    : typeof answer === 'string' && answer.trim().length > 0;
  return answered || Boolean(notes[question.id]?.trim());
}

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

export interface UserQuestionCardProps {
  questions: UserQuestionItem[];
  phase: UserQuestionPhase;
  answers: UserQuestionAnswers;
  notes: Record<string, string>;
  onAnswersChange: (answers: UserQuestionAnswers) => void;
  onNotesChange: (notes: Record<string, string>) => void;
  /**
   * Called once the last answer is in. Return a question's index to send the
   * user back to it (an unanswered required one) instead of finishing.
   */
  onSubmit: () => number | null;
  disabled?: boolean;
  /** Each question's label as a row of chips (ticked when answered) instead of "Question 1/2". */
  showLabels?: boolean;
  /** Under an answered or dismissed card: who submitted it. */
  terminalFooter?: ReactNode;
  /**
   * Where Skip / Back / Submit sit. `top` puts them above the questions, for a
   * card docked at the bottom of a chat in place of its composer.
   */
  actionsPlacement?: 'top' | 'bottom';
  /** Extra classes for the card, e.g. `w-full` when it fills the composer's slot. */
  className?: string;
  /** `filled`: option rows have no stroke and no fill at rest; hover and the chosen row tint (the create chat). */
  optionStyle?: 'outlined' | 'filled';
  style?: CSSProperties | undefined;
}

/**
 * A set of questions, one shown at a time; Back/Next page through them and
 * answers live with the caller, so paging never loses input. An answered or
 * dismissed card shows each question with its answer.
 */
export function UserQuestionCard({
  questions,
  phase,
  answers,
  notes,
  onAnswersChange,
  onNotesChange,
  onSubmit,
  disabled = false,
  showLabels = false,
  terminalFooter,
  actionsPlacement = 'bottom',
  className,
  optionStyle = 'outlined',
  style,
}: UserQuestionCardProps): React.ReactElement | null {
  const [activeIndex, setActiveIndex] = useState(0);
  // Tracks prompts whose "Something else…" row is open but still empty; a row
  // with text is derived from `notes` instead so it survives paging.
  const [customOpen, setCustomOpen] = useState<Record<string, boolean>>({});
  // Skip-then-submit writes an answer and submits in one click. Deferring the
  // submit to an effect lets the answer write commit first, so onSubmit never
  // reads the pre-skip values.
  const [submitRequested, setSubmitRequested] = useState(false);
  const customInputRef = useRef<HTMLTextAreaElement | null>(null);
  const terminal = phase !== 'pending';

  useEffect(() => {
    if (!submitRequested) return;
    setSubmitRequested(false);
    const back = onSubmit();
    if (back !== null) setActiveIndex(Math.max(0, back));
  }, [submitRequested, onSubmit]);

  const activeQuestion = questions[activeIndex];
  if (!activeQuestion) return null;

  const total = questions.length;
  const isLast = activeIndex === total - 1;
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
    onAnswersChange({ ...answers, [questionId]: value });
  };

  const updateNote = (questionId: string, value: string): void => {
    onNotesChange({ ...notes, [questionId]: value });
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
        className={cn(
          'flex w-[428px] max-w-full flex-col rounded-2xl bg-foreground/[0.06]',
          className,
        )}
        style={style}
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
        {terminalFooter}
      </section>
    );
  }

  const actions = (
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
  );

  return (
    <section
      className={cn(
        'flex w-[428px] max-w-full flex-col rounded-2xl bg-foreground/[0.06]',
        className,
      )}
      style={style}
    >
      {actionsPlacement === 'top' && actions}
      <div className='flex items-start rounded-2xl border border-foreground/[0.06] bg-background p-3'>
        <div className='flex min-w-0 flex-1 flex-col gap-4'>
          {showLabels && total > 1 ? (
            <div className='flex min-h-6 flex-wrap items-center gap-1.5' role='tablist'>
              {questions.map((question, index) => {
                const done = isQuestionAnswered(question, answers, notes);
                return (
                  <button
                    key={question.id}
                    type='button'
                    role='tab'
                    aria-selected={index === activeIndex}
                    data-track-category='USER_QUESTION_ARTIFACT'
                    data-track-name='OPEN_QUESTION_TAB'
                    onClick={() => setActiveIndex(index)}
                    disabled={disabled}
                    className={cn(
                      'flex h-6 items-center gap-1 rounded-md px-1.5 text-xs font-semibold leading-5 transition-colors disabled:cursor-not-allowed',
                      index === activeIndex
                        ? 'bg-foreground/[0.08] text-foreground'
                        : 'text-foreground/60 hover:bg-foreground/[0.04]',
                    )}
                  >
                    {done && <Check className='size-3' strokeWidth={2.75} aria-hidden />}
                    {question.label ?? `Question ${index + 1}`}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className='flex h-6 items-center pl-1'>
              <div className='flex items-center gap-1 text-sm font-semibold leading-5 text-foreground/60'>
                <span className='tracking-[-0.5px]'>
                  {showLabels && activeQuestion.label ? activeQuestion.label : 'Question'}
                </span>
                {total > 1 && (
                  <span className='tabular-nums tracking-[-0.2px]'>
                    {activeIndex + 1}/{total}
                  </span>
                )}
              </div>
            </div>
          )}

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
                      'flex w-full items-start gap-1.5 rounded-lg p-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                      optionStyle === 'filled'
                        ? chosen
                          ? 'bg-foreground/[0.08]'
                          : 'hover:bg-foreground/[0.04]'
                        : chosen
                          ? 'border border-foreground/10 bg-foreground/[0.08]'
                          : 'border border-foreground/10 hover:border-foreground/[0.06] hover:bg-foreground/[0.04]',
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
                  <div
                    className={cn(
                      'flex w-full items-start gap-1.5 rounded-lg bg-foreground/[0.08] p-1.5',
                      optionStyle === 'outlined' && 'border border-foreground/10',
                    )}
                  >
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

      {actionsPlacement === 'bottom' && actions}
    </section>
  );
}
