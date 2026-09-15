import type { ReactElement } from 'react';
import { cn } from '@/utils/classNames';
import type { DelegationStatus } from '@/services/claw/clawDelegationTypes';

const TONE: Record<DelegationStatus | 'missing', string> = {
  approved: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  pending: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  rejected: 'bg-destructive/10 text-destructive',
  missing: 'bg-muted text-muted-foreground',
};

export function DelegationStatusBadge({
  status,
  ownerName,
}: {
  status: DelegationStatus | 'missing';
  ownerName?: string | null;
}): ReactElement {
  const label =
    status === 'approved'
      ? 'Approved'
      : status === 'pending'
        ? ownerName
          ? `Waiting on ${ownerName}`
          : 'Awaiting approval'
        : status === 'rejected'
          ? 'Declined'
          : 'No grant';

  return (
    <span
      className={cn(
        'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4',
        TONE[status],
      )}
      title={status === 'missing' ? 'Listed in config but no delegation grant exists' : undefined}
    >
      {label}
    </span>
  );
}
