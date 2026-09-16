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

  if (attribution.frames.length === 0) return null;

  return (
    <section className='mt-6'>
      <h3 className='text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400'>
        Where the time went
      </h3>
      <p className='mt-0.5 text-xs text-neutral-500 dark:text-neutral-400'>
        Sampled {attribution.busySamples} times every {attribution.sampleIntervalMs}ms. &ldquo;Own
        time&rdquo; is the thread inside that function&rsquo;s own code; &ldquo;with calls&rdquo;
        includes everything it invoked.
      </p>

      {attribution.hotPath.length > 1 ? (
        <p className='mt-2 overflow-x-auto whitespace-nowrap rounded-md border border-border px-2.5 py-1.5 font-mono text-[11px] text-neutral-600 dark:text-neutral-300'>
          {attribution.hotPath.map(step => step.name).join(' → ')}
        </p>
      ) : null}

      <div className='mt-2 overflow-x-auto'>
        <table className='w-full text-xs'>
          <thead>
            <tr className='text-left text-[11px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400'>
              <th className='py-1 pr-3 font-medium'>Function</th>
              <th className='py-1 pr-3 text-right font-medium'>Own time</th>
              <th className='py-1 pr-3 text-right font-medium'>With calls</th>
              <th className='py-1 font-medium'>Source</th>
            </tr>
          </thead>
          <tbody>
            {attribution.frames.slice(0, 12).map(frame => (
              <tr key={rowKey(frame)} className='border-t border-border/60'>
                <td className='py-1 pr-3'>
                  <span className='font-medium'>{frame.name}</span>
                  {frame.kind === 'component' || frame.kind === 'hook' ? (
                    <span className='ml-1.5 rounded bg-neutral-100 px-1 py-0.5 text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'>
                      {frame.kind}
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
    </section>
  );
}

function rowKey(frame: HotFrame): string {
  return `${frame.name}:${frame.resource}:${frame.line ?? 0}:${frame.column ?? 0}`;
}
