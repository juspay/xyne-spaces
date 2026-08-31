import { ReactElement } from 'react';
import { cn } from '@/utils/classNames';
import { formatPct } from '@/components/ClawAgents/metrics/formatters';
import type { DigitalTwinMetrics } from '@/services/claw/digitalTwinTypes';

type Tone = 'good' | 'bad' | 'flat';

const toneClass = (tone: Tone): string => {
  if (tone === 'good') return 'text-status-success';
  if (tone === 'bad') return 'text-destructive';
  return 'text-muted-foreground';
};

const deltaBadge = (
  current: number | null,
  previous: number | null,
  higherIsBetter: boolean,
): { label: string; tone: Tone } => {
  if (current === null || previous === null || Number.isNaN(current) || Number.isNaN(previous)) {
    return { label: '—', tone: 'flat' };
  }
  const diff = current - previous;
  if (Math.abs(diff) < 0.001) return { label: '≈0', tone: 'flat' };
  const up = diff > 0;
  return {
    label: `${up ? '+' : ''}${(diff * 100).toFixed(1)}pp`,
    tone: up === higherIsBetter ? 'good' : 'bad',
  };
};

const Hero = ({
  label,
  value,
  help,
  delta,
}: {
  label: string;
  value: string;
  help: string;
  delta: { label: string; tone: Tone };
}): ReactElement => (
  <div className='rounded-xl border border-border bg-card px-5 py-4 shadow-sm'>
    <p className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>{label}</p>
    <div className='mt-1 flex items-baseline gap-3'>
      <span className='text-3xl font-semibold tabular-nums text-foreground'>{value}</span>
      <span className={cn('text-xs font-medium', toneClass(delta.tone))}>{delta.label}</span>
    </div>
    <p className='mt-1 text-xs text-muted-foreground'>{help}</p>
  </div>
);

const Tile = ({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}): ReactElement => (
  <div className='rounded-xl border border-border bg-card px-4 py-3 shadow-sm'>
    <p className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>{label}</p>
    <p className='mt-1 text-xl font-semibold tabular-nums text-foreground'>{value}</p>
    {detail && <p className='mt-0.5 text-xs text-muted-foreground'>{detail}</p>}
  </div>
);

export const DigitalTwinKpis = ({ data }: { data: DigitalTwinMetrics }): ReactElement => {
  const approvalDelta = deltaBadge(data.approvalRate, data.previousApprovalRate, true);
  const editDelta = deltaBadge(data.editRate, data.previousEditRate, false);

  return (
    <div className='flex flex-col gap-3'>
      <div className='grid gap-3 md:grid-cols-2'>
        <Hero
          label='Approval rate'
          value={formatPct(data.approvalRate)}
          delta={approvalDelta}
          help='Share of reviewed candidates you approved.'
        />
        <Hero
          label='Edit rate'
          value={formatPct(data.editRate)}
          delta={editDelta}
          help='Share of approvals you tweaked before saving.'
        />
      </div>

      <div className='grid grid-cols-2 gap-3 lg:grid-cols-4'>
        <Tile
          label='Total candidates'
          value={String(data.total)}
          detail={`+${data.addedSinceYesterday} since yesterday`}
        />
        <Tile
          label='Approved'
          value={String(data.totalApproved)}
          detail={`${data.approvedClean} clean · ${data.approvedEdited} edited`}
        />
        <Tile label='Rejected' value={String(data.rejected)} />
        <Tile
          label='Pending'
          value={String(data.pending)}
          detail={
            data.oldestPendingDays !== null ? `oldest ${data.oldestPendingDays}d in queue` : ''
          }
        />
        {data.recallRatedCount > 0 && (
          <Tile
            label='Recall precision'
            value={formatPct(data.recallPrecision)}
            detail={`${data.recallRatedCount} rated`}
          />
        )}
      </div>
    </div>
  );
};
