import React from 'react';
import { cn } from '../../../utils/classNames';
import { Loader2 } from 'lucide-react';

interface IngestStatusV2Props {
  status: string | null | undefined;
}

// Small pill badge — dot/icon + label, matching the tag chips on Canvas
// cards (CanvasList.tsx's label pills: rounded-md border, muted background,
// h-5, 11px text) rather than the bare unlabeled icon this used to be.
// FAILED is deliberately absent here — a failed file instead gets the same
// circular badge a failed folder does (see FileFailedBadgeV2), not a text
// pill, so failure reads consistently across both.
const STATUS_CONFIG: Record<string, { label: string; textClassName: string }> = {
  PENDING: { label: 'Pending', textClassName: 'text-muted-foreground' },
  PROCESSING: { label: 'Processing', textClassName: 'text-amber-600 dark:text-amber-400' },
};

export const IngestStatusV2: React.FC<IngestStatusV2Props> = ({ status }) => {
  if (!status || status === 'COMPLETED' || status === 'NONE') {
    return null;
  }

  const normalized = status.toUpperCase();
  const config = STATUS_CONFIG[normalized];
  if (!config) return null;

  return (
    <span
      className={cn(
        'inline-flex h-5 max-w-full shrink-0 items-center gap-1 rounded-md border border-border bg-muted px-1.5 text-[11px] leading-none',
        config.textClassName,
      )}
      title={config.label}
    >
      <Loader2 className='h-2.5 w-2.5 shrink-0 animate-spin' strokeWidth={2} />
      <span className='truncate'>{config.label}</span>
    </span>
  );
};
