import { ReactElement, useEffect } from 'react';
import { Check, Loader2 } from './icons';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  isoDate,
  QUICK_DAYS,
  useDigitalTwinRange,
  type DigitalTwinRange,
} from './useDigitalTwinRange';

export type { DigitalTwinRange } from './useDigitalTwinRange';

export const DigitalTwinRangeSelector = ({
  mode,
  active,
  onRangeChange,
}: {
  mode: 'enable' | 'backfill';
  active: boolean;
  onRangeChange: (range: DigitalTwinRange) => void;
}): ReactElement => {
  const range = useDigitalTwinRange(mode, active);

  useEffect(() => {
    onRangeChange(range.range);
    // The parent passes a stable state setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.range]);

  return (
    <div className='flex flex-col gap-5'>
      <fieldset>
        <legend className='mb-2 text-xs font-medium text-foreground'>How far back to look</legend>
        <div className='grid gap-2'>
          {range.presets.map((preset, index) => {
            const selected = range.selection === 'preset' && range.presetIdx === index;
            return (
              <button
                key={preset.label}
                type='button'
                onClick={() => range.selectPreset(index)}
                aria-pressed={selected}
                className={
                  selected
                    ? 'flex min-h-16 items-center gap-3 rounded-lg border border-primary bg-primary/5 px-4 py-3 text-left'
                    : 'flex min-h-16 items-center gap-3 rounded-lg border border-border bg-background px-4 py-3 text-left transition-colors hover:bg-accent'
                }
                data-track-category='Claw Agents'
                data-track-name='Digital Twin backfill preset'
              >
                <span
                  className={
                    selected
                      ? 'flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground'
                      : 'flex size-5 shrink-0 items-center justify-center rounded-full border border-border'
                  }
                >
                  {selected && <Check className='size-4' />}
                </span>
                <span>
                  <span className='block text-sm font-medium text-foreground'>{preset.label}</span>
                  <span className='mt-0.5 block text-xs text-muted-foreground'>
                    {preset.sublabel}
                  </span>
                </span>
              </button>
            );
          })}
          <button
            type='button'
            onClick={range.selectCustom}
            data-track-category='Claw Agents'
            data-track-name='Digital Twin backfill custom range'
            aria-pressed={range.selection === 'custom'}
            className={
              range.selection === 'custom'
                ? 'flex min-h-16 items-center gap-3 rounded-lg border border-primary bg-primary/5 px-4 py-3 text-left'
                : 'flex min-h-16 items-center gap-3 rounded-lg border border-border bg-background px-4 py-3 text-left transition-colors hover:bg-accent'
            }
          >
            <span
              className={
                range.selection === 'custom'
                  ? 'flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground'
                  : 'flex size-5 shrink-0 items-center justify-center rounded-full border border-border'
              }
            >
              {range.selection === 'custom' && <Check className='size-4' />}
            </span>
            <span>
              <span className='block text-sm font-medium text-foreground'>Custom range</span>
              <span className='mt-0.5 block text-xs text-muted-foreground'>Choose exact dates</span>
            </span>
          </button>
        </div>
      </fieldset>

      {range.selection === 'custom' && (
        <div>
          <div className='grid gap-3 sm:grid-cols-2'>
            <label htmlFor='digital-twin-backfill-from'>
              <span className='mb-1.5 block text-xs font-medium text-foreground'>From</span>
              <Input
                id='digital-twin-backfill-from'
                type='date'
                value={range.customFrom}
                max={range.customTo}
                onChange={event => range.setCustomFrom(event.target.value)}
                data-track-category='Claw Agents'
                data-track-name='Digital Twin backfill custom start date'
              />
            </label>
            <label htmlFor='digital-twin-backfill-to'>
              <span className='mb-1.5 block text-xs font-medium text-foreground'>To</span>
              <Input
                id='digital-twin-backfill-to'
                type='date'
                value={range.customTo}
                min={range.customFrom}
                max={isoDate(new Date())}
                onChange={event => range.setCustomTo(event.target.value)}
                data-track-category='Claw Agents'
                data-track-name='Digital Twin backfill custom end date'
              />
            </label>
          </div>
          <div className='mt-3 flex flex-wrap gap-2'>
            {QUICK_DAYS.map(days => (
              <Button
                key={days}
                variant='outline'
                size='sm'
                onClick={() => range.applyQuickDays(days)}
                data-track-category='Claw Agents'
                data-track-name='Digital Twin backfill quick date range'
              >
                Last {days} days
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className='rounded-lg border border-border bg-muted/20 p-3' aria-live='polite'>
        {range.estimateLoading ? (
          <p className='flex items-center gap-2 text-sm text-muted-foreground'>
            <Loader2 className='size-4 animate-spin' />
            Estimating scope…
          </p>
        ) : range.estimate ? (
          <>
            <dl className='grid grid-cols-3 divide-x divide-border'>
              {[
                ['Messages', range.estimate.messages],
                ['Calls', range.estimate.calls],
                ['Canvases', range.estimate.canvases],
              ].map(([label, value]) => (
                <div key={String(label)} className='px-3 py-1'>
                  <dt className='text-xs text-muted-foreground'>{String(label)}</dt>
                  <dd className='mt-1 text-base font-semibold tabular-nums text-foreground'>
                    {Number(value).toLocaleString()}
                  </dd>
                </div>
              ))}
            </dl>
            <p className='mt-3 text-xs leading-5 text-muted-foreground'>
              About {range.estimate.estCandidates.toLocaleString()} candidate memories · estimated $
              {range.estimate.estCostUSD.toFixed(2)} LLM cost charged to your organization.
            </p>
          </>
        ) : (
          <p className='text-sm text-muted-foreground'>
            {range.range
              ? 'Scope could not be estimated. You can still start the import.'
              : 'Choose a range to preview the import scope.'}
          </p>
        )}
      </div>
    </div>
  );
};
