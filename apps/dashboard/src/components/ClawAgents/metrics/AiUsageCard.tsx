import { ReactElement } from 'react';
import { useOrgAiUsage, type AiBudgetUsage } from '@/hooks/useOrgAiUsage';

const formatUsd = (amount: number): string => `$${amount.toFixed(2)}`;

const formatReset = (iso: string | null): string | null =>
  iso ? `resets ${new Date(iso).toLocaleDateString()}` : null;

const UsageRow = ({
  label,
  usage,
}: {
  label: string;
  usage: AiBudgetUsage | null;
}): ReactElement => {
  const resetText = usage ? formatReset(usage.budgetResetAt) : null;
  const percentUsed =
    usage && usage.maxBudget ? Math.min((usage.spend / usage.maxBudget) * 100, 100) : 0;

  return (
    <div className='min-w-0 flex-1'>
      <div className='flex flex-wrap items-baseline justify-between gap-x-3 text-sm'>
        <span className='text-muted-foreground'>{label}</span>
        {!usage ? (
          <span className='text-muted-foreground'>Unavailable</span>
        ) : usage.remaining === null || usage.maxBudget === null ? (
          <span className='font-medium text-foreground'>{formatUsd(usage.spend)} used</span>
        ) : (
          <span className='font-medium text-foreground'>
            {formatUsd(usage.remaining)} left of {formatUsd(usage.maxBudget)}
          </span>
        )}
      </div>
      {usage && usage.maxBudget !== null && (
        <div className='mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted'>
          <div className='h-full rounded-full bg-primary' style={{ width: `${percentUsed}%` }} />
        </div>
      )}
      {usage && (
        <p className='mt-1 text-xs text-muted-foreground'>
          {usage.maxBudget === null ? 'No limit' : `${formatUsd(usage.spend)} used`}
          {resetText ? ` · ${resetText}` : ''}
        </p>
      )}
    </div>
  );
};

export const AiUsageCard = ({
  orgId,
  showOrg,
}: {
  orgId: string;
  showOrg: boolean;
}): ReactElement | null => {
  const { data } = useOrgAiUsage(orgId);
  if (!data) return null;

  return (
    <div className='mb-5 rounded-lg border border-border bg-card px-4 py-3'>
      <p className='mb-2 text-sm font-medium text-foreground'>AI credit usage</p>
      {data.provisioned ? (
        <div className='flex flex-col gap-4 sm:flex-row sm:gap-8'>
          {showOrg && <UsageRow label='Organisation' usage={data.org} />}
          <UsageRow label='You' usage={data.user} />
        </div>
      ) : (
        <p className='text-sm text-muted-foreground'>
          AI credits aren&apos;t set up for this organisation yet.
        </p>
      )}
    </div>
  );
};
