import { ReactElement } from 'react';
import { sourceLabel, subsystemLabel } from '@/components/ClawAgents/digitalTwin/subsystems';
import type { DigitalTwinMetrics } from '@/services/claw/digitalTwinTypes';

const OutcomeBar = ({
  approved,
  rejected,
  pending,
}: {
  approved: number;
  rejected: number;
  pending: number;
}): ReactElement => {
  const total = Math.max(1, approved + rejected + pending);
  return (
    <div
      className='flex h-3 min-w-48 overflow-hidden rounded-full bg-[var(--dt-rule)]'
      role='img'
      aria-label={`${approved} approved, ${rejected} rejected, ${pending} pending`}
    >
      {approved > 0 && (
        <span
          key={`approved-${approved}`}
          className='dt-result-bar-segment h-full bg-[var(--dt-sage)]'
          style={{ width: `${(approved / total) * 100}%` }}
        />
      )}
      {rejected > 0 && (
        <span
          key={`rejected-${rejected}`}
          className='dt-result-bar-segment h-full bg-[var(--dt-danger)]'
          style={{ width: `${(rejected / total) * 100}%` }}
        />
      )}
      {pending > 0 && (
        <span
          key={`pending-${pending}`}
          className='dt-result-bar-segment h-full bg-[var(--dt-amber)]'
          style={{ width: `${(pending / total) * 100}%` }}
        />
      )}
    </div>
  );
};

