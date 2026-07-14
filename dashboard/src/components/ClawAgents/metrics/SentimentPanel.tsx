import { ReactElement } from 'react';
import { cn } from '@/utils/classNames';
import type { AgentSentiment } from '@/services/claw/clawMetricsTypes';

const MiniTile = ({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}): ReactElement => (
  <div className='rounded-lg bg-muted/40 px-3 py-2'>
    <p className='text-[10px] font-medium uppercase tracking-wide text-muted-foreground'>{label}</p>
    <p className='mt-0.5 text-lg font-semibold tabular-nums text-foreground'>{value}</p>
    <p className='mt-0.5 text-[10px] text-muted-foreground'>{detail}</p>
  </div>
);

export const SentimentPanel = ({ sentiment }: { sentiment: AgentSentiment }): ReactElement => {
  const concerns: string[] = [];
  if (sentiment.ratingRatio !== null && sentiment.ratingRatio < 0.5)
    concerns.push('ratings are mostly negative');
  if (sentiment.apologeticRate > 0.2) concerns.push('apologetic replies are elevated');
  if (sentiment.failedRate > 0.1) concerns.push('failed runs are elevated');
  if (sentiment.cancelledRate > 0.1) concerns.push('cancelled runs are elevated');
  if (sentiment.retriedRate > 0.2) concerns.push('LLM retries are elevated');
  const severe = concerns.length >= 3;

  return (
    <div className='flex flex-col gap-4'>
      <div
        className={cn(
          'rounded-lg border px-4 py-3 text-sm',
          concerns.length === 0 &&
            'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
          concerns.length > 0 &&
            !severe &&
            'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
          severe && 'border-destructive/30 bg-destructive/10 text-destructive',
        )}
      >
        {concerns.length === 0
          ? `Sentiment looks healthy across ${sentiment.totalRuns} runs.`
          : `${concerns.length} concern${concerns.length === 1 ? '' : 's'}: ${concerns.join(' · ')}`}
      </div>

      <div className='grid grid-cols-2 gap-3 lg:grid-cols-5'>
        <MiniTile
          label='Ratings 👍'
          value={String(sentiment.ratingUp)}
          detail={
            sentiment.ratingTotal
              ? `${((sentiment.ratingUp / sentiment.ratingTotal) * 100).toFixed(0)}% of rated`
              : 'No ratings'
          }
        />
        <MiniTile
          label='Ratings 👎'
          value={String(sentiment.ratingDown)}
          detail={
            sentiment.ratingTotal
              ? `${((sentiment.ratingDown / sentiment.ratingTotal) * 100).toFixed(0)}% of rated`
              : 'No ratings'
          }
        />
        <MiniTile
          label='Apologetic'
          value={`${(sentiment.apologeticRate * 100).toFixed(1)}%`}
          detail='of completed runs'
        />
        <MiniTile
          label='Cancelled'
          value={`${(sentiment.cancelledRate * 100).toFixed(1)}%`}
          detail='of all runs'
        />
        <MiniTile
          label='Retried'
          value={`${(sentiment.retriedRate * 100).toFixed(1)}%`}
          detail='LLM retries'
        />
      </div>

      {sentiment.recentComments.length > 0 && (
        <div className='flex flex-col gap-2'>
          <p className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>
            Recent comments
          </p>
          {sentiment.recentComments.map(comment => (
            <div key={comment.sessionId} className='flex gap-3 rounded-lg bg-muted/30 p-3'>
              <span aria-label={comment.rating === 'up' ? 'Thumbs up' : 'Thumbs down'}>
                {comment.rating === 'up' ? '👍' : '👎'}
              </span>
              <div className='min-w-0 flex-1'>
                <p className='whitespace-pre-wrap break-words text-sm text-foreground'>
                  {comment.comment}
                </p>
                <p className='mt-1 font-mono text-xs text-muted-foreground'>
                  {comment.sessionId.slice(0, 16)} ·{' '}
                  {new Date(comment.completedAt).toLocaleString()}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
