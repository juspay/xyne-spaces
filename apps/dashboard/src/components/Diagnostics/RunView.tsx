import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { CheckCard } from './CheckCard';
import { HotFrameTable } from './HotFrameTable';
import { useRun } from './useRun';
import { CHECK_STATUS_STYLES } from '../../services/diagnostics/thresholds';
import {
  runController,
  DEFAULT_OBSERVE_MS,
  isSelfProfilingSupported,
} from '../../services/diagnostics/run';
import type { CheckResult, CheckStatus, RunReport } from '../../services/diagnostics/run';

/**
 * The run tab: start a scan, watch it, read the verdict.
 *
 * Modelled on a system troubleshooter rather than a monitor. The user is not
 * asked to interpret a wall of live numbers — they press one button, and get
 * named checks that each say what was measured, how sure it is, and what to do.
 */

const DURATIONS = [
  { label: '30 seconds', ms: 30_000 },
  { label: '1 minute', ms: 60_000 },
  { label: '3 minutes', ms: 180_000 },
];

const SECTIONS: { status: CheckStatus; title: string; blurb: string }[] = [
  { status: 'fail', title: 'Problems', blurb: 'These are affecting you now.' },
  { status: 'warn', title: 'Needs attention', blurb: 'Not yet severe, but measurable.' },
  { status: 'pass', title: 'Passed', blurb: 'Measured and found healthy.' },
  {
    status: 'inconclusive',
    title: 'Inconclusive',
    blurb: 'Measured, but not enough to judge.',
  },
  {
    status: 'skipped',
    title: 'Not measured',
    blurb: 'Not available on this device, or nothing happened during the run to measure.',
  },
];

export function RunView(): ReactElement {
  const { progress, report, reports } = useRun();
  const [duration, setDuration] = useState(DEFAULT_OBSERVE_MS);

  const running =
    progress.phase === 'preparing' ||
    progress.phase === 'probing' ||
    progress.phase === 'observing' ||
    progress.phase === 'analysing';

  const start = useCallback(() => {
    void runController.start(duration);
  }, [duration]);

  return (
    <div className='px-5 py-4'>
      {running ? (
        <RunningCard progress={progress} />
      ) : (
        <StartCard
          duration={duration}
          onDuration={setDuration}
          onStart={start}
          hasReport={report !== null}
          error={progress.phase === 'failed' ? progress.error : null}
          cancelled={progress.phase === 'cancelled'}
        />
      )}

      {report ? (
        <>
          {reports.length > 1 ? <ReportPicker reports={reports} current={report} /> : null}
          <ReportView report={report} />
        </>
      ) : null}
    </div>
  );
}

