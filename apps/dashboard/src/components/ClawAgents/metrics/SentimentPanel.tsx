import { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('common');
  const concerns: string[] = [];
  if (sentiment.ratingRatio !== null && sentiment.ratingRatio < 0.5)
    concerns.push(t('sentimentPanel.concernRatingsNegative'));
  if (sentiment.apologeticRate > 0.2) concerns.push(t('sentimentPanel.concernApologeticElevated'));
  if (sentiment.failedRate > 0.1) concerns.push(t('sentimentPanel.concernFailedElevated'));
  if (sentiment.cancelledRate > 0.1) concerns.push(t('sentimentPanel.concernCancelledElevated'));
  if (sentiment.retriedRate > 0.2) concerns.push(t('sentimentPanel.concernRetriesElevated'));
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
          ? t('sentimentPanel.healthyBanner', { count: sentiment.totalRuns })
          : t('sentimentPanel.concernsBanner', {
              count: concerns.length,
              list: concerns.join(' · '),
            })}
      </div>

      <div className='grid grid-cols-2 gap-3 lg:grid-cols-5'>
        <MiniTile
          label={t('sentimentPanel.ratingsUpLabel')}
          value={String(sentiment.ratingUp)}
          detail={
            sentiment.ratingTotal
              ? t('sentimentPanel.percentOfRated', {
                  pct: ((sentiment.ratingUp / sentiment.ratingTotal) * 100).toFixed(0),
                })
              : t('sentimentPanel.noRatings')
          }
        />
        <MiniTile
          label={t('sentimentPanel.ratingsDownLabel')}
          value={String(sentiment.ratingDown)}
          detail={
            sentiment.ratingTotal
              ? t('sentimentPanel.percentOfRated', {
                  pct: ((sentiment.ratingDown / sentiment.ratingTotal) * 100).toFixed(0),
                })
              : t('sentimentPanel.noRatings')
          }
        />
        <MiniTile
          label={t('sentimentPanel.apologeticLabel')}
          value={`${(sentiment.apologeticRate * 100).toFixed(1)}%`}
          detail={t('sentimentPanel.ofCompletedRuns')}
        />
        <MiniTile
          label={t('sentimentPanel.cancelledLabel')}
          value={`${(sentiment.cancelledRate * 100).toFixed(1)}%`}
          detail={t('sentimentPanel.ofAllRuns')}
        />
        <MiniTile
          label={t('sentimentPanel.retriedLabel')}
          value={`${(sentiment.retriedRate * 100).toFixed(1)}%`}
          detail={t('sentimentPanel.llmRetries')}
        />
      </div>

      {sentiment.recentComments.length > 0 && (
        <div className='flex flex-col gap-2'>
          <p className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>
            {t('sentimentPanel.recentCommentsLabel')}
          </p>
          {sentiment.recentComments.map(comment => (
            <div key={comment.sessionId} className='flex gap-3 rounded-lg bg-muted/30 p-3'>
              <span
                aria-label={
                  comment.rating === 'up'
                    ? t('sentimentPanel.thumbsUpAriaLabel')
                    : t('sentimentPanel.thumbsDownAriaLabel')
                }
              >
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
