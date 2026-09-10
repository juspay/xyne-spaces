import { ReactElement, useEffect } from 'react';
import { BarchartDefault, CheckTickSingle, Spinner } from '@xyne/icons';
import { cn } from '@/utils/classNames';
import {
  QUICK_DAYS,
  useDigitalTwinRange,
  type DigitalTwinRange,
} from '@/components/ClawAgents/digitalTwin/useDigitalTwinRange';
import { DateRangeInputs } from './DateRangeInputs';

export type { DigitalTwinRange } from '@/components/ClawAgents/digitalTwin/useDigitalTwinRange';

export const DigitalTwinRangeSelector = ({
  mode,
  active,
  onRangeChange,
}: {
  mode: 'enable' | 'backfill';
  active: boolean;
  onRangeChange: (range: DigitalTwinRange) => void;
}): ReactElement => {
  const r = useDigitalTwinRange(mode, active);

  useEffect(() => {
    onRangeChange(r.range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.range]);

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex flex-col gap-1.5'>
        <p className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
          How far back to look
        </p>
        <div className='flex flex-col gap-1.5'>
          {r.presets.map((preset, i) => {
            const isSelected = r.selection === 'preset' && r.presetIdx === i;
            return (
              <button
                key={preset.label}
                type='button'
                onClick={() => r.selectPreset(i)}
                data-track-category='Claw Agents'
                data-track-name='Digital Twin backfill preset'
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition',
                  isSelected
                    ? 'border-primary bg-primary/5'
                    : 'border-border bg-card hover:bg-muted',
                )}
              >
                <span
                  className={cn(
                    'flex size-[18px] shrink-0 items-center justify-center rounded-full border-2',
                    isSelected ? 'border-primary' : 'border-border',
                  )}
                >
                  {isSelected && <span className='size-2 rounded-full bg-primary' />}
                </span>
                <span className='flex-1'>
                  <span className='block text-sm font-medium text-foreground'>{preset.label}</span>
                  <span className='block text-xs text-muted-foreground'>{preset.sublabel}</span>
                </span>
                {isSelected && <CheckTickSingle className='size-3.5 shrink-0 text-primary' />}
              </button>
            );
          })}

          <div
            className={cn(
              'rounded-xl border transition',
              r.selection === 'custom' ? 'border-primary bg-primary/5' : 'border-border bg-card',
            )}
          >
            <button
              type='button'
              onClick={r.selectCustom}
              data-track-category='Claw Agents'
              data-track-name='Digital Twin backfill custom range'
              className='flex w-full items-center gap-3 px-3.5 py-3 text-left'
            >
              <span
                className={cn(
                  'flex size-[18px] shrink-0 items-center justify-center rounded-full border-2',
                  r.selection === 'custom' ? 'border-primary' : 'border-border',
                )}
              >
                {r.selection === 'custom' && <span className='size-2 rounded-full bg-primary' />}
              </span>
              <span className='flex-1'>
                <span className='block text-sm font-medium text-foreground'>Custom range</span>
                {r.selection !== 'custom' && (
                  <span className='block text-xs text-muted-foreground'>Pick exact dates</span>
                )}
              </span>
              {r.selection === 'custom' && (
                <CheckTickSingle className='size-3.5 shrink-0 text-primary' />
              )}
            </button>

            {r.selection === 'custom' && (
              <div className='border-t border-primary/20 px-3.5 pb-3 pt-2.5'>
                <DateRangeInputs range={r} trackName='Digital Twin backfill' showDayCount />
                <div className='mt-2 flex flex-wrap gap-1.5'>
                  {QUICK_DAYS.map(n => (
                    <button
                      key={n}
                      type='button'
                      onClick={() => r.applyQuickDays(n)}
                      data-track-category='Claw Agents'
                      data-track-name='Digital Twin backfill quick days'
                      className='rounded-lg border border-border bg-card px-2.5 py-0.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground'
                    >
                      last {n}d
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className='overflow-hidden rounded-xl border border-border bg-muted/40'>
        <div className='flex items-center gap-1.5 border-b border-border px-3.5 py-2'>
          <BarchartDefault className='size-3.5 text-muted-foreground' aria-hidden />
          <span className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
            Estimated scope
          </span>
          {r.estimateLoading && (
            <Spinner className='ml-auto size-3 animate-spin text-muted-foreground' aria-hidden />
          )}
        </div>
        <div className='grid grid-cols-3 divide-x divide-border'>
          {[
            { label: 'Messages', value: r.estimate?.messages },
            { label: 'Calls', value: r.estimate?.calls },
            { label: 'Canvases', value: r.estimate?.canvases },
          ].map(({ label, value }) => (
            <div key={label} className='flex flex-col items-center gap-0.5 px-3 py-2.5'>
              <span className='text-base font-semibold tabular-nums text-foreground'>
                {r.estimate ? (value ?? 0).toLocaleString() : '—'}
              </span>
              <span className='text-xs text-muted-foreground'>{label}</span>
            </div>
          ))}
        </div>
        <div className='truncate border-t border-border px-3.5 py-2 text-xs text-muted-foreground'>
          {r.estimate ? (
            <>
              ~{r.estimate.estCandidates ?? 0} candidate memor
              {(r.estimate.estCandidates ?? 0) === 1 ? 'y' : 'ies'} · ~$
              {(r.estimate.estCostUSD ?? 0).toFixed(2)} LLM cost (charged to org)
            </>
          ) : r.range ? (
            'Estimating scope…'
          ) : (
            'Pick a start and end date to preview the scope.'
          )}
        </div>
      </div>
    </div>
  );
};
