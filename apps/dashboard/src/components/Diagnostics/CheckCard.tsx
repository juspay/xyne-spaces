import { useState, type ReactElement } from 'react';
import { CHECK_STATUS_STYLES, CONFIDENCE_LABELS } from '../../services/diagnostics/thresholds';
import type { CheckResult } from '../../services/diagnostics/run';

/**
 * One check, collapsed to its verdict and expandable to its working.
 *
 * The working is always available rather than summarised away. A conclusion the
 * reader cannot check is one they have to take on trust, and the first wrong one
 * costs the trust of every right one after it.
 */
export function CheckCard({
  check,
  defaultOpen = false,
}: {
  check: CheckResult;
  defaultOpen?: boolean;
}): ReactElement {
  const [open, setOpen] = useState(defaultOpen);
  const style = CHECK_STATUS_STYLES[check.status];
  const hasDetail =
    check.measurements.length > 0 || check.evidence.length > 0 || check.remediation !== '';

  return (
    <div className={`rounded-lg border ${style.border} ${style.bg}`}>
      <button
        type='button'
        onClick={() => setOpen(current => !current)}
        disabled={!hasDetail}
        aria-expanded={open}
        data-track-category='Diagnostics'
        data-track-name='ToggleCheck'
        className='flex w-full items-start gap-2.5 px-3 py-2.5 text-left disabled:cursor-default'
      >
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${style.dot}`} aria-hidden='true' />
        <span className='min-w-0 flex-1'>
          <span className='flex flex-wrap items-baseline gap-x-2'>
            <span className='text-sm font-medium'>{check.title}</span>
            <span className={`text-[11px] font-medium ${style.text}`}>{style.label}</span>
            {check.status === 'fail' || check.status === 'warn' ? (
              <span className='text-[11px] text-neutral-500 dark:text-neutral-400'>
                {CONFIDENCE_LABELS[check.confidence]}
              </span>
            ) : null}
          </span>
          <span className='mt-0.5 block text-xs text-neutral-600 dark:text-neutral-300'>
            {check.summary}
          </span>
        </span>
        {hasDetail ? (
          <span
            className='mt-0.5 shrink-0 text-xs text-neutral-400 dark:text-neutral-500'
            aria-hidden='true'
          >
            {open ? '−' : '+'}
          </span>
        ) : null}
      </button>

      {open && hasDetail ? (
        <div className='border-t border-black/5 px-3 py-2.5 dark:border-white/5'>
          {check.measurements.length > 0 ? (
            <dl className='grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2'>
              {check.measurements.map(item => (
                <div key={item.label} className='min-w-0'>
                  <dt className='text-[11px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400'>
                    {item.label}
                  </dt>
                  <dd className='truncate text-xs font-medium tabular-nums' title={item.value}>
                    {item.value}
                    {item.against ? (
                      <span className='ml-1.5 font-normal text-neutral-500 dark:text-neutral-400'>
                        ({item.against})
                      </span>
                    ) : null}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}

          {check.evidence.length > 0 ? (
            <ul className='mt-2.5 space-y-1'>
              {check.evidence.map(line => (
                <li
                  key={line}
                  className='text-xs leading-relaxed text-neutral-600 dark:text-neutral-300'
                >
                  {line}
                </li>
              ))}
            </ul>
          ) : null}

          {check.remediation ? (
            <p className='mt-2.5 text-xs leading-relaxed text-neutral-700 dark:text-neutral-200'>
              <span className='font-medium'>What to do: </span>
              {check.remediation}
            </p>
          ) : null}

          <p className='mt-2.5 text-[11px] text-neutral-500 dark:text-neutral-400'>
            {CONFIDENCE_LABELS[check.confidence]} — {check.confidenceReason}
            {!check.actionable && check.status !== 'pass' && check.status !== 'skipped'
              ? ' This cause is outside the app, so no change to Xyne would fix it.'
              : ''}
          </p>
        </div>
      ) : null}
    </div>
  );
}
