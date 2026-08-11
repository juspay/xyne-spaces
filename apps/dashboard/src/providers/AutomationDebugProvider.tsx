import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Hourglass,
  Loader2,
  MinusCircle,
  RotateCw,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import { cn } from '../utils/classNames';
import {
  fetchDebugEntityRuns,
  type DebugEntityRun,
  type DebugEntityType,
} from '../api/automationsApi';
import {
  RunDetail,
  STATUS_CLASSES,
} from '../components/Automation/AutomationRuns/RunDetail/RunDetail';
import type { AutomationRunStatus } from '../components/Automation/Automation.types';
import { useVisibleReload } from '../hooks/useVisibleReload';

interface AutomationDebugTarget {
  type: DebugEntityType;
  id: string;
}

// Module-level store (same pattern as useDebugSettings) — no Context needed
// since the panel is the only subscriber and entry points only ever write.
let debugTarget: AutomationDebugTarget | null = null;
const debugListeners = new Set<() => void>();
const subscribeDebugTarget = (l: () => void): (() => void) => {
  debugListeners.add(l);
  return () => debugListeners.delete(l);
};

export function openAutomationDebug(target: AutomationDebugTarget): void {
  debugTarget = target;
  debugListeners.forEach(l => l());
}

function closeAutomationDebug(): void {
  debugTarget = null;
  debugListeners.forEach(l => l());
}

// Mounts a single debug rail alongside children; openAutomationDebug (above)
// opens it from any entry point, which must check the debugAutomations preference itself.
export function AutomationDebugProvider({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className='flex h-full w-full overflow-hidden'>
      <div className='min-w-0 flex-1'>{children}</div>
      <AutomationDebugPanel />
    </div>
  );
}

const RUNS_LIMIT = 50;
const ENTITY_LABEL: Record<DebugEntityType, string> = {
  MESSAGE: 'this message',
  EMAIL: 'this email',
  TICKET: 'this ticket',
};
// Ticket runs only cover creation (see the backend route) — surfaced here too.
const ENTITY_SCOPE_NOTE: Partial<Record<DebugEntityType, string>> = {
  TICKET:
    'This is for ticket-creation debugging only. For other details, go to the automations page.',
};

const RAIL_WIDTH_KEY = 'xyne-debug-rail-width';
const MIN_RAIL_WIDTH = 360;
const MAX_RAIL_WIDTH = 720;

// "Debug automations" side rail: entity runs list, then a run's steps reuse
// RunDetail (the real automation-runs page component) as-is.
function AutomationDebugPanel(): ReactElement | null {
  const target = useSyncExternalStore(subscribeDebugTarget, () => debugTarget);
  const [selectedRun, setSelectedRun] = useState<DebugEntityRun | null>(null);
  const [showIds, setShowIds] = useState(false);
  const [width, setWidth] = useState(() => Number(localStorage.getItem(RAIL_WIDTH_KEY)) || 480);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setSelectedRun(null); // reset drilldown when opened on a new entity
    setOpen(false);
    if (!target) return;
    const raf = requestAnimationFrame(() => setOpen(true)); // paint at 0 first, so the width change transitions
    return () => cancelAnimationFrame(raf);
  }, [target]);

  const startResize = (e: { preventDefault: () => void; clientX: number }): void => {
    e.preventDefault();
    const startX = e.clientX;
    const onMove = (ev: MouseEvent): void => {
      const next = Math.min(
        MAX_RAIL_WIDTH,
        Math.max(MIN_RAIL_WIDTH, width - (ev.clientX - startX)),
      );
      setWidth(next);
      localStorage.setItem(RAIL_WIDTH_KEY, String(next));
    };
    const onUp = (): void => document.removeEventListener('mousemove', onMove);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp, { once: true });
  };

  if (!target) return null;
  const handleClose = (): void => {
    setSelectedRun(null);
    closeAutomationDebug();
  };

  return (
    <aside
      aria-label='Debug automations'
      data-testid='automation-debug-rail'
      style={{ width: open ? width : 0 }}
      className='relative flex h-full shrink-0 flex-col overflow-hidden border-l border-border bg-background shadow-xl transition-[width] duration-200 ease-out'
    >
      <div
        role='slider'
        aria-orientation='vertical'
        aria-label='Resize debug panel'
        aria-valuenow={width}
        aria-valuemin={MIN_RAIL_WIDTH}
        aria-valuemax={MAX_RAIL_WIDTH}
        tabIndex={0}
        onMouseDown={startResize}
        onKeyDown={(e): void => {
          const step = e.key === 'ArrowLeft' ? 16 : e.key === 'ArrowRight' ? -16 : 0;
          if (!step) return;
          const next = Math.min(MAX_RAIL_WIDTH, Math.max(MIN_RAIL_WIDTH, width + step));
          setWidth(next);
          localStorage.setItem(RAIL_WIDTH_KEY, String(next));
        }}
        className='absolute left-0 top-0 h-full w-1 shrink-0 cursor-col-resize hover:bg-accent/50'
      />
      {selectedRun ? (
        <>
          <div className='flex justify-end border-b border-border px-2 py-2'>
            <CloseButton onClick={handleClose} />
          </div>
          <div className='min-h-0 flex-1'>
            <RunDetail runId={selectedRun.id} onBack={(): void => setSelectedRun(null)} />
          </div>
        </>
      ) : (
        <>
          <div className='flex items-center gap-3 border-b border-border px-6 py-4'>
            <h1 className='flex flex-col text-sm text-foreground'>
              <span className='flex items-center gap-1.5 font-semibold'>
                <Zap className='size-4 text-amber-600 dark:text-amber-400' />
                Debug automations
              </span>
              {showIds && (
                <span className='font-mono text-[11px] text-muted-foreground'>{target.id}</span>
              )}
            </h1>
            <button
              type='button'
              onClick={(): void => setShowIds(v => !v)}
              aria-label={showIds ? 'Hide IDs' : 'Show IDs'}
              title={showIds ? 'Hide IDs' : 'Show IDs'}
              data-track-category='automation-run-debug'
              data-track-name='debug-toggle-ids'
              className='ml-auto flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/40 hover:text-foreground'
            >
              {showIds ? <EyeOff className='size-4' /> : <Eye className='size-4' />}
            </button>
            <CloseButton onClick={handleClose} />
          </div>
          <div className='flex-1 overflow-y-auto'>
            <EntityRunsView target={target} showIds={showIds} onOpenRun={setSelectedRun} />
          </div>
        </>
      )}
    </aside>
  );
}

