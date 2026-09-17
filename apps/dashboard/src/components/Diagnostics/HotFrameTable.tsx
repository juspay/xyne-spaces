import type { ReactElement } from 'react';
import type { HotFrame, MainThreadAttribution } from '../../services/diagnostics/run';

/**
 * Where the main thread went, by function.
 *
 * Self and total are shown side by side deliberately. A row with a large total
 * and a small self did not cost that time itself — something it called did —
 * and a table showing only one number invites the reader to blame the wrong
 * frame.
 */
export function HotFrameTable({
  attribution,
}: {
  attribution: MainThreadAttribution | null;
}): ReactElement | null {
  if (!attribution) return null;

  if (!attribution.supported) {
    return (
      <section className='mt-6'>
        <h3 className='text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400'>
          Where the time went
        </h3>
        <p className='mt-1.5 text-xs leading-relaxed text-neutral-500 dark:text-neutral-400'>
          {attribution.unsupportedReason}
        </p>
      </section>
    );
  }

  // Read defensively. Reports are persisted and a stored one can outlive the
  // shape it was written against; the version gate in `history.ts` is the real
  // guard, but a diagnostics panel that throws while explaining a problem is
  // the worst possible failure, so nothing here assumes a field exists.
  const frames = attribution.frames ?? [];
  const appFrames = attribution.appFrames ?? [];
  const hotPath = attribution.hotPath ?? [];
  if (frames.length === 0) return null;

  const hasAppFrames = appFrames.length > 0;

  return (
    <section className='mt-6'>
      <h3 className='text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400'>
        Where the time went
      </h3>
      <p className='mt-0.5 text-xs text-neutral-500 dark:text-neutral-400'>
        Sampled {attribution.busySamples} times every {attribution.sampleIntervalMs}ms.
        {hasAppFrames
          ? ' Each sample is charged to the deepest function of yours on the stack, so React’s work counts against whichever component caused it.'
          : ' No application frames were identifiable, so these are raw stack leaves.'}
      </p>

      {attribution.devBuild ? (
        <p className='mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300'>
          This is a development build. React does far more work per render here than in the build
          users run, so treat the proportions as indicative and the absolute numbers as too high.
        </p>
      ) : null}

      {hotPath.length > 1 ? (
        <p className='mt-2 overflow-x-auto whitespace-nowrap rounded-md border border-border px-2.5 py-1.5 font-mono text-[11px] text-neutral-600 dark:text-neutral-300'>
          {hotPath
            .map(step =>
              step.collapsed && step.collapsed > 1
                ? `${step.name} +${step.collapsed - 1} framework`
                : step.name,
            )
            .join(' → ')}
        </p>
      ) : null}

      {hasAppFrames ? (
        <FrameTable title='Your code' valueLabel='Charged' frames={appFrames.slice(0, 12)} />
      ) : null}

      <FrameTable
        title={hasAppFrames ? 'All frames, including the framework' : 'All frames'}
        valueLabel='Own time'
        frames={frames.slice(0, 12)}
        muted={hasAppFrames}
      />

      {(attribution.frameworkOnlyMs ?? 0) > 0 && hasAppFrames ? (
        <p className='mt-1.5 text-[11px] text-neutral-500 dark:text-neutral-400'>
          {(attribution.frameworkOnlyMs ?? 0).toFixed(0)} ms could not be charged to any of your
          functions — framework work with nothing of yours beneath it.
        </p>
      ) : null}
    </section>
  );
}

function FrameTable({
  title,
  valueLabel,
  frames,
  muted = false,
}: {
  title: string;
  valueLabel: string;
  frames: HotFrame[];
  muted?: boolean;
}): ReactElement | null {
  if (frames.length === 0) return null;
  return (
    <div className={muted ? 'mt-4 opacity-70' : 'mt-3'}>
      <h4 className='text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400'>
        {title}
      </h4>
      <div className='mt-1 overflow-x-auto'>
        <table className='w-full text-xs'>
          <thead>
            <tr className='text-left text-[11px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400'>
              <th className='py-1 pr-3 font-medium'>Function</th>
              <th className='py-1 pr-3 text-right font-medium'>{valueLabel}</th>
              <th className='py-1 pr-3 text-right font-medium'>With calls</th>
              <th className='py-1 font-medium'>Source</th>
            </tr>
          </thead>
          <tbody>
            {frames.map(frame => (
              <tr key={rowKey(frame)} className='border-t border-border/60'>
                <td className='py-1 pr-3'>
                  <span className='font-medium'>{frame.name}</span>
                  {frame.kind === 'component' || frame.kind === 'hook' ? (
                    <span className='ml-1.5 rounded bg-neutral-100 px-1 py-0.5 text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'>
                      {frame.kind}
                    </span>
                  ) : null}
                  {frame.origin === 'framework' ? (
                    <span className='ml-1.5 text-[10px] text-neutral-400 dark:text-neutral-500'>
                      framework
                    </span>
                  ) : null}
                </td>
                <td className='py-1 pr-3 text-right tabular-nums'>
                  {frame.selfMs.toFixed(0)} ms
                  <span className='ml-1 text-neutral-500 dark:text-neutral-400'>
                    ({frame.selfSharePercent.toFixed(0)}%)
                  </span>
                </td>
                <td className='py-1 pr-3 text-right tabular-nums text-neutral-600 dark:text-neutral-300'>
                  {frame.totalMs.toFixed(0)} ms
                </td>
                <td className='max-w-[14rem] truncate py-1 text-neutral-500 dark:text-neutral-400'>
                  {frame.resource}
                  {frame.line === null ? '' : `:${frame.line}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function rowKey(frame: HotFrame): string {
  return `${frame.name}:${frame.resource}:${frame.line ?? 0}:${frame.column ?? 0}`;
}
