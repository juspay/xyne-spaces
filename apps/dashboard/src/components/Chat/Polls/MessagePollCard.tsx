import { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Check, Plus } from 'lucide-react';
import { POLL_LIMITS } from '@xyne/shared';
import { queries } from '../../../zero/queries';
import { mutators } from '../../../zero/mutators';
import { useQuery } from '../../../hooks/useQuery';
import { useZero } from '../../../hooks/useZero';
import { surfaceMutationError } from '../../../utils/zeroMutationToast';
import { calculatePollResults } from './pollResults';

export function MessagePollCard({
  messageId,
  channelId,
}: {
  messageId: string;
  channelId?: string;
}) {
  const zero = useZero();
  const [poll] = useQuery(queries.pollByMessageId({ messageId, ...(channelId && { channelId }) }));
  const [newChoices, setNewChoices] = useState<Record<string, string>>({});

  if (!poll) {
    return <div className='text-sm text-muted-foreground'>Loading poll…</div>;
  }

  return (
    <section className='w-full max-w-xl space-y-4 rounded-xl border border-border bg-card p-4'>
      {poll.questions.map(question => {
        const results = calculatePollResults(question.options, question.votes, zero.userID ?? '');
        return (
          <fieldset key={question.id} className='space-y-2'>
            <legend className='mb-2 font-semibold text-foreground'>{question.question}</legend>
            {question.options.map(option => {
              const result = results.options.find(item => item.optionId === option.id)!;
              const selected = results.currentSelections.includes(option.id);
              return (
                <button
                  key={option.id}
                  type='button'
                  data-prevent-thread
                  aria-pressed={selected}
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
                    className='absolute inset-y-0 left-0 bg-primary/10'
                    style={{ width: `${result.percentage}%` }}
                  />
                  <span className='relative flex h-5 w-5 shrink-0 items-center justify-center rounded border border-primary'>
                    {selected && <Check className='h-3.5 w-3.5' />}
                  </span>
                  <span className='relative flex-1 text-sm'>{option.text}</span>
                  <span className='relative text-xs text-muted-foreground'>
                    {result.count} · {result.percentage}%
                  </span>
                </button>
              );
            })}
            <p className='text-xs text-muted-foreground'>
              {results.voterCount} {results.voterCount === 1 ? 'voter' : 'voters'}
            </p>
            {poll.allowAudienceChoices && question.options.length < POLL_LIMITS.maxOptions && (
              <div className='flex gap-2' data-prevent-thread>
                <input
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
                  className='min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-sm'
                />
                <button
                  type='button'
                  aria-label='Add choice'
                  data-track-category='POLL'
                  data-track-name='ADD_AUDIENCE_CHOICE'
                  className='rounded-md border border-border p-2 hover:bg-accent'
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
                </button>
              </div>
            )}
          </fieldset>
        );
      })}
    </section>
  );
}
