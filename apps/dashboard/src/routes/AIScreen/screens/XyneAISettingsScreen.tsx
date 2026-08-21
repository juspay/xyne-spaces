import { ReactElement, useMemo, useState } from 'react';
import { AnimatePresence, motion, MotionConfig, useReducedMotion } from 'framer-motion';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Pause, Play } from 'lucide-react';
import { Settings } from '@/components/ClawAgents/digitalTwin/icons';
import { DigitalTwinEnablePanel } from '@/components/ClawAgents/digitalTwin/DigitalTwinEnablePanel';
import {
  DIGITAL_TWIN_EASE_IN,
  DIGITAL_TWIN_EASE_OUT,
  DIGITAL_TWIN_MOTION,
} from '@/components/ClawAgents/digitalTwin/motion';
import XyneAIStar from '@/components/icons/xyne-ai/XyneAIStar';
import { Button } from '@/components/ui/Button';
import {
  useClawDigitalTwinPipelineEvents,
  useClawDigitalTwinStatus,
  usePauseDigitalTwinBackfill,
  useResumeDigitalTwinBackfill,
} from '@/hooks/useClawDigitalTwin';
import { cn } from '@/utils/classNames';
import '@/components/ClawAgents/digitalTwin/digital-twin.css';
import '@/components/ClawAgents/digitalTwin/digital-twin-motion.css';

const PRIMARY_TABS = [
  { to: 'overview', label: 'Overview' },
  { to: 'configuration', label: 'Configuration' },
  { to: 'memories', label: 'Memories' },
  { to: 'review', label: 'Review' },
  { to: 'activity', label: 'Activity' },
] as const;

const DigitalTwinNavLabel = ({
  label,
  isActive,
}: {
  label: string;
  isActive: boolean;
}): ReactElement => (
  <>
    {isActive && (
      <motion.span
        layoutId='digital-twin-active-tab'
        className='absolute inset-0 -z-10 rounded-[10px] bg-foreground/[0.06]'
        transition={{ duration: DIGITAL_TWIN_MOTION.layout, ease: DIGITAL_TWIN_EASE_OUT }}
      />
    )}
    <span>{label}</span>
  </>
);

const navClassName = ({ isActive }: { isActive: boolean }): string =>
  cn(
    'dt-transition relative isolate flex h-8 shrink-0 items-center justify-center overflow-hidden rounded-[10px] px-3 py-1',
    'text-sm font-[450] leading-[1.2]',
    isActive
      ? 'text-foreground'
      : 'text-foreground/80 hover:bg-foreground/[0.04] hover:text-foreground',
  );

const settingsClassName = ({ isActive }: { isActive: boolean }): string =>
  cn(
    'dt-transition inline-flex size-9 items-center justify-center rounded-[10px] text-foreground/70',
    isActive
      ? 'bg-foreground/[0.06] text-foreground'
      : 'hover:bg-foreground/[0.04] hover:text-foreground',
  );

