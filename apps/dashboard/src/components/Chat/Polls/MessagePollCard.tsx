import { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Check, ChevronDown, Lock, Plus, ShieldCheck } from 'lucide-react';
import type { QueryResultType } from '@rocicorp/zero';
import { POLL_LIMITS, type PollNonChoiceResponseType, type PollResponseInput } from '@xyne/shared';
import { queries } from '../../../zero/queries';
import { mutators } from '../../../zero/mutators';
import { useQuery } from '../../../hooks/useQuery';
import { useUsersById } from '../../../hooks/useUsers';
import { useZero } from '../../../hooks/useZero';
import { surfaceMutationError } from '../../../utils/zeroMutationToast';
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
  const [poll] = useQuery(queries.pollByMessageId({ messageId, ...(channelId && { channelId }) }));

  if (!poll) {
    return <div className='text-sm text-muted-foreground'>Loading poll…</div>;
  }

  return <LoadedMessagePollCard poll={poll} {...(channelId && { channelId })} />;
}

function LoadedMessagePollCard({ poll, channelId }: { poll: LoadedPoll; channelId?: string }) {
  const zero = useZero();
  const usersById = useUsersById();
  const isCreator = poll.createdBy === zero.userID;
  const [resultRows] = useQuery(
    queries.pollQuestionResultsByPollId({ pollId: poll.id, ...(channelId && { channelId }) }),
  );
  const [myVotes] = useQuery(
    queries.myPollVotesByPollId({ pollId: poll.id, ...(channelId && { channelId }) }),
  );
  const [voterBallots] = useQuery(
    queries.pollVoterDetails({ pollId: poll.id, ...(channelId && { channelId }) }),
    isCreator && !poll.isAnonymous,
  );
  const [newChoices, setNewChoices] = useState<Record<string, string>>({});
  const isClosed = poll.closedAt !== null && poll.closedAt !== undefined;
  // A zero-valued result row is created with every question. If ACLs hide that
  // row, this array is empty; the UI never reimplements result authorization.
  const resultsVisible = resultRows.length > 0;

  return (
    <section className='w-full max-w-xl space-y-5 rounded-xl border border-border bg-card p-4'>
      <div className='flex items-center justify-between gap-3'>
        <p className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>Poll</p>
        {poll.isAnonymous && (
          <span className='flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground'>
            <ShieldCheck className='h-3.5 w-3.5' /> Anonymous
          </span>
        )}
        {isClosed && <span className='text-xs font-medium text-muted-foreground'>Poll closed</span>}
      </div>

      {poll.questions.map(question => {
        const aggregate = resultRows.find(result => result.questionId === question.id);
        const ownVotes = myVotes.filter(vote => vote.questionId === question.id);
        const results = calculatePollResults(question.options, aggregate, ownVotes);
        const voterDetails = buildPollVoterDetails({
          creatorId: poll.createdBy,
          currentUserId: zero.userID ?? '',
          isAnonymous: poll.isAnonymous,
          options: question.options,
          ballots: voterBallots.filter(ballot => ballot.questionId === question.id),
          usersById,
        });
        const responseDetails = buildPollResponseDetails({
          creatorId: poll.createdBy,
          currentUserId: zero.userID ?? '',
          isAnonymous: poll.isAnonymous,
          responseType: question.responseType,
          options: question.options,
          ballots: voterBallots.filter(ballot => ballot.questionId === question.id),
          usersById,
        });

        return (
          <fieldset key={question.id} className='space-y-2'>
            <legend className='mb-2 font-semibold text-foreground'>{question.question}</legend>
            {['SINGLE_CHOICE', 'MULTIPLE_CHOICE'].includes(question.responseType) ? (
              question.options
                .slice()
                .sort((a, b) =>
                  poll.sortResultsByVotes
                    ? (results.options.find(item => item.optionId === b.id)?.count ?? 0) -
                      (results.options.find(item => item.optionId === a.id)?.count ?? 0)
                    : a.position - b.position,
                )
                .map(option => {
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
                      <span className='relative flex h-5 w-5 shrink-0 items-center justify-center rounded border border-primary'>
                        {selected && <Check className='h-3.5 w-3.5' />}
                      </span>
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
              <p className='flex items-center gap-1 text-xs text-muted-foreground'>
                <Lock className='h-3.5 w-3.5' />
                {poll.resultVisibility === 'AFTER_CLOSE'
                  ? 'Results are visible when the poll closes.'
                  : poll.resultVisibility === 'ADMIN_ONLY'
                    ? 'Results are visible to the poll creator and channel admins.'
                    : 'Results are only visible to the poll creator.'}
              </p>
            )}

            {resultsVisible && voterDetails && (
              <details
                className='group rounded-lg border border-border bg-muted/20'
                data-prevent-thread
              >
                <summary className='flex cursor-pointer list-none items-center justify-between px-3 py-2 text-sm font-medium'>
                  View responses
                  <ChevronDown className='h-4 w-4 transition-transform group-open:rotate-180' />
                </summary>
                <div className='space-y-3 border-t border-border px-3 py-3'>
                  {voterDetails.map(option => (
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
              </details>
            )}

            {resultsVisible &&
              responseDetails &&
              !['SINGLE_CHOICE', 'MULTIPLE_CHOICE'].includes(question.responseType) && (
                <details
                  className='group rounded-lg border border-border bg-muted/20'
                  data-prevent-thread
                >
                  <summary className='flex cursor-pointer list-none items-center justify-between px-3 py-2 text-sm font-medium'>
                    View responses
                    <ChevronDown className='h-4 w-4 transition-transform group-open:rotate-180' />
                  </summary>
                  <ul className='space-y-3 border-t border-border px-3 py-3'>
                    {responseDetails.length === 0 ? (
                      <li className='text-xs text-muted-foreground'>No responses yet</li>
                    ) : (
                      responseDetails.map(response => (
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
                </details>
              )}

            {!isClosed &&
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
                    placeholder='Add a choice'
                    maxLength={POLL_LIMITS.maxOptionLength}
                    data-track-category='POLL'
                    data-track-name='TYPE_AUDIENCE_CHOICE'
                    className='min-w-0 flex-1'
                  />
                  <Button
                    type='button'
                    aria-label='Add choice'
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
                      void surfaceMutationError(mutation, 'Unable to add this choice').then(ok => {
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
          onClick={() => {
            const mutation = zero.mutate(
              mutators.polls.close({ pollId: poll.id, timestamp: Date.now() }),
            );
            void surfaceMutationError(mutation, 'Unable to close this poll');
          }}
        >
          Close poll
        </Button>
      )}
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
    void surfaceMutationError(mutation, 'Unable to submit your response');
  };

  if (question.responseType === 'RATING_1_TO_5') {
    return (
      <div className='flex flex-wrap gap-2' data-prevent-thread>
        {[1, 2, 3, 4, 5].map(value => (
          <button
            key={value}
            type='button'
            disabled={disabled}
            aria-pressed={rating === value}
            className={`h-9 w-9 rounded-md border ${rating === value ? 'border-primary bg-primary/10' : 'border-border'}`}
            onClick={() => {
              setRating(value);
              submit({ rating: value });
            }}
            data-track-category='POLL'
            data-track-name='RATE'
          >
            {value}
          </button>
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
            <button
              type='button'
              aria-label={`Move ${question.options.find(option => option.id === optionId)?.text ?? 'option'} up`}
              disabled={disabled || index === 0}
              onClick={() => move(index, -1)}
              data-track-category='POLL'
              data-track-name='RANK_UP'
            >
              ↑
            </button>
            <button
              type='button'
              aria-label={`Move ${question.options.find(option => option.id === optionId)?.text ?? 'option'} down`}
              disabled={disabled || index === ranking.length - 1}
              onClick={() => move(index, 1)}
              data-track-category='POLL'
              data-track-name='RANK_DOWN'
            >
              ↓
            </button>
          </div>
        ))}
        <Button
          type='button'
          disabled={disabled}
          size='sm'
          onClick={() => submit({ rankedOptionIds: ranking })}
          data-track-category='POLL'
          data-track-name='SUBMIT_RANKING'
        >
          Submit ranking
        </Button>
      </div>
    );
  }

  return (
    <div className='space-y-2' data-prevent-thread>
      <Textarea
        value={text}
        disabled={disabled}
        maxLength={question.responseType === 'SHORT_TEXT' ? 500 : 5000}
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
        onClick={() => submit({ textAnswer: text.trim() })}
        data-track-category='POLL'
        data-track-name='SUBMIT_RESPONSE'
      >
        Submit response
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
    const count = aggregate?.responseCount ?? 0;
    return (
      <p className='text-xs text-muted-foreground'>
        {count} {count === 1 ? 'response' : 'responses'}
      </p>
    );
  }
  return null;
}
