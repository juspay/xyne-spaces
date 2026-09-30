import React, { useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { useFlow } from '../FlowContext';
import Avatar from '../../ui/Avatar/Avatar';
import { useUser } from '../../../hooks/useUsers';
import { UserQuestionCard, isQuestionAnswered, type UserQuestionAnswers } from './UserQuestionCard';

import type { FlowAction, FlowComponent, UserQuestionItem } from '@xyne/shared';

interface UserQuestionNodeProps {
  node: FlowComponent;
  children?: React.ReactNode;
}

/**
 * The thread counterpart to PlanNode: one self-contained FlowJSON artifact
 * instead of a trail of button messages. Answers live in FlowRenderer state;
 * UserQuestionCard renders the questions.
 */
export const UserQuestionNode: React.FC<UserQuestionNodeProps> = ({ node }) => {
  const props = node.props as
    | {
        title: string;
        questions: UserQuestionItem[];
        phase?: 'pending' | 'answered' | 'declined';
        answers?: UserQuestionAnswers;
        notes?: Record<string, string>;
        submitAction?: FlowAction;
        dismissAction?: FlowAction;
      }
    | undefined;
  const { state, data, updateFieldValue, executeAction } = useFlow();

  // Question-set cards posted before terminal phases were introduced do not
  // have `phase`. Treat them as pending so opening an older thread never tries
  // to read a non-existent persisted `answers` object.
  const phase = props?.phase ?? 'pending';
  const terminal = phase !== 'pending';
  const answers = useMemo(
    () =>
      (terminal ? (props?.answers ?? {}) : (state.values['answers'] ?? {})) as UserQuestionAnswers,
    [terminal, props?.answers, state.values],
  );
  const notes = useMemo(
    () =>
      (terminal ? (props?.notes ?? {}) : (state.values['notes'] ?? {})) as Record<string, string>,
    [terminal, props?.notes, state.values],
  );
  const questions = useMemo(() => props?.questions ?? [], [props?.questions]);
  const submitterId = typeof data['userId'] === 'string' ? data['userId'] : '';
  const submitter = useUser(submitterId);
  const submitAction = props?.submitAction;

  const submit = useCallback((): number | null => {
    const unanswered = questions.findIndex(
      question => question.required !== false && !isQuestionAnswered(question, answers, notes),
    );
    if (unanswered >= 0) {
      toast.error('Please answer each required question before submitting.');
      return unanswered;
    }
    if (submitAction) void executeAction(submitAction);
    return null;
  }, [questions, answers, notes, submitAction, executeAction]);

  if (!props || questions.length === 0) return null;

  return (
    <UserQuestionCard
      questions={questions}
      phase={phase}
      answers={answers}
      notes={notes}
      onAnswersChange={next => updateFieldValue('answers', next)}
      onNotesChange={next => updateFieldValue('notes', next)}
      onSubmit={submit}
      disabled={state.submitting}
      style={node.style}
      terminalFooter={
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
      }
    />
  );
};
