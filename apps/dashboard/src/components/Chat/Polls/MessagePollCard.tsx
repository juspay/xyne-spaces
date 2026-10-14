import { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { Check, ChevronDown, ChevronUp, Circle, Lock, Plus, ShieldCheck } from 'lucide-react';
import type { QueryResultType } from '@rocicorp/zero';
import {
  POLL_LIMITS,
  isChoiceResponseType,
  isPollClosed,
  type PollNonChoiceResponseType,
  type PollResponseInput,
} from '@xyne/shared';
import { queries } from '../../../zero/queries';
import { mutators } from '../../../zero/mutators';
import { useQuery } from '../../../hooks/useQuery';
import { useUsersById } from '../../../hooks/useUsers';
import { useZero } from '../../../hooks/useZero';
import { useConfirmDialog } from '../../../hooks/useConfirmDialog';
import { surfaceMutationError } from '../../../utils/zeroMutationToast';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import Input from '../../ui/Input';
import Textarea from '../../ui/Textarea';
import UserAvatar, { AvatarSize } from '../../UserAvatar/UserAvatar';
import { calculatePollResults, calculateRankingResult, calculateRatingResult } from './pollResults';
import { buildPollResponseDetails, buildPollVoterDetails } from './pollVoterDetails';

type LoadedPoll = NonNullable<QueryResultType<typeof queries.pollByMessageId>>;
type PollResultRow = QueryResultType<typeof queries.pollQuestionResultsByPollId>[number];
type OwnPollVote = QueryResultType<typeof queries.myPollVotesByPollId>[number];

export function MessagePollCard({
  messageId,
  channelId,
}: {
  messageId: string;
  channelId?: string;
}) {
  const [poll, details] = useQuery(
    queries.pollByMessageId({ messageId, ...(channelId && { channelId }) }),
  );

  if (!poll) {
    return (
      <div className='text-sm text-muted-foreground'>
        {details.type === 'unknown' ? 'Loading poll…' : 'This poll is unavailable.'}
      </div>
    );
  }

  return <LoadedMessagePollCard poll={poll} {...(channelId && { channelId })} />;
}

function LoadedMessagePollCard({ poll, channelId }: { poll: LoadedPoll; channelId?: string }) {
  const zero = useZero();
  const usersById = useUsersById();
  const isCreator = poll.createdBy === zero.userID;
  const showVoterDetails = isCreator && !poll.isAnonymous;
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const [resultRows, resultDetails] = useQuery(
    queries.pollQuestionResultsByPollId({ pollId: poll.id, ...(channelId && { channelId }) }),
  );
  const [myVotes] = useQuery(
    queries.myPollVotesByPollId({ pollId: poll.id, ...(channelId && { channelId }) }),
  );
  const [voterBallots] = useQuery(
    queries.pollVoterDetails({ pollId: poll.id, ...(channelId && { channelId }) }),
    showVoterDetails,
  );
  const [newChoices, setNewChoices] = useState<Record<string, string>>({});
  const isClosed = isPollClosed(poll);
  // A zero-valued result row is created with every question. If ACLs hide that
  // row, this array is empty; the UI never reimplements result authorization.
  const resultsVisible = resultRows.length > 0;
  // Only claim results are hidden once the query has settled empty; EVERYONE
  // polls are never hidden, so they never show the lock.
  const resultsLocked =
    !resultsVisible && resultDetails.type === 'complete' && poll.resultVisibility !== 'EVERYONE';

  const closePoll = async (): Promise<void> => {
    const confirmed = await confirm({
      title: 'Close this poll?',
      description: 'Voting ends for everyone. A closed poll cannot be reopened.',
      confirmLabel: 'Close poll',
      variant: 'destructive',
    });
    if (!confirmed) return;
    const mutation = zero.mutate(mutators.polls.close({ pollId: poll.id, timestamp: Date.now() }));
    void surfaceMutationError(mutation, 'Unable to close this poll');
  };

  return (
    <section className='w-full max-w-xl space-y-5 rounded-xl border border-border bg-card p-4'>
      <div className='flex items-center justify-between gap-3'>
        <p className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>Poll</p>
        <div className='flex items-center gap-2'>
          {poll.isAnonymous && (
            <Badge variant='secondary'>
              <ShieldCheck /> Anonymous
            </Badge>
          )}
          {isClosed ? (
            <span className='text-xs font-medium text-muted-foreground'>Poll closed</span>
          ) : (
            !!poll.closesAt && (
              <span className='text-xs text-muted-foreground'>
                Closes {formatDistanceToNow(poll.closesAt, { addSuffix: true })}
              </span>
            )
          )}
        </div>
      </div>

      {poll.questions.map(question => {
        const aggregate = resultRows.find(result => result.questionId === question.id);
        const ownVotes = myVotes.filter(vote => vote.questionId === question.id);
        const results = calculatePollResults(question.options, aggregate, ownVotes);
        const isChoice = isChoiceResponseType(question.responseType);
        const isSingleChoice = question.responseType === 'SINGLE_CHOICE';
        const questionBallots = voterBallots.filter(ballot => ballot.questionId === question.id);

        return (
          <fieldset key={question.id} className='space-y-2'>
            <legend className='mb-2 font-semibold text-foreground'>{question.question}</legend>
            {isChoice && (
              <p className='text-xs text-muted-foreground'>
                {isSingleChoice ? 'Select one' : 'Select any'}
              </p>
            )}
            {isChoice ? (
              question.options.map(option => {
                const result = results.options.find(item => item.optionId === option.id)!;
                const selected = results.currentSelections.includes(option.id);
                return (
                  <button
                    key={option.id}
                    type='button'
                    data-prevent-thread
                    aria-pressed={selected}
                    disabled={isClosed}
                    data-track-category='POLL'
                    data-track-name='VOTE'
                    onClick={() => {
                      const mutation = zero.mutate(
                        mutators.polls.vote({
                          voteId: uuidv4(),
                          pollId: poll.id,
                          questionId: question.id,
                          optionId: option.id,
                          selected: !selected,
                          timestamp: Date.now(),
                        }),
                      );
                      void surfaceMutationError(mutation, 'Unable to update your vote');
                    }}
                    className='relative flex w-full items-center gap-2 overflow-hidden rounded-lg border border-border px-3 py-2 text-left hover:bg-accent'
                  >
                    <span
                      className='absolute inset-y-0 left-0 bg-primary/10 transition-[width]'
                      style={{ width: resultsVisible ? `${result.percentage}%` : '0%' }}
                    />
                    {isSingleChoice ? (
                      <span
                        className={`relative flex size-4 shrink-0 items-center justify-center rounded-full border-[1.5px] ${selected ? 'border-primary' : 'border-secondary-foreground/50'}`}
                      >
                        {selected && <Circle className='size-2 fill-primary stroke-none' />}
                      </span>
                    ) : (
                      <span
                        className={`relative flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] border ${selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card'}`}
                      >
                        {selected && <Check className='size-3' />}
                      </span>
                    )}
                    <span className='relative flex-1 text-sm'>{option.text}</span>
                    {resultsVisible && (
                      <span className='relative text-xs text-muted-foreground'>
                        {result.count} · {result.percentage}%
                      </span>
                    )}
                  </button>
                );
              })
            ) : (
              <NonChoicePollAnswer
                pollId={poll.id}
                question={question}
                key={`${question.options.map(option => option.id).join(',')}:${ownVotes[0]?.updatedAt ?? ''}`}
                ownResponse={ownVotes[0]}
                disabled={isClosed}
              />
            )}
            {resultsVisible && <TypedResultSummary question={question} aggregate={aggregate} />}
            {resultsVisible ? (
              <p className='text-xs text-muted-foreground'>
                {results.voterCount} {results.voterCount === 1 ? 'voter' : 'voters'}
              </p>
            ) : (
              resultsLocked && (
                <p className='flex items-center gap-1 text-xs text-muted-foreground'>
                  <Lock className='h-3.5 w-3.5' />
                  {poll.resultVisibility === 'AFTER_CLOSE'
                    ? 'Results are visible when the poll closes.'
                    : poll.resultVisibility === 'ADMIN_ONLY'
                      ? 'Results are visible to the poll creator and channel admins.'
                      : 'Results are only visible to the poll creator.'}
                </p>
              )
            )}

            {resultsVisible && showVoterDetails && (
              <details
                className='group rounded-lg border border-border bg-muted/20'
                data-prevent-thread
              >
                <summary className='flex cursor-pointer list-none items-center justify-between px-3 py-2 text-sm font-medium'>
                  View responses
                  <ChevronDown className='h-4 w-4 transition-transform group-open:rotate-180' />
                </summary>
                {isChoice ? (
                  <div className='space-y-3 border-t border-border px-3 py-3'>
                    {buildPollVoterDetails({
                      options: question.options,
                      ballots: questionBallots,
                      usersById,
                    }).map(option => (
                      <div key={option.optionId}>
                        <p className='text-xs font-medium text-foreground'>{option.optionText}</p>
                        {option.voters.length === 0 ? (
                          <p className='mt-1 text-xs text-muted-foreground'>No votes yet</p>
                        ) : (
                          <ul className='mt-1.5 space-y-1.5'>
                            {option.voters.map(voter => (
                              <li key={voter.userId} className='flex items-center gap-2 text-sm'>
                                <UserAvatar
                                  userId={voter.userId}
                                  size={AvatarSize.SM}
                                  showActiveStatus={false}
                                />
                                <span>{voter.name}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <ul className='space-y-3 border-t border-border px-3 py-3'>
                    {questionBallots.length === 0 ? (
                      <li className='text-xs text-muted-foreground'>No responses yet</li>
                    ) : (
                      buildPollResponseDetails({
                        responseType: question.responseType,
                        options: question.options,
                        ballots: questionBallots,
                        usersById,
                      }).map(response => (
                        <li key={response.userId} className='flex items-start gap-2 text-sm'>
                          <UserAvatar
                            userId={response.userId}
                            size={AvatarSize.SM}
                            showActiveStatus={false}
                          />
                          <div className='min-w-0'>
                            <p className='font-medium'>{response.name}</p>
                            <p className='whitespace-pre-wrap break-words text-muted-foreground'>
                              {response.answer}
                            </p>
                          </div>
                        </li>
                      ))
                    )}
                  </ul>
                )}
              </details>
            )}

            {isChoice &&
              !isClosed &&
              poll.allowAudienceChoices &&
              question.options.length < POLL_LIMITS.maxOptions && (
                <div className='flex gap-2' data-prevent-thread>
                  <Input
                    value={newChoices[question.id] ?? ''}
                    onChange={event =>
                      setNewChoices(current => ({
                        ...current,
                        [question.id]: event.target.value,
                      }))
                    }
                    placeholder='Add an option'
                    maxLength={POLL_LIMITS.maxOptionLength}
                    data-track-category='POLL'
                    data-track-name='TYPE_AUDIENCE_CHOICE'
                    className='min-w-0 flex-1'
                  />
                  <Button
                    type='button'
                    aria-label='Add option'
                    variant='outline'
                    size='icon'
                    data-track-category='POLL'
                    data-track-name='ADD_AUDIENCE_CHOICE'
                    onClick={() => {
                      const text = (newChoices[question.id] ?? '').trim();
                      if (!text) return;
                      const mutation = zero.mutate(
                        mutators.polls.addOption({
                          id: uuidv4(),
                          questionId: question.id,
                          text,
                          timestamp: Date.now(),
                        }),
                      );
                      void surfaceMutationError(mutation, 'Unable to add this option').then(ok => {
                        if (ok) {
                          setNewChoices(current => ({ ...current, [question.id]: '' }));
                        }
                      });
                    }}
                  >
                    <Plus className='h-4 w-4' />
                  </Button>
                </div>
              )}
          </fieldset>
        );
      })}

      {isCreator && poll.isAnonymous && (
        <p className='text-xs text-muted-foreground'>Voter identities are hidden for this poll.</p>
      )}
      {isCreator && !isClosed && (
        <Button
          type='button'
          data-prevent-thread
          variant='outline'
          size='sm'
          className='w-fit'
          data-track-category='POLL'
          data-track-name='CLOSE'
          onClick={() => void closePoll()}
        >
          Close poll
        </Button>
      )}
      <ConfirmDialog />
    </section>
  );
}

function NonChoicePollAnswer({
  pollId,
  question,
  ownResponse,
  disabled,
}: {
  pollId: string;
  question: LoadedPoll['questions'][number];
  ownResponse: OwnPollVote | undefined;
  disabled: boolean;
}) {
  const zero = useZero();
  const [text, setText] = useState(ownResponse?.textAnswer ?? '');
  const [rating, setRating] = useState(ownResponse?.rating ?? 0);
  const [ranking, setRanking] = useState<string[]>(
    ownResponse?.rankedOptionIds ?? question.options.map(option => option.id),
  );

  const submit = (answer: Omit<PollResponseInput, 'questionId' | 'responseType'>) => {
    const mutation = zero.mutate(
      mutators.polls.respond({
        responseId: uuidv4(),
        pollId,
        response: {
          questionId: question.id,
          responseType: question.responseType as PollNonChoiceResponseType,
          ...answer,
        },
        timestamp: Date.now(),
      }),
    );
    return surfaceMutationError(mutation, 'Unable to submit your response');
  };
  const submitWithToast = (
    answer: Omit<PollResponseInput, 'questionId' | 'responseType'>,
  ): void => {
    void submit(answer).then(ok => ok && toast.success('Response submitted'));
  };

  if (question.responseType === 'RATING_1_TO_5') {
    return (
      <div className='flex flex-wrap gap-2' data-prevent-thread>
        {[1, 2, 3, 4, 5].map(value => (
          <Button
            key={value}
            type='button'
            variant={rating === value ? 'default' : 'outline'}
            size='icon'
            disabled={disabled}
            aria-pressed={rating === value}
            onClick={() => {
              setRating(value);
              void submit({ rating: value });
            }}
            data-track-category='POLL'
            data-track-name='RATE'
          >
            {value}
          </Button>
        ))}
      </div>
    );
  }

  if (question.responseType === 'RANKING') {
    const move = (index: number, direction: -1 | 1) => {
      const next = [...ranking];
      const target = index + direction;
      if (target < 0 || target >= next.length) return;
      const currentOptionId = next[index];
      const targetOptionId = next[target];
      if (!currentOptionId || !targetOptionId) return;
      next[index] = targetOptionId;
      next[target] = currentOptionId;
      setRanking(next);
    };
    return (
      <div className='space-y-2' data-prevent-thread>
        {ranking.map((optionId, index) => (
          <div
            key={optionId}
            className='flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm'
          >
            <span className='font-medium'>{index + 1}</span>
            <span className='flex-1'>
              {question.options.find(option => option.id === optionId)?.text}
            </span>
            <Button
              type='button'
              variant='ghost'
              size='iconSm'
              aria-label={`Move ${question.options.find(option => option.id === optionId)?.text ?? 'option'} up`}
              disabled={disabled || index === 0}
              onClick={() => move(index, -1)}
              data-track-category='POLL'
              data-track-name='RANK_UP'
            >
              <ChevronUp />
            </Button>
            <Button
              type='button'
              variant='ghost'
              size='iconSm'
              aria-label={`Move ${question.options.find(option => option.id === optionId)?.text ?? 'option'} down`}
              disabled={disabled || index === ranking.length - 1}
              onClick={() => move(index, 1)}
              data-track-category='POLL'
              data-track-name='RANK_DOWN'
            >
              <ChevronDown />
            </Button>
          </div>
        ))}
        <Button
          type='button'
          disabled={disabled}
          size='sm'
          onClick={() => submitWithToast({ rankedOptionIds: ranking })}
          data-track-category='POLL'
          data-track-name='SUBMIT_RANKING'
        >
          {ownResponse ? 'Update ranking' : 'Submit ranking'}
        </Button>
      </div>
    );
  }

  return (
    <div className='space-y-2' data-prevent-thread>
      <Textarea
        value={text}
        disabled={disabled}
        maxLength={
          question.responseType === 'SHORT_TEXT'
            ? POLL_LIMITS.maxShortTextLength
            : POLL_LIMITS.maxLongTextLength
        }
        rows={question.responseType === 'SHORT_TEXT' ? 2 : 4}
        placeholder={
          question.responseType === 'SHORT_TEXT' ? 'Write a short response' : 'Write your answer'
        }
        className='resize-y'
        onChange={event => setText(event.target.value)}
        data-track-category='POLL'
        data-track-name='TYPE_RESPONSE'
      />
      <Button
        type='button'
        disabled={disabled || !text.trim()}
        size='sm'
        onClick={() => submitWithToast({ textAnswer: text.trim() })}
        data-track-category='POLL'
        data-track-name='SUBMIT_RESPONSE'
      >
        {ownResponse ? 'Update response' : 'Submit response'}
      </Button>
    </div>
  );
}

function TypedResultSummary({
  question,
  aggregate,
}: {
  question: LoadedPoll['questions'][number];
  aggregate: PollResultRow | undefined;
}) {
  if (question.responseType === 'RATING_1_TO_5') {
    const rating = calculateRatingResult(aggregate);
    return (
      <div className='rounded-md bg-muted/40 px-3 py-2 text-sm text-muted-foreground'>
        Average <span className='font-semibold text-foreground'>{rating.average || '—'}</span>/5
        {' · '}
        {rating.responseCount} {rating.responseCount === 1 ? 'response' : 'responses'}
      </div>
    );
  }
  if (question.responseType === 'RANKING') {
    const ranked = calculateRankingResult(question.options, aggregate);
    return (
      <ol className='space-y-1 rounded-md bg-muted/40 px-3 py-2 text-sm'>
        {ranked.map((result, index) => (
          <li key={result.optionId} className='flex justify-between gap-3'>
            <span>
              {index + 1}. {question.options.find(option => option.id === result.optionId)?.text}
            </span>
            <span className='text-muted-foreground'>avg rank {result.averageRank || '—'}</span>
          </li>
        ))}
      </ol>
    );
  }
  if (question.responseType === 'SHORT_TEXT' || question.responseType === 'Q_AND_A') {
    const count = aggregate?.voterCount ?? 0;
    return (
      <p className='text-xs text-muted-foreground'>
        {count} {count === 1 ? 'response' : 'responses'}
      </p>
    );
  }
  return null;
}
