import { ComponentType, ReactElement, Ref, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useMeasure } from 'react-use';
import { ListAiGenerated, ReminderAnticlockwise, Settings02 } from '@xyne/icons';
import { Dialog } from '../../components/ui/Dialog/Dialog';
import { cn } from '../../utils/classNames';
import {
  CARD_CHROME,
  MiniBriefCard,
  MiniBriefSkeleton,
  MiniHistoryCard,
  MiniSettingsCard,
} from './briefFeatureViews';

type FeatureTab = 'default' | 'settings' | 'regenerate' | 'history';

// Both curves are strong ease-outs: fast start, gentle settle. Size and content
// share a duration so the panel reads as one entity rather than two animations.
const SIZE_EASE = [0.25, 1, 0.5, 1] as const;
const CONTENT_EASE = [0.19, 1, 0.22, 1] as const;
const SIZE_DURATION = 0.27;
const ENTER_DURATION = 0.27;
// The user has already decided by the time something leaves — exits get out of the way.
const EXIT_DURATION = 0.27;
/** Height of the absolutely-positioned title + tabs bar. The stage below it is
 *  inset by this much so centring happens in the space actually left over. */
const HEADER_H = 56;
/** How long the regenerate demo holds on its skeleton before the brief resolves. */
const SKELETON_MS = 1100;
/** Order the stepper walks, and how long each step holds before advancing. */
const STEPS: FeatureTab[] = ['default', 'regenerate', 'settings', 'history'];
const STEP_MS = 3400;

interface TabSpec {
  value: Exclude<FeatureTab, 'default'>;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
}

const TABS: TabSpec[] = [
  { value: 'regenerate', label: 'Regenerate', icon: ListAiGenerated },
  { value: 'settings', label: 'Settings', icon: Settings02 },
  { value: 'history', label: 'History', icon: ReminderAnticlockwise },
];

const TITLES: Record<FeatureTab, string> = {
  default: 'Your morning brief',
  regenerate: 'Re-run it any time',
  settings: 'Make it yours',
  history: 'Every brief, kept',
};

const DESCRIPTIONS: Record<FeatureTab, string> = {
  default: 'Everything that needs you, is overdue, waiting, and assigned to you summarized',
  settings: 'Customize tone, priorities, and what each section covers.',
  regenerate: 'Re-run the brief with your latest tickets, threads, and approvals.',
  history: 'Browse past briefs and see what changed day to day.',
};

