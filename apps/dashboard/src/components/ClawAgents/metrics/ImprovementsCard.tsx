import { ReactElement, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  useApplyImprovement,
  useClawAgentImprovements,
  useDismissImprovement,
} from '@/hooks/useClawMetrics';
import { ClawApiError } from '@/services/claw/clawRequest';
import type { ImprovementBucket, ImprovementCandidate } from '@/services/claw/clawMetricsTypes';
import { MetricsCard } from './MetricsCard';

const BUCKET_KEYS: Array<{ key: ImprovementBucket; labelKey: string }> = [
  { key: 'agent_unable_to_do_work', labelKey: 'improvementsCard.bucketAgentUnable' },
  { key: 'failure', labelKey: 'improvementsCard.bucketFailures' },
  { key: 'user_frustrated', labelKey: 'improvementsCard.bucketUserFrustrated' },
];

const ImprovementRow = ({
  item,
  busy,
  onApply,
  onDismiss,
}: {
  item: ImprovementCandidate;
  busy: boolean;
  onApply: () => void;
  onDismiss: () => void;
}): ReactElement => {
  const { t } = useTranslation('common');
  return (
    <div className='flex flex-col gap-2 rounded-lg bg-muted/30 p-3'>
      <div className='flex flex-wrap items-center gap-2 text-xs'>
        <span className='rounded bg-muted px-2 py-0.5 font-mono text-foreground'>
          {item.rootCause}
        </span>
        <span className='rounded bg-muted px-2 py-0.5 text-muted-foreground'>
          {item.confidence}
        </span>
        <span className='text-muted-foreground'>
          {t('improvementsCard.evidenceSessionCount', { count: item.evidence.length })}
        </span>
      </div>
      <p className='text-sm text-foreground'>{item.finding}</p>
      <div className='rounded-md bg-muted px-3 py-2 text-xs'>
        <span className='mr-2 font-mono text-muted-foreground'>{item.proposedFix.type}:</span>
        <span className='whitespace-pre-wrap text-foreground'>{item.proposedFix.description}</span>
      </div>
      <div className='flex flex-wrap gap-1'>
        {item.evidence.slice(0, 8).map(sessionId => (
          <span
            key={sessionId}
            className='rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground'
          >
            {sessionId.slice(0, 14)}
          </span>
        ))}
        {item.evidence.length > 8 && (
          <span className='text-xs text-muted-foreground'>
            {t('improvementsCard.moreCount', { count: item.evidence.length - 8 })}
          </span>
        )}
      </div>
      <div className='flex items-center justify-between gap-3 pt-1'>
        <p className='text-xs italic text-muted-foreground'>
          {t('improvementsCard.manualChangeNotice')}
        </p>
        <div className='flex shrink-0 gap-2'>
          <Button
            type='button'
            variant='outline'
            size='sm'
            disabled={busy}
            onClick={onDismiss}
            data-track-category='Claw Agents'
            data-track-name='DISMISS_IMPROVEMENT'
          >
            {t('improvementsCard.dismissButton')}
          </Button>
          <Button
            type='button'
            size='sm'
            loading={busy}
            disabled={busy}
            onClick={onApply}
            data-track-category='Claw Agents'
            data-track-name='APPLY_IMPROVEMENT'
          >
            {t('improvementsCard.markHandledButton')}
          </Button>
        </div>
      </div>
    </div>
  );
};

export const ImprovementsCard = ({ agentSlug }: { agentSlug: string }): ReactElement | null => {
  const { t } = useTranslation('common');
  const { data: items, isLoading, error } = useClawAgentImprovements(agentSlug);
  const apply = useApplyImprovement(agentSlug);
  const dismiss = useDismissImprovement(agentSlug);
  const [openBucket, setOpenBucket] = useState<ImprovementBucket | null>(null);
  const busyId = apply.isPending
    ? apply.variables
    : dismiss.isPending
      ? dismiss.variables?.id
      : undefined;
  const grouped = useMemo(
    () =>
      new Map(
        BUCKET_KEYS.map(bucket => [
          bucket.key,
          items?.filter(item => item.bucket === bucket.key) ?? [],
        ]),
      ),
    [items],
  );

  if (error instanceof ClawApiError && error.status === 403) return null;

  const handleApply = async (id: string): Promise<void> => {
    try {
      await apply.mutateAsync(id);
      toast.success(t('improvementsCard.toastImprovementHandled'));
    } catch (reason) {
      toast.error(
        reason instanceof Error ? reason.message : t('improvementsCard.toastFailedToUpdate'),
      );
    }
  };
  const handleDismiss = async (id: string): Promise<void> => {
    try {
      await dismiss.mutateAsync({ id });
      toast.success(t('improvementsCard.toastImprovementDismissed'));
    } catch (reason) {
      toast.error(
        reason instanceof Error ? reason.message : t('improvementsCard.toastFailedToDismiss'),
      );
    }
  };

  return (
    <MetricsCard
      title={t('improvementsCard.title')}
      description={t('improvementsCard.description')}
    >
      {isLoading ? (
        <Skeleton className='h-24 w-full' />
      ) : error ? (
        <p className='text-sm text-destructive'>
          {t('improvementsCard.failedToLoad', { message: error.message })}
        </p>
      ) : !items?.length ? (
        <p className='text-sm text-muted-foreground'>
          {t('improvementsCard.noPendingSuggestions')}
        </p>
      ) : (
        <div className='flex flex-col gap-2'>
          {BUCKET_KEYS.map(bucket => {
            const rows = grouped.get(bucket.key) ?? [];
            const open = openBucket === bucket.key;
            return (
              <div key={bucket.key} className='rounded-lg border border-border'>
                <button
                  type='button'
                  onClick={() => setOpenBucket(open ? null : bucket.key)}
                  data-track-category='Claw Agents'
                  data-track-name='Toggle improvement bucket'
                  className='flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-muted/40'
                >
                  {open ? (
                    <ChevronDown className='size-4 text-muted-foreground' />
                  ) : (
                    <ChevronRight className='size-4 text-muted-foreground' />
                  )}
                  <span className='font-medium text-foreground'>{t(bucket.labelKey)}</span>
                  <span className='text-xs text-muted-foreground'>
                    {t('improvementsCard.findingCount', { count: rows.length })}
                  </span>
                </button>
                {open && (
                  <div className='flex flex-col gap-3 border-t border-border p-3'>
                    {rows.length === 0 ? (
                      <p className='text-xs text-muted-foreground'>
                        {t('improvementsCard.nothingPendingInBucket')}
                      </p>
                    ) : (
                      rows.map(item => (
                        <ImprovementRow
                          key={item.id}
                          item={item}
                          busy={busyId === item.id}
                          onApply={() => void handleApply(item.id)}
                          onDismiss={() => void handleDismiss(item.id)}
                        />
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </MetricsCard>
  );
};
