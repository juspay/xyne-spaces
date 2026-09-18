import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import DelayedSpinner from '../../../ui/DelayedSpinner';
import { TruncatedTooltip } from '../../../ui/Tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../ui/Select/Select';
import { GRADING_POLL_MS } from '../../../../hooks/useDeskOnboarding';
import {
  ONBOARDING_MAX_SCORE_PER_ANSWER,
  fetchOnboardingAttemptReview,
  type OnboardingAttempt,
  type OnboardingState,
} from '../../../../services/clients/onboardingApi';
import {
  AttachmentList,
  AttemptStatusPill,
  EmptyState,
  formatDuration,
  formatScore,
  inputClass,
  scoreRatio,
  secondaryButtonClass,
} from './onboardingUi';

interface OnboardingResultsViewProps {
  channelId: string;
  state: OnboardingState;
}

interface PersonRow {
  userId: string;
  name: string;
  latest: OnboardingAttempt | undefined;
  best: OnboardingAttempt | undefined;
  inFlight: OnboardingAttempt | undefined;
  attemptCount: number;
}

const bySubmittedDesc = (a: OnboardingAttempt, b: OnboardingAttempt): number =>
  (b.submittedAt ?? '').localeCompare(a.submittedAt ?? '');

export const OnboardingResultsView: React.FC<OnboardingResultsViewProps> = ({
  channelId,
  state,
}) => {
  const topicOptions = useMemo(
    () => [
      ...state.topics.map(t => ({ id: t.id, name: t.name })),
      ...state.deletedTopics
        .filter(t => state.attempts.some(a => a.topicId === t.id))
        .map(t => ({ id: t.id, name: `${t.name} (deleted)` })),
    ],
    [state],
  );
  const [topicId, setTopicId] = useState<string | null>(topicOptions[0]?.id ?? null);
  const [openAttemptId, setOpenAttemptId] = useState<string | null>(null);
  const selectedTopicId = topicOptions.some(t => t.id === topicId)
    ? topicId
    : (topicOptions[0]?.id ?? null);

  const usersById = useMemo(() => new Map(state.users.map(u => [u.id, u])), [state.users]);
  const ticketsById = useMemo(() => new Map(state.tickets.map(t => [t.id, t])), [state.tickets]);
  const topicAttempts = useMemo(
    () => state.attempts.filter(a => a.topicId === selectedTopicId),
    [state.attempts, selectedTopicId],
  );

  const people = useMemo<PersonRow[]>(() => {
    const userIds = [...new Set(topicAttempts.map(a => a.userId))];
    return userIds
      .map(userId => {
        const mine = topicAttempts.filter(a => a.userId === userId);
        const finished = mine
          .filter(a => a.status === 'GRADED' || a.status === 'FAILED')
          .sort(bySubmittedDesc);
        const graded = finished.filter(a => a.status === 'GRADED');
        const user = usersById.get(userId);
        return {
          userId,
          name: user?.name || user?.email || 'Unknown user',
          latest: finished[0],
          best: graded.sort((a, b) => scoreRatio(b) - scoreRatio(a))[0],
          inFlight: mine.find(a => a.status === 'IN_PROGRESS' || a.status === 'GRADING'),
          attemptCount: state.counts[`${selectedTopicId}:${userId}`] ?? 0,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [topicAttempts, usersById, state.counts, selectedTopicId]);

  const weakAreas = useMemo(() => {
    const byTicket = new Map<string, { scores: number[]; missed: Map<string, Set<string>> }>();
    for (const attempt of topicAttempts) {
      if (attempt.status !== 'GRADED') continue;
      for (const answer of attempt.answers) {
        if (!answer.ticketId || typeof answer.score !== 'number') continue;
        const entry = byTicket.get(answer.ticketId) ?? {
          scores: [],
          missed: new Map<string, Set<string>>(),
        };
        entry.scores.push(answer.score);
        for (const point of answer.review?.missedPoints ?? []) {
          const key = point.trim().toLowerCase();
          if (!key) continue;
          const missedBy = entry.missed.get(key) ?? new Set<string>();
          missedBy.add(attempt.userId);
          entry.missed.set(key, missedBy);
        }
        byTicket.set(answer.ticketId, entry);
      }
    }
    return [...byTicket.entries()]
      .map(([ticketId, entry]) => ({
        ticketId,
        average: entry.scores.reduce((s, v) => s + v, 0) / entry.scores.length,
        answers: entry.scores.length,
        repeatedMisses: [...entry.missed.entries()]
          .filter(([, users]) => users.size > 1)
          .sort((a, b) => b[1].size - a[1].size)
          .slice(0, 5)
          .map(([point, users]) => ({ point, people: users.size })),
      }))
      .sort((a, b) => a.average - b.average);
  }, [topicAttempts]);

  if (openAttemptId) {
    return (
      <AttemptDetail
        channelId={channelId}
        attemptId={openAttemptId}
        personName={
          usersById.get(state.attempts.find(a => a.id === openAttemptId)?.userId ?? '')?.name
        }
        onBack={() => setOpenAttemptId(null)}
      />
    );
  }

  if (topicOptions.length === 0) {
    return (
      <EmptyState title='No results yet'>
        Results appear here once someone submits an exam.
      </EmptyState>
    );
  }

  return (
    <div className='flex flex-col gap-[24px]'>
      <div className='max-w-[320px]'>
        {/* `value` is omitted rather than undefined: exactOptionalPropertyTypes forbids the latter. */}
        <Select {...(selectedTopicId ? { value: selectedTopicId } : {})} onValueChange={setTopicId}>
          <SelectTrigger
            id='desk-onboarding-results-topic'
            data-track-category='DeskSettings'
            data-track-name='OnboardingResultsTopic'
            className={inputClass}
          >
            <SelectValue placeholder='Pick a topic' />
          </SelectTrigger>
          <SelectContent className='rounded-[10px]'>
            {topicOptions.map(t => (
              <SelectItem key={t.id} value={t.id} className='rounded-[8px]'>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <section className='flex flex-col gap-[8px]'>
        <div className='text-sm font-medium text-foreground'>People</div>
        {people.length === 0 ? (
          <div className='text-desk-helper'>Nobody has taken this topic yet.</div>
        ) : (
          <div className='overflow-x-auto rounded-[12px] border border-desk-border dark:border-border'>
            <table className='w-full min-w-[720px] text-sm'>
              <thead>
                <tr className='border-b border-desk-border text-left text-xs uppercase tracking-wide text-muted-foreground dark:border-border'>
                  <th className='px-4 py-2 font-medium'>Person</th>
                  <th className='px-4 py-2 font-medium'>Latest</th>
                  <th className='px-4 py-2 font-medium'>Best</th>
                  <th className='px-4 py-2 font-medium'>Time taken</th>
                  <th className='px-4 py-2 font-medium'>Attempts</th>
                  <th className='px-4 py-2' />
                </tr>
              </thead>
              <tbody>
                {people.map(person => (
                  <tr
                    key={person.userId}
                    className='border-b border-desk-border last:border-b-0 dark:border-border'
                  >
                    <td className='px-4 py-2 text-foreground'>{person.name}</td>
                    <td className='px-4 py-2 tabular-nums text-foreground'>
                      {person.latest?.status === 'FAILED' ? (
                        <AttemptStatusPill status='FAILED' />
                      ) : (
                        formatScore(person.latest)
                      )}
                    </td>
                    <td className='px-4 py-2 tabular-nums text-foreground'>
                      {formatScore(person.best)}
                    </td>
                    <td className='px-4 py-2 tabular-nums text-foreground'>
                      {formatDuration(person.latest?.durationSeconds)}
                    </td>
                    <td className='px-4 py-2 tabular-nums text-foreground'>
                      <span className='inline-flex items-center gap-2'>
                        {person.attemptCount}
                        {person.inFlight && <AttemptStatusPill status={person.inFlight.status} />}
                      </span>
                    </td>
                    <td className='px-4 py-2 text-right'>
                      <span className='inline-flex gap-2'>
                        {person.latest && (
                          <button
                            type='button'
                            className={secondaryButtonClass}
                            onClick={() => person.latest && setOpenAttemptId(person.latest.id)}
                            data-track-category='DeskSettings'
                            data-track-name='OnboardingViewLatestAttempt'
                          >
                            Latest
                          </button>
                        )}
                        {person.best && person.best.id !== person.latest?.id && (
                          <button
                            type='button'
                            className={secondaryButtonClass}
                            onClick={() => person.best && setOpenAttemptId(person.best.id)}
                            data-track-category='DeskSettings'
                            data-track-name='OnboardingViewBestAttempt'
                          >
                            Best
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className='flex flex-col gap-[8px]'>
        <div className='text-sm font-medium text-foreground'>Weak areas</div>
        <div className='text-desk-helper'>
          Lowest-scoring tickets first, from the graded attempts kept for each person.
        </div>
        {weakAreas.length === 0 ? (
          <div className='text-desk-helper'>No graded answers yet.</div>
        ) : (
          <div className='flex flex-col divide-y divide-desk-border rounded-[12px] border border-desk-border dark:divide-border dark:border-border'>
            {weakAreas.map(area => {
              const ticket = ticketsById.get(area.ticketId);
              return (
                <div key={area.ticketId} className='flex flex-col gap-[6px] px-4 py-3'>
                  <div className='flex items-center gap-2'>
                    <span className='shrink-0 text-xs font-medium text-muted-foreground'>
                      {ticket?.xyneId}
                    </span>
                    <TruncatedTooltip content={ticket?.title ?? 'Ticket unavailable'}>
                      <span className='flex-1 truncate text-sm text-foreground'>
                        {ticket?.title ?? 'Ticket unavailable'}
                      </span>
                    </TruncatedTooltip>
                    <span className='shrink-0 text-sm tabular-nums text-foreground'>
                      {area.average.toFixed(1)}/{ONBOARDING_MAX_SCORE_PER_ANSWER}
                    </span>
                    <span className='shrink-0 text-xs text-muted-foreground'>
                      {area.answers} {area.answers === 1 ? 'answer' : 'answers'}
                    </span>
                  </div>
                  {area.repeatedMisses.length > 0 && (
                    <ul className='flex flex-col gap-[2px] pl-4 text-sm text-desk-muted'>
                      {area.repeatedMisses.map(miss => (
                        <li key={miss.point} className='list-disc'>
                          {miss.point}{' '}
                          <span className='text-xs text-muted-foreground'>
                            · {miss.people} people
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};

/** Long email text scrolls in place, so one huge email can't stretch the attempt. */
const EmailText: React.FC<{ text: string }> = ({ text }) => (
  <div className='max-h-[320px] overflow-y-auto whitespace-pre-wrap break-words text-sm text-foreground'>
    {text}
  </div>
);

const Collapsible: React.FC<{ summary: string; children: React.ReactNode }> = ({
  summary,
  children,
}) => (
  <details className='rounded-[10px] bg-accent/40 px-3 py-2'>
    <summary className='cursor-pointer text-sm font-medium text-foreground'>{summary}</summary>
    <div className='mt-2 flex flex-col gap-3'>{children}</div>
  </details>
);

interface AttemptDetailProps {
  channelId: string;
  attemptId: string;
  personName: string | undefined;
  onBack: () => void;
}

const AttemptDetail: React.FC<AttemptDetailProps> = ({
  channelId,
  attemptId,
  personName,
  onBack,
}) => {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  const {
    data: attempt,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['desk-onboarding-attempt-review', channelId, attemptId],
    queryFn: () => fetchOnboardingAttemptReview(channelId, attemptId),
    // Grades land one answer at a time; keep the open review fresh until grading finishes.
    refetchInterval: query => (query.state.data?.status === 'GRADING' ? GRADING_POLL_MS : false),
  });

  return (
    <div className='flex flex-col gap-[16px]'>
      <div className='flex flex-wrap items-center gap-3'>
        <button
          type='button'
          onClick={onBack}
          className={secondaryButtonClass}
          data-track-category='DeskSettings'
          data-track-name='OnboardingBackToResults'
        >
          <ArrowLeft size={14} />
          Back
        </button>
        {/* This view replaces the table, so focus moves here rather than being lost. */}
        <h3
          ref={headingRef}
          tabIndex={-1}
          className='flex-1 text-base font-semibold text-foreground focus:outline-none'
        >
          {personName ?? 'Attempt'}
        </h3>
        {attempt && (
          <>
            <AttemptStatusPill status={attempt.status} />
            <span className='text-sm tabular-nums text-foreground'>{formatScore(attempt)}</span>
            <span className='text-desk-helper'>{formatDuration(attempt.durationSeconds)}</span>
          </>
        )}
      </div>

      {isLoading ? (
        <DelayedSpinner label='Loading the attempt' />
      ) : isError || !attempt ? (
        <div className='text-desk-helper'>Couldn’t load this attempt.</div>
      ) : (
        attempt.answers.map((answer, i) => (
          <div
            key={answer.paperTicketId}
            className='flex flex-col gap-[12px] rounded-[12px] border border-desk-border p-4 dark:border-border'
          >
            <div className='flex items-center gap-2'>
              <span className='text-sm font-semibold text-foreground'>Ticket {i + 1}</span>
              <span className='flex-1 truncate text-desk-helper'>
                {answer.content?.firstEmail.subject ?? 'Ticket unavailable'}
              </span>
              <span className='shrink-0 text-sm tabular-nums text-foreground'>
                {typeof answer.score === 'number' ? (
                  `${answer.score}/${ONBOARDING_MAX_SCORE_PER_ANSWER}`
                ) : answer.review?.status === 'PENDING' ? (
                  <span className='text-desk-helper'>
                    Waiting for the grader
                    {answer.review.retryCount > 0 && ` · retry ${answer.review.retryCount}`}
                  </span>
                ) : (
                  '—'
                )}
              </span>
            </div>

            {answer.content && (
              <Collapsible summary={`First email · ${answer.content.firstEmail.from}`}>
                <EmailText text={answer.content.firstEmail.text} />
                <AttachmentList attachments={answer.content.firstEmail.attachments} />
              </Collapsible>
            )}

            <div className='flex flex-col gap-[4px]'>
              <div className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>
                Their reply
              </div>
              <EmailText text={answer.replyText.trim() || '(blank)'} />
            </div>

            {answer.review && (
              <div className='flex flex-col gap-[4px]'>
                <div className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>
                  Grader
                </div>
                {answer.review.reasoning && (
                  <div className='text-sm text-foreground'>{answer.review.reasoning}</div>
                )}
                {answer.review.missedPoints.length > 0 && (
                  <ul className='flex flex-col gap-[2px] pl-4 text-sm text-desk-muted'>
                    {answer.review.missedPoints.map(point => (
                      <li key={point} className='list-disc'>
                        {point}
                      </li>
                    ))}
                  </ul>
                )}
                {answer.review.error && (
                  <div className='text-sm text-red-600 dark:text-red-400'>
                    {answer.review.error}
                  </div>
                )}
              </div>
            )}

            {answer.content && (
              <Collapsible
                summary={`How the desk handled it (${answer.content.thread.length} ${
                  answer.content.thread.length === 1 ? 'email' : 'emails'
                })`}
              >
                {answer.content.thread.length === 0 ? (
                  <div className='text-desk-helper'>
                    No later emails. The agent graded on its own judgement.
                  </div>
                ) : (
                  answer.content.thread.map(email => (
                    <div key={email.id} className='flex flex-col gap-1'>
                      <div className='text-xs text-muted-foreground'>
                        {email.inbound ? 'Customer' : 'Desk'} · {email.from} ·{' '}
                        {new Date(email.sentAt).toLocaleString()}
                      </div>
                      <EmailText text={email.text} />
                    </div>
                  ))
                )}
              </Collapsible>
            )}
          </div>
        ))
      )}
    </div>
  );
};