function StartCard({
  duration,
  onDuration,
  onStart,
  hasReport,
  error,
  cancelled,
}: {
  duration: number;
  onDuration: (ms: number) => void;
  onStart: () => void;
  hasReport: boolean;
  error: string | null;
  cancelled: boolean;
}): ReactElement {
  return (
    <div className='rounded-lg border border-border p-4'>
      <h3 className='text-sm font-semibold'>
        {hasReport ? 'Run diagnostics again' : 'Run diagnostics'}
      </h3>
      <p className='mt-1 text-xs leading-relaxed text-neutral-600 dark:text-neutral-300'>
        Measures this device for a fixed period and reports what it finds. Everything is worked out
        on your machine — no data is sent anywhere, and no AI is involved.
      </p>
      <p className='mt-2 text-xs leading-relaxed text-neutral-600 dark:text-neutral-300'>
        <span className='font-medium'>Reproduce the problem while it runs.</span> The run can only
        report on what happens during it, so open the slow screen or send the message that fails.
      </p>
      {/* Said before the wait rather than after it: a user who needs function
          names should know in advance that this browser cannot produce them. */}
      <p className='mt-2 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400'>
        {isSelfProfilingSupported()
          ? 'This browser can attribute main-thread time to specific functions and components.'
          : 'This browser cannot attribute main-thread time to function names. Everything else is still measured; use the desktop app or Chrome for naming.'}
      </p>

      <div className='mt-3 flex flex-wrap items-center gap-2'>
        <div className='flex overflow-hidden rounded-md border border-border' role='group'>
          {DURATIONS.map(option => (
            <button
              key={option.ms}
              type='button'
              onClick={() => onDuration(option.ms)}
              data-track-category='Diagnostics'
              data-track-name='SetRunDuration'
              className={`px-2.5 py-1.5 text-xs ${
                duration === option.ms
                  ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                  : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <button
          type='button'
          onClick={onStart}
          data-track-category='Diagnostics'
          data-track-name='StartRun'
          className='rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300'
        >
          {hasReport ? 'Run again' : 'Start'}
        </button>
      </div>

      {cancelled ? (
        <p className='mt-2.5 text-xs text-neutral-500 dark:text-neutral-400'>
          The last run was stopped before it finished, so it produced no report.
        </p>
      ) : null}
      {error ? (
        <p className='mt-2.5 text-xs text-red-600 dark:text-red-400'>
          The run could not finish: {error}
        </p>
      ) : null}
    </div>
  );
}

function RunningCard({
  progress,
}: {
  progress: ReturnType<typeof useRun>['progress'];
}): ReactElement {
  const percent = Math.round(progress.fraction * 100);
  return (
    <div className='rounded-lg border border-border p-4'>
      <div className='flex items-baseline justify-between gap-3'>
        <h3 className='text-sm font-semibold'>{progress.label}</h3>
        <span className='text-xs tabular-nums text-neutral-500 dark:text-neutral-400'>
          {progress.secondsRemaining !== null
            ? `${progress.secondsRemaining}s left`
            : `${percent}%`}
        </span>
      </div>

      <div
        className='mt-2.5 h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800'
        role='progressbar'
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label='Diagnostic run progress'
      >
        <div
          className='h-full rounded-full bg-neutral-900 transition-[width] duration-300 dark:bg-neutral-100'
          style={{ width: `${percent}%` }}
        />
      </div>

      <p className='mt-2.5 text-xs leading-relaxed text-neutral-600 dark:text-neutral-300'>
        {progress.phase === 'observing'
          ? 'Use the app as you normally would, and reproduce the problem if you can. Only what happens now is measured.'
          : progress.phase === 'probing'
            ? 'Timing this machine so the results can tell a slow app apart from a slow computer.'
            : 'Working.'}
      </p>

      <button
        type='button'
        onClick={() => runController.cancel()}
        data-track-category='Diagnostics'
        data-track-name='CancelRun'
        className='mt-3 rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'
      >
        Stop
      </button>
    </div>
  );
}

function ReportPicker({
  reports,
  current,
}: {
  reports: RunReport[];
  current: RunReport;
}): ReactElement {
  return (
    <div className='mt-4 flex flex-wrap items-center gap-2'>
      <span className='text-[11px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400'>
        Runs
      </span>
      {reports.map(report => (
        <button
          key={report.id}
          type='button'
          onClick={() => runController.selectReport(report.id)}
          data-track-category='Diagnostics'
          data-track-name='SelectRun'
          className={`rounded-md border px-2 py-1 text-[11px] ${
            report.id === current.id
              ? `${CHECK_STATUS_STYLES[report.overall].border} ${CHECK_STATUS_STYLES[report.overall].bg}`
              : 'border-border hover:bg-neutral-100 dark:hover:bg-neutral-800'
          }`}
        >
          <span
            className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle ${CHECK_STATUS_STYLES[report.overall].dot}`}
            aria-hidden='true'
          />
          {new Date(report.startedAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </button>
      ))}
    </div>
  );
}

function ReportView({ report }: { report: RunReport }): ReactElement {
  const grouped = useMemo(() => groupByStatus(report.checks), [report.checks]);
  const style = CHECK_STATUS_STYLES[report.overall];
  const seconds = Math.round(report.window.durationMs / 1000);

  return (
    <div className='mt-4'>
      <div className={`rounded-lg border p-4 ${style.border} ${style.bg}`}>
        <div className='flex items-center gap-2'>
          <span className={`h-2.5 w-2.5 rounded-full ${style.dot}`} aria-hidden='true' />
          <span className={`text-sm font-semibold ${style.text}`}>{style.label}</span>
        </div>
        <p className='mt-1.5 text-sm text-neutral-700 dark:text-neutral-300'>{report.headline}</p>
        <p className='mt-1.5 text-xs text-neutral-500 dark:text-neutral-400'>
          {seconds}s run at {new Date(report.startedAt).toLocaleString()} on {report.route}
          {report.interactedDuringRun
            ? ', while you were using the app'
            : ', while the app was idle'}
          .
        </p>
      </div>

      <HotFrameTable attribution={report.probes.mainThread} />

      {SECTIONS.map(section => {
        const checks = grouped[section.status];
        if (!checks || checks.length === 0) return null;
        return (
          <section key={section.status} className='mt-5'>
            <h3 className='text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400'>
              {section.title} ({checks.length})
            </h3>
            <p className='mt-0.5 text-xs text-neutral-500 dark:text-neutral-400'>{section.blurb}</p>
            <div className='mt-2 space-y-2'>
              {checks.map(check => (
                <CheckCard
                  key={check.id}
                  check={check}
                  // Problems open by default; everything else is there to be
                  // looked up rather than read through.
                  defaultOpen={section.status === 'fail'}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function groupByStatus(checks: CheckResult[]): Partial<Record<CheckStatus, CheckResult[]>> {
  const grouped: Partial<Record<CheckStatus, CheckResult[]>> = {};
  for (const check of checks) {
    const bucket = grouped[check.status] ?? [];
    bucket.push(check);
    grouped[check.status] = bucket;
  }
  return grouped;
}
