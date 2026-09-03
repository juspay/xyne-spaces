import { ReactElement } from 'react';
import { ArrowRight, Brain, Loader2, MessageSquare, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { cn } from '@/utils/classNames';
import { useEnableDigitalTwin } from '@/hooks/useClawDigitalTwin';
import { isoDate, QUICK_DAYS, useDigitalTwinRange } from './useDigitalTwinRange';

const HIGHLIGHTS = [
  {
    icon: Brain,
    title: 'Learns from your work',
    body: 'Reads your public Spaces activity — messages you sent, calls you hosted, canvases you authored.',
  },
  {
    icon: ShieldCheck,
    title: 'You approve every memory',
    body: 'Nothing is saved until you review it. DMs and private channels are never read.',
  },
  {
    icon: MessageSquare,
    title: 'Speaks in your voice',
    body: 'When someone mentions you, it drafts a reply grounded only in memories you approved.',
  },
];

/**
 * In-page enable experience shown when the Twin is off. On enable the status
 * query invalidates and the screen swaps to the normal sections automatically.
 */
export const DigitalTwinEnablePanel = (): ReactElement => {
  const r = useDigitalTwinRange('enable', true);
  const enableMutation = useEnableDigitalTwin();

  const submit = (): void => {
    enableMutation.mutate(
      { backfill: r.range },
      { onSuccess: () => toast.success('Digital Twin enabled') },
    );
  };

  const activeDescription =
    r.selection === 'custom'
      ? r.customDays > 0
        ? `${r.customDays.toLocaleString()} days of history`
        : 'Pick a start and end date'
      : (r.activePreset?.sublabel ?? '');

  return (
    <div className='w-full max-w-5xl animate-in fade-in-0 slide-in-from-bottom-1 duration-500 motion-reduce:animate-none'>
      <div className='grid gap-x-16 gap-y-12 lg:grid-cols-2'>
        {/* Narrative */}
        <div className='flex flex-col'>
          <p className='text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground'>
            Personal AI
          </p>
          <h2 className='mt-3 text-2xl font-semibold tracking-tight text-foreground'>
            Enable your Digital Twin
          </h2>
          <p className='mt-3 max-w-md text-sm leading-relaxed text-muted-foreground'>
            It learns how you work and communicate from your Spaces history. Every memory is
            reviewed and approved by you before it&apos;s ever used.
          </p>

          <ul className='mt-9 flex flex-col gap-6'>
            {HIGHLIGHTS.map(highlight => {
              const IconComponent = highlight.icon;
              return (
                <li key={highlight.title} className='flex gap-3'>
                  <IconComponent className='mt-0.5 size-4 shrink-0 text-primary' />
                  <div>
                    <p className='text-[13px] font-medium text-foreground'>{highlight.title}</p>
                    <p className='mt-1 text-xs leading-relaxed text-muted-foreground'>
                      {highlight.body}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Configurator */}
        <div className='flex max-w-md flex-col'>
          <h3 className='text-sm font-semibold text-foreground'>Backfill your history</h3>
          <p className='mt-1 text-xs leading-relaxed text-muted-foreground'>
            Seed your Twin from past activity, or skip and start learning from today. You can run a
            backfill any time.
          </p>

          {/* Time-range segmented selector */}
          <div className='mt-6'>
            <p className='mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>
              How far back
            </p>
            <div className='inline-flex flex-wrap items-center gap-1 rounded-full bg-muted p-1'>
              {r.presets.map((preset, i) => {
                const active = r.selection === 'preset' && r.presetIdx === i;
                return (
                  <button
                    key={preset.short}
                    type='button'
                    onClick={() => r.selectPreset(i)}
                    data-track-category='Claw Agents'
                    data-track-name='Digital Twin enable range preset'
                    className={cn(
                      'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                      active
                        ? 'bg-foreground text-background'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {preset.short}
                  </button>
                );
              })}
              <button
                type='button'
                onClick={r.selectCustom}
                data-track-category='Claw Agents'
                data-track-name='Digital Twin enable range custom'
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                  r.selection === 'custom'
                    ? 'bg-foreground text-background'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                Custom
              </button>
            </div>
            {activeDescription && (
              <p className='mt-2 text-xs text-muted-foreground'>{activeDescription}</p>
            )}
          </div>

          {/* Custom date inputs */}
          {r.selection === 'custom' && (
            <div className='mt-4 flex flex-col gap-2.5'>
              <div className='flex items-center gap-2'>
                <input
                  type='date'
                  value={r.customFrom}
                  max={r.customTo}
                  onChange={e => r.setCustomFrom(e.target.value)}
                  data-track-category='Claw Agents'
                  data-track-name='Digital Twin enable from date'
                  className='flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none'
                />
                <span className='shrink-0 text-[11px] text-muted-foreground'>→</span>
                <input
                  type='date'
                  value={r.customTo}
                  min={r.customFrom}
                  max={isoDate(new Date())}
                  onChange={e => r.setCustomTo(e.target.value)}
                  data-track-category='Claw Agents'
                  data-track-name='Digital Twin enable to date'
                  className='flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:border-ring focus:outline-none'
                />
              </div>
              <div className='flex flex-wrap gap-1.5'>
                {QUICK_DAYS.map(n => (
                  <button
                    key={n}
                    type='button'
                    onClick={() => r.applyQuickDays(n)}
                    data-track-category='Claw Agents'
                    data-track-name='Digital Twin enable quick days'
                    className='rounded-full border border-border px-2.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
                  >
                    last {n}d
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Estimate — quiet, inline */}
          <div className='mt-6 border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground'>
            {r.estimateLoading ? (
              <span className='inline-flex items-center gap-1.5'>
                <Loader2 className='size-3 animate-spin' />
                Estimating scope…
              </span>
            ) : !r.range ? (
              <span>No history imported — your Twin starts learning from today.</span>
            ) : r.estimate ? (
              <span>
                Reviews about{' '}
                <span className='font-medium tabular-nums text-foreground'>
                  {(r.estimate.messages ?? 0).toLocaleString()}
                </span>{' '}
                messages,{' '}
                <span className='font-medium tabular-nums text-foreground'>
                  {(r.estimate.calls ?? 0).toLocaleString()}
                </span>{' '}
                calls and{' '}
                <span className='font-medium tabular-nums text-foreground'>
                  {(r.estimate.canvases ?? 0).toLocaleString()}
                </span>{' '}
                canvases · ~${(r.estimate.estCostUSD ?? 0).toFixed(2)} LLM cost, charged to your
                org.
              </span>
            ) : (
              <span>Choose a range to preview the scope.</span>
            )}
          </div>

          {/* CTA */}
          <div className='mt-6 flex flex-wrap items-center gap-x-4 gap-y-2'>
            <Button
              onClick={submit}
              data-track-category='Claw Agents'
              data-track-name='ENABLE_DIGITAL_TWIN'
              loading={enableMutation.isPending}
            >
              {enableMutation.isPending ? 'Enabling…' : 'Enable & start'}
              {!enableMutation.isPending && <ArrowRight className='size-4' />}
            </Button>
            <span className='text-[11px] text-muted-foreground'>
              Disable or delete everything any time.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
