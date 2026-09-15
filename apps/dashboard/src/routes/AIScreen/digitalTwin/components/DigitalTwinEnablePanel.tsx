import { ReactElement } from 'react';
import { Brain, Loader2, MessageSquare, RefreshCw, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { SegmentedToggle } from '@/components/ui/SegmentedToggle';
import { DetailSectionHeading } from '@/routes/AIScreen/library/shared/primitives/DetailPrimitives';
import { cn } from '@/utils/classNames';
import { useEnableDigitalTwin } from '@/hooks/useClawDigitalTwin';
import {
  QUICK_DAYS,
  useDigitalTwinRange,
} from '@/components/ClawAgents/digitalTwin/useDigitalTwinRange';
import { DateRangeInputs } from './DateRangeInputs';

const CUSTOM_VALUE = 'custom';

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

export const DigitalTwinEnablePanel = (): ReactElement => {
  const r = useDigitalTwinRange('enable', true);
  const enableMutation = useEnableDigitalTwin();

  const submit = (): void => {
    enableMutation.mutate(
      { backfill: r.range },
      { onSuccess: () => toast.success('Digital Twin enabled') },
    );
  };

  return (
    <div className='flex w-full flex-col gap-8 animate-in fade-in-0 slide-in-from-bottom-1 duration-500 motion-reduce:animate-none'>
      <section className='flex flex-col gap-4'>
        <DetailSectionHeading label='How your Digital Twin works' />
        <ul className='grid gap-6 sm:grid-cols-3 sm:gap-0'>
          {HIGHLIGHTS.map((highlight, i) => {
            const IconComponent = highlight.icon;
            return (
              <li
                key={highlight.title}
                className={cn(
                  'flex flex-col sm:px-5',
                  i === 0 && 'sm:pl-0',
                  i > 0 && 'sm:border-l sm:border-border',
                  i === HIGHLIGHTS.length - 1 && 'sm:pr-0',
                )}
              >
                <span className='flex size-8 items-center justify-center rounded-lg border border-border text-primary'>
                  <IconComponent className='size-4' />
                </span>
                <p className='mt-3 text-sm font-medium text-foreground'>{highlight.title}</p>
                <p className='mt-1 text-xs leading-relaxed text-muted-foreground'>
                  {highlight.body}
                </p>
              </li>
            );
          })}
        </ul>
      </section>

      <section className='flex flex-col gap-4 border-t border-border pt-6'>
        <DetailSectionHeading label='Backfill your history' />
        <p className='max-w-xl text-xs leading-relaxed text-muted-foreground'>
          Seed your Twin from past activity, or skip and start learning from today. You can run a
          backfill any time.
        </p>

        <div className='flex flex-col'>
          <div>
            <p className='mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground'>
              How far back
            </p>
            <SegmentedToggle
              options={[
                ...r.presets.map((preset, i) => ({ value: String(i), label: preset.short })),
                { value: CUSTOM_VALUE, label: 'Custom' },
              ]}
              value={r.selection === 'custom' ? CUSTOM_VALUE : String(r.presetIdx)}
              onChange={value =>
                value === CUSTOM_VALUE ? r.selectCustom() : r.selectPreset(Number(value))
              }
              tone='primary'
              trackCategory='Claw Agents'
              trackPrefix='Digital Twin enable range'
            />
          </div>

          {r.selection === 'custom' && (
            <div className='mt-4 flex flex-col gap-2.5'>
              <DateRangeInputs range={r} trackName='Digital Twin enable' />
              <div className='flex flex-wrap gap-1.5'>
                {QUICK_DAYS.map(n => (
                  <button
                    key={n}
                    type='button'
                    onClick={() => r.applyQuickDays(n)}
                    data-track-category='Claw Agents'
                    data-track-name='Digital Twin enable quick days'
                    className='rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
                  >
                    last {n}d
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className='mt-6 flex flex-wrap items-center gap-x-4 gap-y-2'>
            <Button
              onClick={submit}
              loading={enableMutation.isPending}
              data-track-category='Claw Agents'
              data-track-name='Digital Twin: enable'
            >
              {!enableMutation.isPending && <Brain className='size-4' />}
              {enableMutation.isPending ? 'Enabling…' : 'Enable & start'}
            </Button>

            <span className='inline-flex min-w-0 items-center gap-1.5 text-xs leading-relaxed text-muted-foreground'>
              {r.estimateLoading ? (
                <>
                  <Loader2 className='size-3.5 shrink-0 animate-spin' />
                  Estimating scope…
                </>
              ) : !r.range ? (
                <>
                  <RefreshCw className='size-3.5 shrink-0' />
                  No history imported — your Twin starts learning from today.
                </>
              ) : r.estimate ? (
                <>
                  <RefreshCw className='size-3.5 shrink-0' />
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
                </>
              ) : (
                <>
                  <RefreshCw className='size-3.5 shrink-0' />
                  Choose a range to preview the scope.
                </>
              )}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
};
