import { ReactElement } from 'react';
import { formatPct } from '@/components/ClawAgents/metrics/formatters';
import type { DigitalTwinMetrics } from '@/services/claw/digitalTwinTypes';

const deltaLabel = (current: number | null, previous: number | null): string => {
  if (current === null || previous === null) return 'No previous-period comparison';
  const difference = (current - previous) * 100;
  if (Math.abs(difference) < 0.05) return 'Unchanged from the previous period';
  return `${difference > 0 ? '+' : ''}${difference.toFixed(1)} percentage points`;
};

export const DigitalTwinKpis = ({ data }: { data: DigitalTwinMetrics }): ReactElement => (
  <section aria-labelledby='review-quality-heading'>
    <div className='border-b-2 border-[var(--dt-ink)] pb-3'>
      <h3
        id='review-quality-heading'
        className='dt-display text-xl font-semibold text-[var(--dt-ink)]'
      >
        Review quality
      </h3>
      <p className='dt-muted mt-1 text-sm'>
        Exact outcomes and how they compare with the preceding period.
      </p>
    </div>

    <dl>
      <div className='grid gap-2 border-b dt-rule py-5 sm:grid-cols-[220px_130px_minmax(0,1fr)] sm:items-baseline'>
        <dt className='font-semibold text-[var(--dt-ink)]'>Approval rate</dt>
        <dd className='dt-display text-2xl font-semibold tabular-nums text-[var(--dt-ink)]'>
          {formatPct(data.approvalRate)}
        </dd>
        <dd className='dt-muted text-sm'>
          {deltaLabel(data.approvalRate, data.previousApprovalRate)}
        </dd>
      </div>
      <div className='grid gap-2 border-b dt-rule py-5 sm:grid-cols-[220px_130px_minmax(0,1fr)] sm:items-baseline'>
        <dt className='font-semibold text-[var(--dt-ink)]'>Edit rate</dt>
        <dd className='dt-display text-2xl font-semibold tabular-nums text-[var(--dt-ink)]'>
          {formatPct(data.editRate)}
        </dd>
        <dd className='dt-muted text-sm'>{deltaLabel(data.editRate, data.previousEditRate)}</dd>
      </div>
      <div className='grid gap-2 border-b dt-rule py-5 sm:grid-cols-[220px_130px_minmax(0,1fr)] sm:items-baseline'>
        <dt className='font-semibold text-[var(--dt-ink)]'>Waiting for review</dt>
        <dd className='dt-display text-2xl font-semibold tabular-nums text-[var(--dt-ink)]'>
          {data.pending.toLocaleString()}
        </dd>
        <dd className='dt-muted text-sm'>
          {data.oldestPendingDays !== null
            ? `Oldest proposal has waited ${data.oldestPendingDays} day${data.oldestPendingDays === 1 ? '' : 's'}`
            : 'No pending proposals'}
        </dd>
      </div>
      {data.recallRatedCount > 0 && (
        <div className='grid gap-2 border-b dt-rule py-5 sm:grid-cols-[220px_130px_minmax(0,1fr)] sm:items-baseline'>
          <dt className='font-semibold text-[var(--dt-ink)]'>Rated recall precision</dt>
          <dd className='dt-display text-2xl font-semibold tabular-nums text-[var(--dt-ink)]'>
            {formatPct(data.recallPrecision)}
          </dd>
          <dd className='dt-muted text-sm'>
            Based on {data.recallRatedCount.toLocaleString()} rated recall
            {data.recallRatedCount === 1 ? '' : 's'}
          </dd>
        </div>
      )}
    </dl>
  </section>
);