const XyneAISettingsScreen = (): ReactElement => {
  const location = useLocation();
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const statusQuery = useClawDigitalTwinStatus();
  const { data: status, backfillStalled } = statusQuery;
  const enabled = !!status?.enabled;
  const activity = useClawDigitalTwinPipelineEvents({ limit: 10 }, false, enabled);
  const pause = usePauseDigitalTwinBackfill();
  const resume = useResumeDigitalTwinBackfill();
  const [showEnable, setShowEnable] = useState(false);

  const running = status?.backfill?.overall.running ?? false;
  const paused = status?.backfill?.overall.paused ?? false;
  const progress = status?.backfill?.overall.pctByWindows ?? null;
  const activePipelineEvent = activity.data?.pages
    .flatMap(page => page.events)
    .find(event => event.status === 'running' || event.status === 'retry');
  const pipelineRunning = !!activePipelineEvent;
  const synthesisRunning = activePipelineEvent?.runType === 'synthesize';
  const backfillSources = Object.entries(status?.backfill?.sources ?? {})
    .filter(([, source]) => !source.complete)
    .map(([source]) => `${source.charAt(0).toUpperCase()}${source.slice(1)}`)
    .join(', ');

  const statusCopy = useMemo(() => {
    if (status?.memoryDeleteInProgress) return 'Cleaning up memories';
    if (synthesisRunning) return 'Refreshing how it represents you';
    if (paused) return 'History import paused';
    if (backfillStalled) return 'History import needs attention';
    if (running) return 'Learning from your history';
    if (pipelineRunning) return 'Learning work is running';
    return 'Ready';
  }, [
    backfillStalled,
    paused,
    pipelineRunning,
    running,
    status?.memoryDeleteInProgress,
    synthesisRunning,
  ]);

  const working =
    running || paused || backfillStalled || pipelineRunning || !!status?.memoryDeleteInProgress;

  return (
    <MotionConfig reducedMotion='user'>
      <div className='digital-twin-ledger relative min-h-full w-full bg-background text-foreground'>
        <a
          href='#xyne-ai-settings-content'
          className='sr-only z-[80] rounded-md bg-background px-4 py-2 text-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4'
        >
          Skip Xyne AI settings navigation
        </a>

        <div className='mx-auto flex w-full max-w-[800px] flex-col gap-4 px-4 pb-32 pt-12 sm:px-0'>
          <header className='relative flex flex-col'>
            <NavLink
              to='settings'
              className={({ isActive }) =>
                cn('absolute right-0 top-0 z-10', settingsClassName({ isActive }))
              }
              aria-label='Settings'
              title='Settings'
              data-track-category='Xyne AI'
              data-track-name='Xyne AI open settings'
            >
              <Settings className='size-[18px]' aria-hidden />
            </NavLink>

            <div className='dt-shell-header flex w-full flex-col items-center gap-4'>
              <div
                className='relative flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-full border-[1.5px] border-foreground/10 bg-background'
                aria-hidden='true'
              >
                <XyneAIStar size={40} />
              </div>
              <h1 className='text-center text-[24px] font-[550] not-italic leading-[1.1] tracking-[-0.1px] text-foreground'>
                Xyne AI
              </h1>
            </div>
          </header>

          <nav
            className='mt-6 flex items-start gap-1 overflow-x-auto'
            aria-label='Xyne AI settings'
          >
            {PRIMARY_TABS.map(({ to, label }) => (
              <NavLink key={to} to={to} className={navClassName} end={to === 'overview'}>
                {({ isActive }) => <DigitalTwinNavLabel label={label} isActive={isActive} />}
              </NavLink>
            ))}
          </nav>

          <AnimatePresence initial={false}>
            {!enabled && (
              <motion.section
                layout='position'
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
                transition={{ duration: DIGITAL_TWIN_MOTION.state, ease: DIGITAL_TWIN_EASE_OUT }}
                className='rounded-xl border border-primary/20 bg-primary/5 px-4 py-4'
              >
                <p className='text-sm font-medium text-foreground'>
                  Turn on learning from your history
                </p>
                <p className='mt-1 text-sm text-muted-foreground'>
                  Xyne AI can learn durable context from your Spaces activity. Chat works without
                  this, but memories, review, and mention replies need learning enabled.
                </p>
                <div className='mt-3 flex flex-wrap gap-2'>
                  <Button size='sm' onClick={() => setShowEnable(true)}>
                    Enable learning
                  </Button>
                  <Button size='sm' variant='outline' asChild>
                    <Link to='settings'>Open settings</Link>
                  </Button>
                </div>
              </motion.section>
            )}
          </AnimatePresence>

          <AnimatePresence initial={false}>
            {enabled && working && (
              <motion.section
                layout='position'
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
                transition={{ duration: DIGITAL_TWIN_MOTION.state, ease: DIGITAL_TWIN_EASE_OUT }}
                className='flex flex-wrap items-center gap-3 rounded-xl border border-border bg-muted/30 p-4'
                aria-live='polite'
                aria-label='Xyne AI background work'
              >
                <div className='min-w-[220px] flex-1'>
                  <div className='flex items-center justify-between gap-4'>
                    <p className='text-sm font-semibold text-foreground'>{statusCopy}</p>
                    {running && progress !== null && !status?.memoryDeleteInProgress && (
                      <span className='text-xs tabular-nums text-muted-foreground'>
                        {Math.round(progress)}%
                      </span>
                    )}
                  </div>
                  {running && !status?.memoryDeleteInProgress && progress !== null && (
                    <div className='mt-2 h-1.5 overflow-hidden rounded-full bg-border'>
                      <div
                        className='dt-progress h-full bg-primary'
                        style={{
                          transform: `scaleX(${Math.max(0, Math.min(100, progress)) / 100})`,
                        }}
                      />
                    </div>
                  )}
                  <p className='mt-1.5 text-xs leading-5 text-muted-foreground'>
                    {status?.memoryDeleteInProgress
                      ? 'You can keep working while cleanup finishes.'
                      : synthesisRunning
                        ? 'Approved memories are being turned into refreshed profile suggestions.'
                        : pipelineRunning && !running
                          ? 'New learning is being checked. Results will appear in recent activity.'
                          : backfillStalled
                            ? `${backfillSources || 'Your history'} has not made progress for two minutes. Resume to try unfinished sources again.`
                            : paused
                              ? `${backfillSources || 'Your history'} is paused. Your place is saved.`
                              : `${backfillSources || 'Your history'} · ${(status?.backfill?.overall.recordsSeen ?? 0).toLocaleString()} records checked · ${(status?.backfill?.overall.candidatesMade ?? 0).toLocaleString()} memories suggested`}
                  </p>
                </div>
                {!status?.memoryDeleteInProgress && (running || paused || backfillStalled) && (
                  <Button
                    variant='outline'
                    size='sm'
                    loading={pause.isPending || resume.isPending}
                    onClick={() => {
                      if (paused || backfillStalled) resume.mutate();
                      else pause.mutate();
                    }}
                    data-track-category='Xyne AI'
                    data-track-name={
                      paused || backfillStalled
                        ? 'Xyne AI resume history import'
                        : 'Xyne AI pause history import'
                    }
                  >
                    {paused || backfillStalled ? (
                      <Play className='size-4' />
                    ) : (
                      <Pause className='size-4' />
                    )}
                    {paused || backfillStalled ? 'Resume' : 'Pause'}
                  </Button>
                )}
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={() => void navigate('activity')}
                  data-track-category='Xyne AI'
                  data-track-name='Xyne AI view background activity'
                >
                  See progress
                </Button>
              </motion.section>
            )}
          </AnimatePresence>

          <main className='contents'>
            <span id='xyne-ai-settings-content' className='sr-only' tabIndex={-1}>
              Xyne AI settings content
            </span>

            <AnimatePresence mode='popLayout' initial={false}>
              <motion.div
                key={location.pathname}
                className='dt-route-stage flex flex-col gap-10'
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
                transition={{
                  duration: reduceMotion ? DIGITAL_TWIN_MOTION.feedback : DIGITAL_TWIN_MOTION.route,
                  ease: reduceMotion ? DIGITAL_TWIN_EASE_IN : DIGITAL_TWIN_EASE_OUT,
                }}
              >
                <Outlet />
              </motion.div>
            </AnimatePresence>

            {showEnable && <DigitalTwinEnablePanel />}
          </main>
        </div>
      </div>
    </MotionConfig>
  );
};

export default XyneAISettingsScreen;
