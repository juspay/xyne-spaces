import React, { useEffect, useState } from 'react';
import { ArrowLeft, ChevronRight, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import Textarea from '../../../ui/Textarea/Textarea';
import { useAuthContextValues } from '../../../../hooks/useAuth';
import type { ChannelClawAgent } from '../../../../hooks/useChannelClawAgents';
import {
  ONBOARDING_MAX_REPLY_CHARS,
  ONBOARDING_MAX_TICKETS_PER_TOPIC as MAX,
  createOnboardingTopic,
  isGradingRecently,
  onboardingErrorMessage,
  retryOnboardingGrading,
  startOnboardingAttempt,
  submitOnboardingAttempt,
  updateOnboardingTopic,
  useDeskOnboardingState,
  useInvalidateDeskOnboarding,
  type OnboardingAttempt,
  type OnboardingExam,
  type OnboardingState,
  type OnboardingTopic,
  type OnboardingTopicPatch,
} from '../../../../services/clients/onboardingApi';
import { AutoDraftAgentPicker } from '../AutoDraftAgentPicker';

interface Props {
  channelId: string;
  /** The desk's Claw agents, for the per-topic grading agent picker. */
  clawAgents: ChannelClawAgent[];
}

/**
 * Onboarding exams: admins build papers of past tickets, new agents answer each ticket's first
 * email, and an agent grades the replies. Saves go straight to the server — this tab never
 * touches the Desk Settings draft or its save bar.
 */
export const OnboardingTab: React.FC<Props> = ({ channelId, clawAgents }) => {
  const { userID } = useAuthContextValues();
  const { data: state, isLoading, isError, refetch } = useDeskOnboardingState(channelId);
  const onChanged = useInvalidateDeskOnboarding(channelId);
  const [exam, setExam] = useState<OnboardingExam | null>(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const create = async (): Promise<void> => {
    setCreating(true);
    try {
      await createOnboardingTopic(channelId, name.trim());
      setName('');
      await onChanged();
    } catch (err) {
      toast.error(onboardingErrorMessage(err, "Couldn't create the topic"));
    } finally {
      setCreating(false);
    }
  };

  if (exam && state) {
    return (
      <OnboardingExamScreen
        key={exam.id}
        channelId={channelId}
        exam={exam}
        topicName={state.topics.find(t => t.id === exam.topicId)?.name ?? 'Exam'}
        onClose={() => setExam(null)}
        onChanged={onChanged}
      />
    );
  }

  return (
    <div className='flex flex-col gap-[16px]'>
      {state?.isAdmin && (
        <form
          className='flex items-center gap-2'
          onSubmit={e => {
            e.preventDefault();
            if (name.trim()) void create();
          }}
        >
          <input
            aria-label='New topic name'
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={`New topic, e.g. Refund requests — up to ${MAX} past tickets`}
            maxLength={200}
            className={inputClass}
            disabled={creating}
            data-track-category='DeskSettings'
            data-track-name='OnboardingNewTopicName'
          />
          <button
            type='submit'
            className={primaryButtonClass}
            disabled={creating || !name.trim()}
            data-track-category='DeskSettings'
            data-track-name='OnboardingCreateTopic'
          >
            <Plus size={14} />
            {creating ? 'Adding…' : 'Add topic'}
          </button>
        </form>
      )}

      {isLoading || isError || !state || !userID ? (
        <button
          type='button'
          onClick={() => void refetch()}
          className='self-start text-desk-helper hover:underline'
          data-track-category='DeskSettings'
          data-track-name='OnboardingRetryState'
        >
          {isLoading ? 'Loading onboarding…' : 'Couldn’t load onboarding for this desk. Try again'}
        </button>
      ) : state.topics.length === 0 ? (
        <div className='text-desk-helper'>
          {state.isAdmin
            ? `Add a topic above, put up to ${MAX} past tickets on it, then take it here.`
            : 'A desk admin hasn’t set up any onboarding topics yet.'}
        </div>
      ) : (
        <div className='flex flex-col gap-[12px]'>
          {state.topics.map(topic => (
            <TopicRow
              key={topic.id}
              channelId={channelId}
              userId={userID}
              state={state}
              topic={topic}
              clawAgents={clawAgents}
              onChanged={onChanged}
              onExam={setExam}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/** One paper: its setup for admins, the Start/Resume button, and the attempts on it. */
const TopicRow: React.FC<{
  channelId: string;
  userId: string;
  state: OnboardingState;
  topic: OnboardingTopic;
  clawAgents: ChannelClawAgent[];
  onChanged: () => Promise<void>;
  onExam: (exam: OnboardingExam) => void;
}> = ({ channelId, userId, state, topic, clawAgents, onChanged, onExam }) => {
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [search, setSearch] = useState('');
  const titles = new Map(state.tickets.map(t => [t.id, `${t.xyneId} · ${t.title}`]));
  const query = search.trim().toLowerCase();
  const matches = query
    ? state.tickets.filter(t => (titles.get(t.id) ?? '').toLowerCase().includes(query)).slice(0, 20)
    : [];

  const ids = topic.ticketIds ?? [];
  const full = ids.length >= MAX;
  const attempts = state.attempts
    .filter(a => a.topicId === topic.id && (state.isAdmin || a.userId === userId))
    .sort((a, b) => (b.submittedAt ?? b.startedAt).localeCompare(a.submittedAt ?? a.startedAt));
  const mine = attempts.filter(a => a.userId === userId);
  const open = mine.find(a => a.status === 'IN_PROGRESS');
  // A grading run older than the server's limit is presumed lost, and a retake is allowed.
  const grading = mine.find(isGradingRecently);
  const last = mine.find(a => a.status === 'GRADED' || a.status === 'FAILED');

  const save = async (patch: OnboardingTopicPatch, failure: string): Promise<void> => {
    setBusy(true);
    try {
      await updateOnboardingTopic(channelId, topic.id, patch);
      await onChanged();
    } catch (err) {
      toast.error(onboardingErrorMessage(err, failure));
    } finally {
      setBusy(false);
    }
  };

  const start = async (): Promise<void> => {
    setStarting(true);
    try {
      onExam(await startOnboardingAttempt(channelId, topic.id));
      await onChanged();
    } catch (err) {
      toast.error(onboardingErrorMessage(err, "Couldn't start the exam"));
    } finally {
      setStarting(false);
    }
  };

  return (
    <details className='rounded-[12px] border border-desk-border dark:border-border'>
      <summary className='flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3'>
        <div className='flex min-w-0 flex-1 flex-col gap-[2px]'>
          <span className='truncate text-sm font-medium text-foreground'>{topic.name}</span>
          <span className='text-desk-helper'>
            {topic.ticketCount}/{MAX} tickets
            {topic.ticketCount === 0 && ' · add tickets to use it'}
            {last?.status === 'GRADED' && ` · your last score ${scoreOrStatus(last)}`}
          </span>
          {/* Only this line is a live region: the poll must not re-announce the whole list. */}
          <span className='text-desk-helper' role='status' aria-live='polite'>
            {grading ? 'Being graded now — your score appears here in a minute or two.' : ''}
          </span>
        </div>
        {!grading && (
          <button
            type='button'
            className={open || !last ? primaryButtonClass : secondaryButtonClass}
            // Inside <summary>: without this, starting the exam also toggles the panel.
            onClick={e => {
              e.preventDefault();
              void start();
            }}
            disabled={starting || topic.ticketCount === 0}
            title={topic.ticketCount === 0 ? 'A desk admin hasn’t added tickets yet' : undefined}
            data-track-category='DeskSettings'
            data-track-name='OnboardingStartExam'
          >
            {starting ? 'Starting…' : open ? 'Resume' : last ? 'Retake' : 'Start'}
          </button>
        )}
      </summary>

      <div className='flex flex-col gap-[12px] border-t border-desk-border px-4 py-4 dark:border-border'>
        {state.isAdmin && (
          <>
            <div className='flex flex-wrap items-center gap-2'>
              <AutoDraftAgentPicker
                value={topic.graderAgentSlug ?? null}
                onChange={slug => void save({ graderAgentSlug: slug }, "Couldn't change the agent")}
                clawAgents={clawAgents}
                disabled={busy}
                defaultLabel={topic.defaultGraderAgentSlug ?? 'ask-ai'}
                emptyStateHelperText='Add a Claw agent to this channel to grade with it. Until then, the built-in ask-ai agent grades.'
              />
              <span className='flex-1 text-desk-helper'>
                {busy
                  ? 'Saving…'
                  : 'Grades compare each reply with the rest of that ticket’s thread.'}
              </span>
              <button
                type='button'
                className={iconButtonClass}
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Delete “${topic.name}”? Attempts on it are kept.`)) {
                    void save({ deleted: true }, "Couldn't delete the topic");
                  }
                }}
                aria-label={`Delete ${topic.name}`}
                data-track-category='DeskSettings'
                data-track-name='OnboardingDeleteTopic'
              >
                <Trash2 size={14} />
              </button>
            </div>

            {ids.length > 0 && (
              <ol className={listClass}>
                {ids.map((id, i) => (
                  <TicketRow
                    key={id}
                    label={`${i + 1}. ${titles.get(id) ?? 'Ticket unavailable'}`}
                    action='Remove'
                    disabled={busy}
                    onClick={() =>
                      void save({ ticketIds: ids.filter(t => t !== id) }, "Couldn't remove it")
                    }
                  />
                ))}
              </ol>
            )}

            <label>
              <span className='sr-only'>Search this desk’s tickets to add to this topic</span>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={full ? `Full (${MAX} tickets)` : 'Add a recent ticket by ID or title'}
                className={inputClass}
                disabled={busy || full}
                data-track-category='DeskSettings'
                data-track-name='OnboardingTicketSearch'
              />
            </label>
            {query && !full && (
              <ol className={`${listClass} max-h-[240px] overflow-y-auto`}>
                {matches.map(m => (
                  <TicketRow
                    key={m.id}
                    label={`${m.xyneId} · ${m.title}`}
                    action={ids.includes(m.id) ? 'Added' : 'Add'}
                    disabled={busy || ids.includes(m.id)}
                    onClick={() => void save({ ticketIds: [...ids, m.id] }, "Couldn't add it")}
                  />
                ))}
                {!matches.length && (
                  <li className='px-3 py-2 text-desk-helper'>No recent ticket matches.</li>
                )}
              </ol>
            )}
          </>
        )}

        <div className='flex flex-col gap-[6px]'>
          <span className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
            {state.isAdmin ? 'Attempts' : 'Your attempts'} ({attempts.length})
          </span>
          {attempts.length === 0 ? (
            <span className='text-desk-helper'>
              Nothing submitted yet. Scores and the grader’s feedback show up here.
            </span>
          ) : (
            <div className={listClass}>
              {attempts.map(attempt => {
                const person = state.users.find(u => u.id === attempt.userId);
                return (
                  <AttemptRow
                    key={attempt.id}
                    channelId={channelId}
                    attempt={attempt}
                    isAdmin={state.isAdmin}
                    person={person ? person.name || person.email : 'You'}
                    onChanged={onChanged}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </details>
  );
};

/** One ticket on the paper, or one search match — same row, different trailing action. */
const TicketRow: React.FC<{
  label: string;
  action: string;
  disabled: boolean;
  onClick: () => void;
}> = ({ label, action, disabled, onClick }) => (
  <li>
    <button
      type='button'
      onClick={onClick}
      disabled={disabled}
      className='flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent/50 disabled:opacity-60'
      data-track-category='DeskSettings'
      data-track-name='OnboardingTopicTicket'
    >
      <span className='flex-1 truncate text-sm text-foreground'>{label}</span>
      <span className='shrink-0 text-xs text-muted-foreground'>{action}</span>
    </button>
  </li>
);

/** One attempt: its score, and for admins each reply with the grader's score and reasoning. */
const AttemptRow: React.FC<{
  channelId: string;
  attempt: OnboardingAttempt;
  isAdmin: boolean;
  person: string;
  onChanged: () => Promise<void>;
}> = ({ channelId, attempt, isAdmin, person, onChanged }) => {
  const [retrying, setRetrying] = useState(false);

  const retry = async (): Promise<void> => {
    setRetrying(true);
    try {
      await retryOnboardingGrading(channelId, attempt.id);
      await onChanged();
      toast.success('Grading restarted.');
    } catch (err) {
      toast.error(onboardingErrorMessage(err, "Couldn't retry grading"));
    } finally {
      setRetrying(false);
    }
  };

  const graded = attempt.status === 'GRADED' && attempt.totalScore !== null;
  const percent =
    attempt.status === 'GRADED' && attempt.totalScore !== null && attempt.maxScore
      ? (attempt.totalScore / attempt.maxScore) * 100
      : null;

  return (
    <details className='group'>
      <summary className='flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-accent/30'>
        <ChevronRight
          size={14}
          className='shrink-0 text-muted-foreground transition-transform group-open:rotate-90'
        />
        <span className='min-w-0 flex-1 truncate text-sm font-medium text-foreground'>
          {person}
        </span>
        <span className='shrink-0 text-desk-helper tabular-nums'>
          {new Date(attempt.submittedAt ?? attempt.startedAt).toLocaleDateString(undefined, {
            day: 'numeric',
            month: 'short',
          })}
          {attempt.durationSeconds !== null &&
            ` · ${Math.max(1, Math.round(attempt.durationSeconds / 60))} min`}
        </span>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${scoreToneClass(percent)}`}
        >
          {graded
            ? `${attempt.totalScore}/${attempt.maxScore}`
            : // A failed attempt keeps its partial total; failed answers count as zero until a retry.
              attempt.status === 'FAILED' && attempt.totalScore !== null
              ? `${attempt.totalScore}/${attempt.maxScore} · ${STATUS.FAILED}`
              : STATUS[attempt.status]}
          {percent !== null && ` · ${Math.round(percent)}%`}
        </span>
      </summary>

      <div className='flex flex-col gap-[10px] bg-accent/20 px-4 py-3'>
        {attempt.answers.map((answer, i) => (
          <div
            key={i}
            className='flex flex-col gap-[8px] rounded-[10px] border border-desk-border bg-background p-3 dark:border-border'
          >
            <div className='flex items-baseline gap-2'>
              <span className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
                Ticket {i + 1}
              </span>
              <span className='flex-1' />
              {isAdmin && typeof answer.score === 'number' && (
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${scoreToneClass((answer.score / MAX_SCORE) * 100)}`}
                >
                  {answer.score}/{MAX_SCORE}
                </span>
              )}
            </div>
            <div className='flex flex-col gap-[4px]'>
              <span className='text-xs font-medium text-muted-foreground'>Reply sent</span>
              <div className={emailTextClass}>
                {answer.replyText.trim() || <em className='text-muted-foreground'>Left blank</em>}
              </div>
            </div>
            {/* Guarded here too: the server projection already strips these for members, and the
                client should not be the one place a regression could surface the answer key. */}
            {isAdmin && answer.reasoning && (
              <div className='flex flex-col gap-[4px] border-l-2 border-desk-accent pl-3'>
                <span className='text-xs font-medium text-muted-foreground'>Grader feedback</span>
                <div className='text-sm leading-relaxed text-foreground'>{answer.reasoning}</div>
              </div>
            )}
            {isAdmin && answer.error && (
              <div className='rounded-[8px] bg-red-500/10 px-2 py-1.5 text-sm text-red-700 dark:text-red-300'>
                {answer.error}
              </div>
            )}
          </div>
        ))}
        {isAdmin && attempt.answers.some(a => typeof a.score !== 'number') && (
          <button
            type='button'
            className={`${secondaryButtonClass} self-start`}
            onClick={() => void retry()}
            disabled={retrying || isGradingRecently(attempt)}
            data-track-category='DeskSettings'
            data-track-name='OnboardingRetryGrading'
          >
            <RotateCcw size={14} />
            {retrying ? 'Retrying…' : 'Retry grading'}
          </button>
        )}
      </div>
    </details>
  );
};

/** Score bands: a number alone doesn't say whether it's good, so the pill carries the verdict. */
const scoreToneClass = (percent: number | null): string =>
  percent === null
    ? 'bg-accent text-muted-foreground'
    : percent >= 80
      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
      : percent >= 50
        ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
        : 'bg-red-500/15 text-red-700 dark:text-red-300';
/** Matches MAX_SCORE_PER_ANSWER on the server. */
const MAX_SCORE = 10;

const secondaryButtonClass =
  'inline-flex items-center gap-1.5 rounded-[10px] border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground shadow-sm hover:bg-muted/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-desk-accent disabled:cursor-not-allowed disabled:opacity-50';

const primaryButtonClass =
  'inline-flex items-center gap-1.5 rounded-[10px] border border-desk-accent bg-desk-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:opacity-90 focus:outline-none focus-visible:ring-1 focus-visible:ring-desk-accent disabled:cursor-not-allowed disabled:opacity-50';

const iconButtonClass =
  'flex h-7 w-7 items-center justify-center rounded-[8px] text-muted-foreground hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-desk-accent disabled:opacity-40';

const inputClass =
  'w-full rounded-[10px] border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-desk-accent disabled:opacity-50';

/** One bordered container for every onboarding list. */
const listClass =
  'flex flex-col divide-y divide-desk-border rounded-[12px] border border-desk-border dark:divide-border dark:border-border';

/** Long email text scrolls in place, so one huge email can't stretch the page. */
const emailTextClass =
  'max-h-[320px] overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground';

const STATUS = {
  IN_PROGRESS: 'In progress',
  GRADING: 'Grading…',
  GRADED: 'Graded',
  FAILED: 'Grading failed',
} satisfies Record<OnboardingAttempt['status'], string>;

/** A graded attempt shows its total, anything else shows where it is. */
const scoreOrStatus = (a: OnboardingAttempt): string =>
  a.status === 'GRADED' && a.totalScore !== null
    ? `${a.totalScore}/${a.maxScore}`
    : STATUS[a.status];

/** Unsubmitted replies stay in this browser, so leaving and coming back resumes them. */
const draftKey = (attemptId: string): string => `desk-onboarding-draft:${attemptId}`;

function readDraft(exam: OnboardingExam): string[] {
  const fromServer = exam.answers.map(a => a.replyText);
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(draftKey(exam.id)) ?? 'null');
    return Array.isArray(saved) &&
      saved.length === fromServer.length &&
      saved.every(r => typeof r === 'string')
      ? saved
      : fromServer;
  } catch {
    return fromServer;
  }
}

/** One paper: every ticket's first email with the reply box under it, and one Submit. */
const OnboardingExamScreen: React.FC<{
  channelId: string;
  exam: OnboardingExam;
  topicName: string;
  onClose: () => void;
  onChanged: () => Promise<void>;
}> = ({ channelId, exam, topicName, onClose, onChanged }) => {
  const [replies, setReplies] = useState<string[]>(() => readDraft(exam));
  const [submitting, setSubmitting] = useState(false);
  const answered = replies.filter(r => r.trim()).length;

  useEffect(() => {
    try {
      localStorage.setItem(draftKey(exam.id), JSON.stringify(replies));
    } catch {
      // Storage full or blocked: the replies still live in this screen until it closes.
    }
  }, [exam.id, replies]);

  const submit = async (): Promise<void> => {
    const blanks = replies.length - answered;
    if (
      blanks > 0 &&
      !window.confirm(
        `${blanks} of ${replies.length} replies are blank and will score zero. Replies can’t be changed after submitting. Submit anyway?`,
      )
    ) {
      return;
    }
    setSubmitting(true);
    try {
      await submitOnboardingAttempt(channelId, exam.id, replies);
      try {
        localStorage.removeItem(draftKey(exam.id));
      } catch {
        // Nothing to clean up if storage is unavailable.
      }
      await onChanged();
      toast.success('Submitted. Your score appears here once grading finishes.');
      onClose();
    } catch (err) {
      toast.error(onboardingErrorMessage(err, "Couldn't submit the exam"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className='flex flex-col gap-[16px]'>
      <div className='flex flex-wrap items-center gap-3'>
        <button
          type='button'
          onClick={onClose}
          className={secondaryButtonClass}
          data-track-category='DeskSettings'
          data-track-name='OnboardingLeaveExam'
        >
          <ArrowLeft size={14} />
          Back
        </button>
        <div className='flex min-w-0 flex-1 flex-col'>
          <span className='truncate text-base font-semibold text-foreground'>{topicName}</span>
          <span className='text-desk-helper'>
            {answered} of {replies.length} answered · replies are saved in this browser until you
            submit, and can’t be changed after submitting.
          </span>
        </div>
        <button
          type='button'
          onClick={() => void submit()}
          disabled={submitting}
          className={primaryButtonClass}
          data-track-category='DeskSettings'
          data-track-name='OnboardingSubmitExam'
        >
          {submitting ? 'Submitting…' : 'Submit'}
        </button>
      </div>

      {exam.questions.map((email, i) => (
        <div
          key={i}
          className='flex flex-col gap-[10px] rounded-[12px] border border-desk-border p-4 dark:border-border'
        >
          <div className='text-sm font-semibold text-foreground'>
            Ticket {i + 1} of {exam.questions.length} · {email?.subject || '(no subject)'}
          </div>
          {email ? (
            <>
              <div className='text-desk-helper'>
                From {email.from} · {new Date(email.sentAt).toLocaleString()}
              </div>
              <div className={emailTextClass}>{email.text || '(This email has no text.)'}</div>
            </>
          ) : (
            <div className='text-desk-helper'>
              This ticket is no longer available. You can leave the reply blank.
            </div>
          )}
          <label className='flex flex-col gap-[6px]' htmlFor={`reply-${i}`}>
            <span className='text-sm font-medium text-foreground'>Your reply</span>
            <Textarea
              id={`reply-${i}`}
              value={replies[i] ?? ''}
              onChange={e => setReplies(prev => prev.map((r, j) => (j === i ? e.target.value : r)))}
              placeholder='Write the reply you would send to this customer.'
              maxLength={ONBOARDING_MAX_REPLY_CHARS}
              className='min-h-[180px] resize-y rounded-[10px]'
              disabled={submitting}
            />
          </label>
        </div>
      ))}
    </div>
  );
};