export const DigitalTwinMetricsCharts = ({ data }: { data: DigitalTwinMetrics }): ReactElement => (
  <div className='flex flex-col gap-10'>
    <section aria-labelledby='candidate-outcomes-heading'>
      <div className='border-b-2 border-[var(--dt-ink)] pb-3'>
        <h3
          id='candidate-outcomes-heading'
          className='dt-display text-xl font-semibold text-[var(--dt-ink)]'
        >
          Candidate outcomes
        </h3>
        <p className='dt-muted mt-1 text-sm'>
          {data.total.toLocaleString()} total · {data.addedSinceYesterday.toLocaleString()} added
          since yesterday
        </p>
      </div>
      <div className='overflow-x-auto'>
        <table className='w-full min-w-[680px] border-collapse text-left'>
          <caption className='sr-only'>Candidate outcome totals</caption>
          <thead>
            <tr className='dt-paper-raised text-sm text-[var(--dt-muted)]'>
              <th scope='col' className='px-4 py-3 font-semibold'>
                Outcome
              </th>
              <th scope='col' className='px-4 py-3 text-right font-semibold'>
                Count
              </th>
              <th scope='col' className='px-4 py-3 font-semibold'>
                Meaning
              </th>
            </tr>
          </thead>
          <tbody>
            {[
              ['Approved unchanged', data.approvedClean, 'Saved exactly as proposed'],
              ['Approved after editing', data.approvedEdited, 'Corrected before becoming memory'],
              ['Rejected', data.rejected, 'Kept out of the memory ledger'],
              ['Pending', data.pending, 'Still waiting for a decision'],
            ].map(([label, value, meaning]) => (
              <tr key={String(label)} className='border-t dt-rule'>
                <th scope='row' className='px-4 py-4 font-semibold text-[var(--dt-ink)]'>
                  {String(label)}
                </th>
                <td className='px-4 py-4 text-right font-semibold tabular-nums text-[var(--dt-ink)]'>
                  {Number(value).toLocaleString()}
                </td>
                <td className='dt-muted px-4 py-4 text-sm'>{String(meaning)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>

    <section aria-labelledby='subsystem-outcomes-heading'>
      <div className='border-b-2 border-[var(--dt-ink)] pb-3'>
        <h3
          id='subsystem-outcomes-heading'
          className='dt-display text-xl font-semibold text-[var(--dt-ink)]'
        >
          Outcomes by knowledge area
        </h3>
        <div className='dt-muted mt-2 flex flex-wrap gap-4 text-sm' aria-hidden='true'>
          <span className='inline-flex items-center gap-2'>
            <span className='size-2.5 rounded-full bg-[var(--dt-sage)]' /> Approved
          </span>
          <span className='inline-flex items-center gap-2'>
            <span className='size-2.5 rounded-full bg-[var(--dt-danger)]' /> Rejected
          </span>
          <span className='inline-flex items-center gap-2'>
            <span className='size-2.5 rounded-full bg-[var(--dt-amber)]' /> Pending
          </span>
        </div>
      </div>
      {data.bySubsystem.length === 0 ? (
        <p className='dt-muted py-8 text-sm'>No knowledge-area data for this period.</p>
      ) : (
        <div className='overflow-x-auto'>
          <table className='w-full min-w-[760px] border-collapse text-left'>
            <caption className='sr-only'>Approval outcomes by Digital Twin knowledge area</caption>
            <thead>
              <tr className='dt-paper-raised text-sm text-[var(--dt-muted)]'>
                <th scope='col' className='px-4 py-3 font-semibold'>
                  Knowledge area
                </th>
                <th scope='col' className='px-4 py-3 font-semibold'>
                  Distribution
                </th>
                <th scope='col' className='px-4 py-3 text-right font-semibold'>
                  Approved
                </th>
                <th scope='col' className='px-4 py-3 text-right font-semibold'>
                  Rejected
                </th>
                <th scope='col' className='px-4 py-3 text-right font-semibold'>
                  Pending
                </th>
              </tr>
            </thead>
            <tbody>
              {data.bySubsystem.map(row => (
                <tr key={row.subsystem} className='border-t dt-rule'>
                  <th scope='row' className='px-4 py-4 font-semibold text-[var(--dt-ink)]'>
                    {subsystemLabel(row.subsystem)}
                  </th>
                  <td className='px-4 py-4'>
                    <OutcomeBar
                      approved={row.approved}
                      rejected={row.rejected}
                      pending={row.pending}
                    />
                  </td>
                  <td className='px-4 py-4 text-right tabular-nums text-[var(--dt-ink)]'>
                    {row.approved.toLocaleString()}
                  </td>
                  <td className='px-4 py-4 text-right tabular-nums text-[var(--dt-ink)]'>
                    {row.rejected.toLocaleString()}
                  </td>
                  <td className='px-4 py-4 text-right tabular-nums text-[var(--dt-ink)]'>
                    {row.pending.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>

    <section aria-labelledby='source-outcomes-heading'>
      <div className='border-b-2 border-[var(--dt-ink)] pb-3'>
        <h3
          id='source-outcomes-heading'
          className='dt-display text-xl font-semibold text-[var(--dt-ink)]'
        >
          Trust by intake source
        </h3>
        <p className='dt-muted mt-1 text-sm'>
          Compare what you kept and rejected from each learning path.
        </p>
      </div>
      {data.bySource.length === 0 ? (
        <p className='dt-muted py-8 text-sm'>No source data for this period.</p>
      ) : (
        <div className='overflow-x-auto'>
          <table className='w-full min-w-[620px] border-collapse text-left'>
            <caption className='sr-only'>Approved and rejected candidates by source</caption>
            <thead>
              <tr className='dt-paper-raised text-sm text-[var(--dt-muted)]'>
                <th scope='col' className='px-4 py-3 font-semibold'>
                  Source
                </th>
                <th scope='col' className='px-4 py-3 font-semibold'>
                  Distribution
                </th>
                <th scope='col' className='px-4 py-3 text-right font-semibold'>
                  Approved
                </th>
                <th scope='col' className='px-4 py-3 text-right font-semibold'>
                  Rejected
                </th>
              </tr>
            </thead>
            <tbody>
              {data.bySource.map(row => (
                <tr key={row.source} className='border-t dt-rule'>
                  <th scope='row' className='px-4 py-4 font-semibold text-[var(--dt-ink)]'>
                    {sourceLabel(row.source)}
                  </th>
                  <td className='px-4 py-4'>
                    <OutcomeBar approved={row.approved} rejected={row.rejected} pending={0} />
                  </td>
                  <td className='px-4 py-4 text-right tabular-nums text-[var(--dt-ink)]'>
                    {row.approved.toLocaleString()}
                  </td>
                  <td className='px-4 py-4 text-right tabular-nums text-[var(--dt-ink)]'>
                    {row.rejected.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  </div>
);