interface BriefFeaturesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BriefFeaturesDialog({
  open,
  onOpenChange,
}: BriefFeaturesDialogProps): ReactElement {
  const [tab, setTab] = useState<FeatureTab>('default');
  const [regenSettled, setRegenSettled] = useState(false);
  const [autoplay, setAutoplay] = useState(true);
  const reduce = useReducedMotion();
  const enter = reduce
    ? { from: { opacity: 0 }, to: { opacity: 1 } }
    : {
        from: { opacity: 0, filter: 'blur(2px)', scale: 0.96 },
        to: { opacity: 1, filter: 'blur(0px)', scale: 1 },
      };
  const [frameRef] = useMeasure();
  const [contentRef, content] = useMeasure();

  useEffect(() => {
    if (!open) return;
    setTab('default');
    setAutoplay(true);
  }, [open]);

  // Regenerate demo: hold the skeleton, then resolve. Re-runs on every entry to
  // the tab so the animation is the thing you actually see.
  // Regenerate holds longer: its own skeleton eats the first second of the step.
  const dwellMs = tab === 'regenerate' ? STEP_MS + SKELETON_MS : STEP_MS;

  // Auto-advance. Off under reduced motion — auto-updating content is exactly
  // what that preference asks us not to do — and off for good once the reader
  // picks a tab themselves, so the stepper never fights them.
  useEffect(() => {
    if (!open || !autoplay || reduce) return undefined;
    const id = window.setTimeout(() => {
      setTab(current => STEPS[(STEPS.indexOf(current) + 1) % STEPS.length] ?? 'default');
    }, dwellMs);
    return () => window.clearTimeout(id);
  }, [open, autoplay, reduce, tab, dwellMs]);

  useEffect(() => {
    if (tab !== 'regenerate') return undefined;
    setRegenSettled(false);
    const id = window.setTimeout(() => setRegenSettled(true), SKELETON_MS);
    return () => window.clearTimeout(id);
  }, [tab]);

  const body = useMemo(() => {
    switch (tab) {
      case 'default':
        return <MiniBriefCard />;
      case 'regenerate':
        return regenSettled ? <MiniBriefCard regenerated /> : <MiniBriefSkeleton />;
      case 'settings':
        return <MiniSettingsCard />;
      case 'history':
        return <MiniHistoryCard />;
    }
  }, [tab, regenSettled]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title='Xyne Brief'
      description='What you can do with your daily brief'
      className='h-[560px] w-[540px] max-w-[540px] rounded-[28px] border border-border p-1.5 pb-5'
    >
      <div className='flex h-full flex-col items-center gap-4'>
        <div className='flex min-h-0 flex-1 flex-col items-center gap-3 self-stretch'>
          {/* The frame is fixed; only what sits inside it changes size. */}
          <div
            ref={frameRef as Ref<HTMLDivElement> | undefined}
            className={cn(
              'relative min-h-0 flex-1 self-stretch overflow-hidden rounded-[22px] border border-border',
              'shadow-[0px_43px_17px_0px_rgba(0,0,0,0.01),0px_24px_15px_0px_rgba(0,0,0,0.02),0px_11px_11px_0px_rgba(0,0,0,0.03),0px_3px_6px_0px_rgba(0,0,0,0.04)]',
            )}
          >
            {/* Reuses the app's themed wallpaper variable rather than a new asset, so
                midnight gets its own image for free. Scaled past the edges because
                the blur would otherwise pull the frame's border inward. */}
            <div
              aria-hidden
              className='app-wallpaper-image pointer-events-none absolute inset-0 scale-125 bg-cover bg-center bg-no-repeat blur-2xl'
            />
            <div aria-hidden className='pointer-events-none absolute inset-0 bg-background/50' />

            {/* Everything that animates lives in a stage inset below the header,
                so `justify-center` centres it in the free area rather than the
                whole frame — otherwise the header's height all lands underneath.
                It also gives the back cards' `calc(50% - …)` the right basis. */}
            <div
              className='absolute inset-x-0 bottom-0 flex items-center justify-center'
              style={{ top: HEADER_H }}
            >
              {/* The container carries the card chrome, so its size change IS the
                visible morph. z-10 keeps it above the transformed card behind it,
                which would otherwise paint on top by CSS painting order. */}
              <motion.div
                className={cn(
                  CARD_CHROME,
                  'relative z-10 flex items-start justify-center overflow-hidden rounded-[16px] select-none',
                )}
                animate={{ width: content.width, height: content.height }}
                transition={reduce ? { duration: 0 } : { duration: SIZE_DURATION, ease: SIZE_EASE }}
              >
                <div ref={contentRef as Ref<HTMLDivElement> | undefined} className='w-fit'>
                  <AnimatePresence initial={false} mode='popLayout'>
                    <motion.div
                      key={tab === 'regenerate' ? `regenerate-${regenSettled}` : tab}
                      initial={enter.from}
                      animate={enter.to}
                      exit={enter.from}
                      transition={{ duration: ENTER_DURATION, ease: CONTENT_EASE }}
                    >
                      {body}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </motion.div>
            </div>

            <div className='absolute top-0 inset-x-0 flex justify-between p-1.5 items-center'>
              <p className='font-serif text-base italic leading-normal text-muted-foreground pl-2.5'>
                Xyne Brief
              </p>
              <div className='bg-background flex shrink-0 items-center justify-center gap-2 border-[0.5px] border-border rounded-2xl p-2'>
                {TABS.map(({ value, label, icon: IconComponent }) => {
                  const isActive = tab === value;
                  return (
                    <button
                      key={value}
                      type='button'
                      onClick={() => {
                        setTab(isActive ? 'default' : value);
                        setAutoplay(false);
                      }}
                      aria-pressed={isActive}
                      data-track-category='DailyBrief'
                      data-track-name='daily-brief-features-tab'
                      data-track-metadata={JSON.stringify({ tab: value })}
                      className={cn(
                        'flex h-9 items-center rounded-[10px] px-2.5 transition-colors duration-200 ease-out',
                        isActive
                          ? 'bg-accent text-foreground shadow-sm'
                          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                      )}
                    >
                      <span className='flex size-5 shrink-0 items-center justify-center'>
                        <IconComponent size={20} />
                      </span>
                      <span
                        className={cn(
                          'grid overflow-hidden transition-[grid-template-columns,opacity,margin] duration-200 ease-out',
                          isActive
                            ? 'ml-2 grid-cols-[1fr] opacity-100'
                            : 'grid-cols-[0fr] opacity-0',
                        )}
                      >
                        <span className='min-w-0 overflow-hidden whitespace-nowrap text-[14px] font-medium leading-[1.2] tracking-[-0.1px]'>
                          {label}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className='flex shrink-0 flex-col items-center gap-2'>
          <div className='grid h-7 place-items-center'>
            <AnimatePresence initial={false} mode='popLayout'>
              <motion.p
                key={tab}
                initial={enter.from}
                animate={enter.to}
                exit={enter.from}
                transition={{ duration: EXIT_DURATION, ease: CONTENT_EASE }}
                className='col-start-1 row-start-1 text-center text-[17px] font-semibold tracking-[-0.2px] text-foreground'
              >
                {TITLES[tab]}
              </motion.p>
            </AnimatePresence>
          </div>
          <div className='grid h-16 place-items-start px-3'>
            <AnimatePresence initial={false} mode='popLayout'>
              <motion.p
                key={tab}
                initial={enter.from}
                animate={enter.to}
                exit={enter.from}
                transition={{ duration: EXIT_DURATION, ease: CONTENT_EASE }}
                className='col-start-1 row-start-1 text-center text-base font-normal leading-[1.5] tracking-[-0.1px] text-foreground'
              >
                {DESCRIPTIONS[tab]}
              </motion.p>
            </AnimatePresence>
          </div>

          <div className='flex items-center justify-center gap-1.5'>
            {STEPS.map(step => {
              const isActive = tab === step;
              return (
                <button
                  key={step}
                  type='button'
                  aria-label={TITLES[step]}
                  aria-current={isActive ? 'step' : undefined}
                  onClick={() => {
                    setTab(step);
                    setAutoplay(false);
                  }}
                  data-track-category='DailyBrief'
                  data-track-name='daily-brief-features-step'
                  data-track-metadata={JSON.stringify({ step })}
                  className={cn(
                    'h-1.5 overflow-hidden rounded-full bg-muted-foreground/25 transition-all duration-300 ease-out',
                    isActive ? 'w-7' : 'w-1.5 hover:bg-muted-foreground/50',
                  )}
                >
                  {isActive && (
                    <motion.span
                      // Re-keyed per step so the fill restarts rather than resuming.
                      key={`${step}-${String(autoplay)}`}
                      className='block h-full rounded-full bg-primary'
                      initial={{ width: autoplay && !reduce ? '0%' : '100%' }}
                      animate={{ width: '100%' }}
                      // A progress timer is constant motion — linear is correct here.
                      transition={
                        autoplay && !reduce
                          ? { duration: dwellMs / 1000, ease: 'linear' }
                          : { duration: 0 }
                      }
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
