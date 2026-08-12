import { ReactElement } from 'react';
import { ArrowRight, BookOpenCheck, Check, LockKeyhole, MessageSquareText } from './icons';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useEnableDigitalTwin } from '@/hooks/useClawDigitalTwin';
import { isoDate, QUICK_DAYS, useDigitalTwinRange } from './useDigitalTwinRange';

const PRINCIPLES = [
  {
    number: '01',
    icon: BookOpenCheck,
    title: 'You decide what becomes memory',
    body: 'New knowledge normally waits in Review before it enters the durable ledger.',
  },
  {
    number: '02',
    icon: LockKeyhole,
    title: 'Private conversations stay private',
    body: 'The Twin reads your public Spaces messages, hosted calls, and authored canvases—not DMs or private channels.',
  },
  {
    number: '03',
    icon: MessageSquareText,
    title: 'Replies remain grounded and inspectable',
    body: 'When mentioned, it drafts in your voice using approved knowledge and a traceable learning history.',
  },
] as const;

export const DigitalTwinEnablePanel = (): ReactElement => {
  const range = useDigitalTwinRange('enable', true);
  const enable = useEnableDigitalTwin();
  const customInvalid =
    range.selection === 'custom' &&
    (!range.customFrom || !range.customTo || range.customFrom > range.customTo);

  return (
    <div className='grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(420px,1.1fr)]'>
      <section className='rounded-xl border border-border bg-card p-5'>
        <p className='text-xs font-medium text-primary'>Personal AI, with a paper trail</p>
        <h2 className='mt-1 text-lg font-semibold text-foreground'>
          Build a Twin you can inspect and correct
        </h2>
        <p className='mt-2 max-w-[58ch] text-sm leading-6 text-muted-foreground'>
          Digital Twin learns the durable context behind your work, then uses only the knowledge you
          allow when it speaks on your behalf.
        </p>

        <ol className='mt-6 flex flex-col gap-2'>
          {PRINCIPLES.map(principle => {
            const Icon = principle.icon;
            return (
              <li
                key={principle.number}
                className='flex gap-3 rounded-lg border border-border bg-muted/20 p-3'
              >
                <div className='flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background'>
                  <Icon className='size-4 text-muted-foreground' />
                </div>
                <div>
                  <h3 className='text-sm font-medium text-foreground'>{principle.title}</h3>
                  <p className='mt-1 max-w-[58ch] text-xs leading-5 text-muted-foreground'>
                    {principle.body}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <section
        className='rounded-xl border border-border bg-card p-5'
        aria-labelledby='enable-history-heading'
      >
        <p className='text-xs font-medium text-muted-foreground'>Start with relevant context</p>
        <h3 id='enable-history-heading' className='mt-1 text-lg font-semibold text-foreground'>
          Choose how much history to learn from
        </h3>
        <p className='mt-1 text-sm leading-6 text-muted-foreground'>
          Six months is recommended. You can skip history and begin learning from today, or import
          more later.
        </p>

        <fieldset className='mt-6'>
          <legend className='sr-only'>History range</legend>
          <div className='grid gap-2 sm:grid-cols-2'>
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
                      ? 'flex min-h-20 items-center gap-3 rounded-lg border border-primary bg-primary/5 px-4 py-3 text-left'
                      : 'flex min-h-20 items-center gap-3 rounded-lg border border-border bg-background px-4 py-3 text-left transition-colors hover:bg-accent'
                  }
                  data-track-category='Claw Agents'
                  data-track-name='Digital Twin enable range preset'
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
                    <span className='block text-sm font-medium text-foreground'>
                      {preset.label}
                    </span>
                    <span className='mt-1 block text-xs text-muted-foreground'>
                      {preset.sublabel}
                    </span>
                  </span>
                </button>
              );
            })}
            <button
              type='button'
              onClick={range.selectCustom}
              aria-pressed={range.selection === 'custom'}
              className={
                range.selection === 'custom'
                  ? 'flex min-h-20 items-center gap-3 rounded-lg border border-primary bg-primary/5 px-4 py-3 text-left'
                  : 'flex min-h-20 items-center gap-3 rounded-lg border border-border bg-background px-4 py-3 text-left transition-colors hover:bg-accent'
              }
              data-track-category='Claw Agents'
              data-track-name='Digital Twin enable range custom'
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
                <span className='mt-1 block text-xs text-muted-foreground'>Choose exact dates</span>
              </span>
            </button>
          </div>
        </fieldset>

        {range.selection === 'custom' && (
          <div className='mt-5'>
            <div className='grid gap-3 sm:grid-cols-2'>
              <label htmlFor='digital-twin-enable-from'>
                <span className='mb-1.5 block text-xs font-medium text-foreground'>From</span>
                <Input
                  id='digital-twin-enable-from'
                  type='date'
                  value={range.customFrom}
                  max={range.customTo}
                  onChange={event => range.setCustomFrom(event.target.value)}
                  data-track-category='Claw Agents'
                  data-track-name='Digital Twin enable custom start date'
                />
              </label>
              <label htmlFor='digital-twin-enable-to'>
                <span className='mb-1.5 block text-xs font-medium text-foreground'>To</span>
                <Input
                  id='digital-twin-enable-to'
                  type='date'
                  value={range.customTo}
                  min={range.customFrom}
                  max={isoDate(new Date())}
                  onChange={event => range.setCustomTo(event.target.value)}
                  data-track-category='Claw Agents'
                  data-track-name='Digital Twin enable custom end date'
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
                  data-track-name='Digital Twin enable quick date range'
                >
                  Last {days} days
                </Button>
              ))}
            </div>
          </div>
        )}

        <div className='mt-5 rounded-lg border border-border bg-muted/20 p-3' aria-live='polite'>
          {range.estimateLoading ? (
            <p className='text-sm text-muted-foreground'>Estimating the import scope…</p>
          ) : !range.range ? (
            <p className='text-sm text-muted-foreground'>
              No history imported. Learning starts from today.
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
                About {range.estimate.estCandidates.toLocaleString()} candidate memories · estimated
                ${range.estimate.estCostUSD.toFixed(2)} LLM cost charged to your organization.
              </p>
            </>
          ) : (
            <p className='text-sm text-muted-foreground'>
              Choose a valid range to preview the scope.
            </p>
          )}
        </div>

        {enable.isError && (
          <div
            role='alert'
            className='mt-5 rounded-lg border border-destructive/30 bg-destructive/5 p-4'
          >
            <p className='text-sm font-semibold text-destructive'>
              Digital Twin could not be enabled.
            </p>
            <p className='mt-1 text-sm text-muted-foreground'>
              {enable.error.message} Your history choice has been kept; use the button below to try
              again.
            </p>
          </div>
        )}

        <Button
          className='mt-5 w-full'
          disabled={customInvalid}
          loading={enable.isPending}
          onClick={() =>
            enable.mutate(
              { backfill: range.range },
              { onSuccess: () => toast.success('Digital Twin enabled') },
            )
          }
          data-track-category='Claw Agents'
          data-track-name='Digital Twin enable'
        >
          Enable and start
          <ArrowRight className='size-4' />
        </Button>
        <p className='mt-3 text-center text-xs text-muted-foreground'>
          You can pause imports, edit memories, or disable the Twin at any time.
        </p>
      </section>
    </div>
  );
};
