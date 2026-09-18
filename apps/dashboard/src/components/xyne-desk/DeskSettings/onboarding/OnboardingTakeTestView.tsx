import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { clearFinishedLocalReplies } from '../../../../hooks/useDeskOnboarding';
import {
  onboardingErrorMessage,
  startOnboardingAttempt,
  type OnboardingAttempt,
  type OnboardingState,
} from '../../../../services/clients/onboardingApi';
import Tooltip from '../../../ui/Tooltip';
import { OnboardingExamScreen } from './OnboardingExamScreen';
import {
  AttemptStatusPill,
  EmptyState,
  formatDuration,
  formatScore,
  primaryButtonClass,
  secondaryButtonClass,
} from './onboardingUi';

interface OnboardingTakeTestViewProps {
  channelId: string;
  userId: string;
  state: OnboardingState;
  onChanged: () => Promise<void>;
}

const latestFirst = (a: OnboardingAttempt, b: OnboardingAttempt): number =>
  (b.submittedAt ?? b.startedAt).localeCompare(a.submittedAt ?? a.startedAt);

export const OnboardingTakeTestView: React.FC<OnboardingTakeTestViewProps> = ({
  channelId,
  userId,
  state,
  onChanged,
}) => {
  const [openAttemptId, setOpenAttemptId] = useState<string | null>(null);
  const [startingTopicId, setStartingTopicId] = useState<string | null>(null);
  const [startedAttempt, setStartedAttempt] = useState<OnboardingAttempt | null>(null);

  const myAttempts = useMemo(
    () => state.attempts.filter(a => a.userId === userId).sort(latestFirst),
    [state.attempts, userId],
  );

  // Replies kept on this browser for attempts finished elsewhere (e.g. another device) are dead weight.
  useEffect(() => {
    clearFinishedLocalReplies(myAttempts);
  }, [myAttempts]);

  // `startedAttempt` covers the gap between Start returning and the state query catching up.
  const openAttempt =
    (openAttemptId ? myAttempts.find(a => a.id === openAttemptId) : undefined) ??
    (startedAttempt?.id === openAttemptId ? startedAttempt : undefined);
  const topicName = (topicId: string): string =>
    state.topics.find(t => t.id === topicId)?.name ??
    state.deletedTopics.find(t => t.id === topicId)?.name ??
    'Retired exam';

  if (openAttempt?.status === 'IN_PROGRESS') {
    return (
      <OnboardingExamScreen
        key={openAttempt.id}
        channelId={channelId}
        attempt={openAttempt}
        topicName={topicName(openAttempt.topicId)}
        onClose={() => setOpenAttemptId(null)}
        onChanged={onChanged}
      />
    );
  }

  const start = async (topicId: string): Promise<void> => {
    setStartingTopicId(topicId);
    try {
      const attempt = await startOnboardingAttempt(channelId, topicId);
      // Open the exam from the response, so a slow or failed refetch can't strand the trainee.
      setStartedAttempt(attempt);
      setOpenAttemptId(attempt.id);
      await onChanged();
    } catch (err) {
      toast.error(onboardingErrorMessage(err, "Couldn't start the exam"));
    } finally {
      setStartingTopicId(null);
    }
  };

  // Open attempts on topics deleted since they were started can still be finished.
  const orphanedOpen = myAttempts.filter(
    a =>
      (a.status === 'IN_PROGRESS' || a.status === 'GRADING') &&
      !state.topics.some(t => t.id === a.topicId),
  );

  if (state.topics.length === 0 && orphanedOpen.length === 0) {
    return state.isAdmin ? (
      <EmptyState title='Add a topic'>Create a topic under Topics, then take it here.</EmptyState>
    ) : (
      <EmptyState title='No exams yet'>
        A desk admin hasn’t set up any onboarding topics.
      </EmptyState>
    );
  }

  const rows = [
    ...state.topics.map(t => ({ topicId: t.id, name: t.name, ticketCount: t.ticketCount })),
    ...[...new Map(orphanedOpen.map(a => [a.topicId, a])).values()].map(a => ({
      topicId: a.topicId,
      name: topicName(a.topicId),
      ticketCount: a.answers.length,
    })),
  ];

  return (
    <div className='flex flex-col divide-y divide-desk-border rounded-[12px] border border-desk-border dark:divide-border dark:border-border'>
      {rows.map(row => {
        const attempts = myAttempts.filter(a => a.topicId === row.topicId);
        const open = attempts.find(a => a.status === 'IN_PROGRESS');
        const grading = attempts.find(a => a.status === 'GRADING');
        const lastFinished = attempts.find(a => a.status === 'GRADED' || a.status === 'FAILED');
        const failed = !grading && lastFinished?.status === 'FAILED';
        const topicIsLive = state.topics.some(t => t.id === row.topicId);
        const attemptCount = state.counts[`${row.topicId}:${userId}`] ?? 0;

        return (
          <div key={row.topicId} className='flex flex-wrap items-center gap-3 px-4 py-3'>
            <div className='flex min-w-0 flex-1 flex-col gap-[2px]'>
              <span className='truncate text-sm font-medium text-foreground'>{row.name}</span>
              <span className='text-desk-helper'>
                {row.ticketCount} {row.ticketCount === 1 ? 'ticket' : 'tickets'}
                {attemptCount > 0 &&
                  ` · ${attemptCount} ${attemptCount === 1 ? 'attempt' : 'attempts'}`}
                {lastFinished?.status === 'GRADED' &&
                  ` · last score ${formatScore(lastFinished)} in ${formatDuration(lastFinished.durationSeconds)}`}
              </span>
              {/* Only the grading line is a live region: the poll must not re-announce the list. */}
              <span className='text-desk-helper' role='status' aria-live='polite'>
                {grading
                  ? 'Being graded now — your score appears here in a minute or two.'
                  : failed
                    ? 'We couldn’t grade your last attempt. Retake it, or ask a desk admin to check the grading agent.'
                    : ''}
              </span>
            </div>

            {grading && <AttemptStatusPill status='GRADING' />}
            {failed && <AttemptStatusPill status='FAILED' />}

            {open ? (
              <button
                type='button'
                className={primaryButtonClass}
                onClick={() => setOpenAttemptId(open.id)}
                data-track-category='DeskSettings'
                data-track-name='OnboardingResumeExam'
              >
                Resume
              </button>
            ) : (
              topicIsLive &&
              !grading &&
              (row.ticketCount === 0 ? (
                <Tooltip content='A desk admin hasn’t added any tickets to this topic yet.'>
                  <span className='inline-flex'>
                    <button type='button' className={secondaryButtonClass} disabled>
                      Start
                    </button>
                  </span>
                </Tooltip>
              ) : (
                <button
                  type='button'
                  className={lastFinished ? secondaryButtonClass : primaryButtonClass}
                  onClick={() => void start(row.topicId)}
                  disabled={startingTopicId === row.topicId}
                  data-track-category='DeskSettings'
                  data-track-name={lastFinished ? 'OnboardingRetakeExam' : 'OnboardingStartExam'}
                >
                  {startingTopicId === row.topicId
                    ? 'Starting…'
                    : lastFinished
                      ? 'Retake'
                      : 'Start'}
                </button>
              ))
            )}
          </div>
        );
      })}
    </div>
  );
};
