import { ReactElement, useMemo, useState } from 'react';
import { AnimatePresence, motion, MotionConfig, useReducedMotion } from 'framer-motion';
import { NavLink, useLocation, useNavigate, useOutlet } from 'react-router-dom';
import {
  AlertTriangle,
  ChevronDown,
  History,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Upload,
} from '@/components/ClawAgents/digitalTwin/icons';
import { cn } from '@/utils/classNames';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  useClawDigitalTwinStatus,
  useClawDigitalTwinPipelineEvents,
  usePauseDigitalTwinBackfill,
  useResumeDigitalTwinBackfill,
} from '@/hooks/useClawDigitalTwin';
import { DigitalTwinEnablePanel } from '@/components/ClawAgents/digitalTwin/DigitalTwinEnablePanel';
import { EnableModal } from '@/components/ClawAgents/digitalTwin/EnableModal';
import { UploadModal } from '@/components/ClawAgents/digitalTwin/UploadModal';
import {
  DIGITAL_TWIN_EASE_IN,
  DIGITAL_TWIN_EASE_OUT,
  DIGITAL_TWIN_MOTION,
} from '@/components/ClawAgents/digitalTwin/motion';
import '@/components/ClawAgents/digitalTwin/digital-twin.css';
import '@/components/ClawAgents/digitalTwin/digital-twin-motion.css';

const BASE = '/claw-agents/digital-twin';

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