function EntityRunsView({
  target,
  showIds,
  onOpenRun,
}: {
  target: AutomationDebugTarget;
  showIds: boolean;
  onOpenRun: (run: DebugEntityRun) => void;
}): ReactElement {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['automation-debug-runs', target.type, target.id],
    queryFn: () => fetchDebugEntityRuns(target.type, target.id, { limit: RUNS_LIMIT }),
    enabled: target.id !== '',
    refetchOnWindowFocus: false,
  });
  const { reloading, reload } = useVisibleReload(refetch);
  const runs = data?.runs ?? [];

  return (
    <div className='flex flex-col'>
      <div className='flex items-start gap-2 border-b border-border px-6 py-3'>
        <p className='flex-1 text-xs text-muted-foreground'>
          Automations that ran on {ENTITY_LABEL[target.type]}
          {showIds ? <span className='font-mono'> ({target.id})</span> : null}. Pick one to see its
          steps.
          {ENTITY_SCOPE_NOTE[target.type] ? <> {ENTITY_SCOPE_NOTE[target.type]}</> : null}
        </p>
        <button
          type='button'
          onClick={reload}
          disabled={reloading}
          aria-label='Reload runs'
          title='Reload runs'
          data-track-category='automation-run-debug'
          data-track-name='debug-reload-runs'
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/40 hover:text-foreground',
            reloading && 'opacity-60',
          )}
        >
          <RotateCw className={cn('size-3.5', reloading && 'animate-spin')} />
        </button>
      </div>
      {isError ? (
        <div className='py-12 text-center text-sm text-red-600'>
          Failed to load.
          <button
            type='button'
            onClick={(): void => void refetch()}
            data-track-category='automation-run-debug'
            data-track-name='debug-retry'
            className='ml-2 underline hover:no-underline'
          >
            Retry
          </button>
        </div>
      ) : isLoading ? (
        <div className='flex items-center justify-center py-12 text-sm text-muted-foreground'>
          <Loader2 className='mr-2 size-4 animate-spin' />
          Loading runs…
        </div>
      ) : runs.length === 0 ? (
        <div className='py-12 text-center text-sm text-muted-foreground'>
          No automations ran here.
        </div>
      ) : (
        runs.map(run => (
          <button
            key={run.id}
            type='button'
            onClick={(): void => onOpenRun(run)}
            data-track-category='automation-run-debug'
            data-track-name='debug-pick-run'
            className='flex items-center gap-3 border-b border-border px-6 py-3 text-left hover:bg-accent/30'
          >
            <StatusIcon status={run.status} />
            <div className='flex flex-1 flex-col gap-0.5'>
              <span className='text-sm font-medium text-foreground'>
                {run.automationName ?? 'Untitled automation'}
              </span>
              <span
                className={cn(
                  'mt-0.5 inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[10px] font-medium',
                  STATUS_CLASSES[run.status as AutomationRunStatus] ??
                    'border-border text-muted-foreground',
                )}
              >
                {run.status}
              </span>
            </div>
            <span className='text-[11px] text-muted-foreground'>
              {new Date(run.startedAt).toLocaleString()}
            </span>
          </button>
        ))
      )}
    </div>
  );
}

function CloseButton({ onClick }: { onClick: () => void }): ReactElement {
  return (
    <button
      type='button'
      onClick={onClick}
      aria-label='Close debugger'
      data-track-category='automation-run-debug'
      data-track-name='close-debug-sheet'
      className='flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/40 hover:text-foreground'
    >
      <X className='size-4' />
    </button>
  );
}

function StatusIcon({ status }: { status: string | null }): ReactElement {
  if (status === 'COMPLETED') return <CheckCircle2 className='size-4 text-green-600' />;
  if (status === 'FAILED') return <XCircle className='size-4 text-red-600' />;
  if (status === 'EXTERNAL_WAIT') return <Hourglass className='size-4 text-purple-600' />;
  if (status === 'SKIPPED' || status === 'CANCELLED')
    return <MinusCircle className='size-4 text-muted-foreground' />;
  return <span className='size-2.5 rounded-full bg-muted-foreground/40' />;
}