const ClawDigitalTwinScreen = (): ReactElement => {
  const statusQuery = useClawDigitalTwinStatus();
  const { data: status, isLoading, backfillStalled } = statusQuery;
  const activity = useClawDigitalTwinPipelineEvents({ limit: 10 }, false, !!status?.enabled);
  const pause = usePauseDigitalTwinBackfill();
  const resume = useResumeDigitalTwinBackfill();
  const navigate = useNavigate();
  const location = useLocation();
  const outlet = useOutlet();
  const reduceMotion = useReducedMotion();
  const [showBackfill, setShowBackfill] = useState(false);
  const [showUpload, setShowUpload] = useState(false);

  const enabled = !!status?.enabled;
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

  const navClassName = ({ isActive }: { isActive: boolean }): string =>
    cn(
      'dt-transition relative isolate flex h-8 shrink-0 items-center justify-center overflow-hidden rounded-[10px] px-3 py-1',
      'text-sm font-[450] leading-[1.2]',
      isActive
        ? 'text-foreground'
        : 'text-foreground/80 hover:bg-foreground/[0.04] hover:text-foreground',
    );

  const contentKey =
    isLoading && !status
      ? 'loading'
      : statusQuery.isError && !status
        ? 'error'
        : enabled
          ? location.pathname
          : 'enable';

  return (
    <MotionConfig reducedMotion='user'>
      <div className='digital-twin-ledger min-h-full w-full bg-background text-foreground'>
        <a
          href='#digital-twin-content'
          className='sr-only z-[80] rounded-md bg-background px-4 py-2 text-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4'
        >
          Skip Digital Twin navigation
        </a>

        <div className='mx-auto flex w-full max-w-[800px] flex-col gap-4 px-4 pb-16 pt-5 sm:px-0'>
          <header className='dt-shell-header flex flex-col gap-5'>
            <div className='flex w-full items-center gap-5'>
              <div className='min-w-0 flex-1'>
                <h1 className='truncate text-base font-bold leading-7 tracking-[-0.02em] text-foreground'>
                  Digital Twin
                </h1>
                <p className='text-sm font-[450] leading-[1.2] text-foreground/80'>
                  Learns from your work, speaks in your voice — every memory approved by you
                </p>
              </div>

              {enabled && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size='sm'
                      className='h-8 rounded-[10px] px-2 text-sm font-medium leading-[1.2] shadow-none'
                      data-track-category='Claw Agents'
                      data-track-name='Digital Twin open add knowledge'
                    >
                      <Plus className='size-4' />
                      Add knowledge
                      <ChevronDown className='size-4 opacity-75' />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='end' className='dt-menu-content min-w-64'>
                    <DropdownMenuItem
                      className='dt-menu-item min-h-12'
                      onSelect={() => setShowBackfill(true)}
                      data-track-category='Claw Agents'
                      data-track-name='Digital Twin open history import'
                    >
                      <History className='size-4' />
                      <span>
                        <span className='block font-semibold'>Import past work</span>
                        <span className='block text-xs text-muted-foreground'>
                          Messages, calls, and canvases
                        </span>
                      </span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className='dt-menu-item min-h-12'
                      onSelect={() => setShowUpload(true)}
                      data-track-category='Claw Agents'
                      data-track-name='Digital Twin open markdown upload'
                    >
                      <Upload className='size-4' />
                      <span>
                        <span className='block font-semibold'>Upload a document</span>
                        <span className='block text-xs text-muted-foreground'>
                          Review its facts before use
                        </span>
                      </span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>

            {enabled && (
              <nav className='flex items-start gap-1 overflow-x-auto' aria-label='Digital Twin'>
                <NavLink to={`${BASE}/persona`} className={navClassName}>
                  {({ isActive }) => <DigitalTwinNavLabel label='Details' isActive={isActive} />}
                </NavLink>
                <NavLink to={`${BASE}/memories`} className={navClassName}>
                  {({ isActive }) => <DigitalTwinNavLabel label='Memories' isActive={isActive} />}
                </NavLink>
                <NavLink to={`${BASE}/proposals`} className={navClassName}>
                  {({ isActive }) => <DigitalTwinNavLabel label='Review' isActive={isActive} />}
                </NavLink>
                <NavLink to={`${BASE}/activity`} className={navClassName}>
                  {({ isActive }) => <DigitalTwinNavLabel label='Activity' isActive={isActive} />}
                </NavLink>
              </nav>
            )}
          </header>

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
                aria-label='Digital Twin background work'
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
                    data-track-category='Claw Agents'
                    data-track-name={
                      paused || backfillStalled
                        ? 'Digital Twin resume history import'
                        : 'Digital Twin pause history import'
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
                  onClick={() => void navigate(`${BASE}/activity`)}
                  data-track-category='Claw Agents'
                  data-track-name='Digital Twin view background activity'
                >
                  See progress
                </Button>
              </motion.section>
            )}
          </AnimatePresence>

          <main className='contents'>
            <span id='digital-twin-content' className='sr-only' tabIndex={-1}>
              Digital Twin content
            </span>
            <div id='digital-twin-route-controls' className='contents' />

            <AnimatePresence mode='popLayout' initial={false}>
              <motion.div
                key={contentKey}
                className='dt-route-stage'
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
                transition={{
                  duration: reduceMotion ? DIGITAL_TWIN_MOTION.feedback : DIGITAL_TWIN_MOTION.route,
                  ease: reduceMotion ? DIGITAL_TWIN_EASE_IN : DIGITAL_TWIN_EASE_OUT,
                }}
              >
                {isLoading && !status ? (
                  <div className='flex flex-col gap-4'>
                    <Skeleton className='h-24 w-full rounded-none' />
                    <Skeleton className='h-72 w-full rounded-none' />
                  </div>
                ) : statusQuery.isError && !status ? (
                  <div
                    role='alert'
                    className='flex min-h-72 flex-col items-center justify-center rounded-xl border border-destructive/30 bg-destructive/5 px-8 py-12 text-center'
                  >
                    <AlertTriangle className='size-7 text-destructive' />
                    <h2 className='mt-4 text-base font-semibold text-foreground'>
                      Digital Twin status did not load
                    </h2>
                    <p className='mt-1 max-w-[58ch] text-sm text-muted-foreground'>
                      No settings were changed. Check the connection and try again.
                    </p>
                    <Button
                      variant='outline'
                      size='sm'
                      className='mt-4'
                      onClick={() => void statusQuery.refetch()}
                      data-track-category='Claw Agents'
                      data-track-name='Digital Twin retry status'
                    >
                      <RefreshCw className='size-4' />
                      Try again
                    </Button>
                  </div>
                ) : enabled ? (
                  outlet
                ) : (
                  <DigitalTwinEnablePanel />
                )}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>

        <EnableModal open={showBackfill} mode='backfill' onClose={() => setShowBackfill(false)} />
        <UploadModal open={showUpload} onClose={() => setShowUpload(false)} />
      </div>
    </MotionConfig>
  );
};

export default ClawDigitalTwinScreen;
