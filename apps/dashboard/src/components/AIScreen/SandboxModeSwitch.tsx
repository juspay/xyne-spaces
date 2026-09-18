import { useCallback, useEffect, useState } from 'react';
import { Check, ChevronDown, Cloud, Laptop, Box } from 'lucide-react';
import { Popover } from '../ui/Popover';
import { cn } from '../../utils/classNames';

export type SandboxMode = 'remote' | 'local' | 'container';

export const SANDBOX_MODE_STORAGE_KEY = 'xyne:ai-sandbox-mode';

const SANDBOX_MODE_OPTIONS: Array<{
  value: SandboxMode;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  {
    value: 'remote',
    label: 'Remote sandbox',
    shortLabel: 'Remote',
    description: "Runs /design, /dashboard and /spec in Xyne's cloud sandbox",
  },
  {
    value: 'local',
    label: 'Local sandbox',
    shortLabel: 'Local',
    description:
      'Runs them on this computer through your Codex/Claude CLI; files stay in the app workspace',
  },
  {
    value: 'container',
    label: 'Container sandbox',
    shortLabel: 'Container',
    description:
      'Runs commands inside an isolated Podman container on this computer; nothing touches the host, so no approvals are needed',
  },
];

export function readStoredSandboxMode(): SandboxMode {
  try {
    const raw = window.localStorage.getItem(SANDBOX_MODE_STORAGE_KEY);
    return raw === 'local' || raw === 'container' ? raw : 'remote';
  } catch {
    return 'remote';
  }
}

export function writeStoredSandboxMode(mode: SandboxMode): void {
  try {
    window.localStorage.setItem(SANDBOX_MODE_STORAGE_KEY, mode);
  } catch {
    /* empty */
  }
}

export function useSandboxMode(): [SandboxMode, (mode: SandboxMode) => void] {
  const [mode, setMode] = useState<SandboxMode>(() => readStoredSandboxMode());
  useEffect(() => {
    writeStoredSandboxMode(mode);
  }, [mode]);
  return [mode, setMode];
}

export function SandboxModeSwitch({
  mode,
  onModeChange,
  disabled,
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
}: {
  mode: SandboxMode;
  onModeChange: (mode: SandboxMode) => void;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (isControlled) onOpenChange?.(next);
      else setUncontrolledOpen(next);
    },
    [isControlled, onOpenChange],
  );

  const [containerStatus, setContainerStatus] = useState<{
    available: boolean;
    reason?: string;
  } | null>(null);
  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.electronAPI?.localHarness : undefined;
    if (!api?.getStatus) return;
    let alive = true;
    void api.getStatus().then(
      status => {
        if (alive) setContainerStatus(status.containerRuntime ?? null);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [open]);

  const active = SANDBOX_MODE_OPTIONS.find(o => o.value === mode) ?? SANDBOX_MODE_OPTIONS[0]!;
  const Icon = mode === 'local' ? Laptop : mode === 'container' ? Box : Cloud;
  const containerUnavailable = !!containerStatus && !containerStatus.available;

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align='end'
      sideOffset={4}
      trigger={
        hideTrigger ? (
          <span aria-hidden className='block h-0 w-0' />
        ) : (
          <button
            type='button'
            disabled={disabled}
            title={active.description}
            aria-label='Sandbox location'
            data-track-category='XyneAI'
            data-track-name='OPEN_SANDBOX_MODE_SELECTOR'
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-lg border border-border px-2 text-sm transition-colors',
              disabled ? 'cursor-not-allowed opacity-60' : 'hover:bg-accent cursor-pointer',
            )}
          >
            <Icon
              className={cn(
                'h-3.5 w-3.5 shrink-0',
                mode === 'container' && containerUnavailable ? 'text-amber-500' : 'text-primary',
              )}
              aria-hidden
              strokeWidth={1.75}
            />
            <span className='min-w-0 truncate font-medium text-foreground'>
              <span className='hidden sm:inline'>{active.label}</span>
              <span className='sm:hidden'>{active.shortLabel}</span>
            </span>
            <ChevronDown className='h-3 w-3 shrink-0 text-muted-foreground' aria-hidden />
          </button>
        )
      }
      className='w-72 p-0 bg-popover border border-border rounded-lg shadow-lg overflow-visible'
    >
      <div className='flex flex-col py-1 px-1'>
        {SANDBOX_MODE_OPTIONS.map(option => {
          const OptionIcon =
            option.value === 'local' ? Laptop : option.value === 'container' ? Box : Cloud;
          const selected = option.value === mode;
          return (
            <button
              key={option.value}
              type='button'
              title={option.description}
              onClick={() => {
                onModeChange(option.value);
                setOpen(false);
              }}
              data-track-category='XyneAI'
              data-track-name='SELECT_SANDBOX_MODE'
              data-track-metadata={JSON.stringify({ sandboxMode: option.value })}
              className={cn(
                'flex w-full items-start justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors',
                selected ? 'bg-primary/10 text-primary' : 'hover:bg-accent text-foreground',
              )}
            >
              <span className='flex items-start gap-1.5 min-w-0'>
                <OptionIcon
                  className='mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground'
                  aria-hidden
                  strokeWidth={1.75}
                />
                <span className='flex flex-col items-start gap-0.5 min-w-0'>
                  <span className='font-medium'>{option.label}</span>
                  <span className='text-[11px] text-muted-foreground'>{option.description}</span>
                  {option.value === 'container' && containerUnavailable && (
                    <span className='text-[11px] text-amber-600 dark:text-amber-400'>
                      {containerStatus?.reason ?? 'Podman is not available on this device.'}
                    </span>
                  )}
                </span>
              </span>
              {selected && <Check className='mt-0.5 h-3.5 w-3.5 shrink-0' aria-hidden />}
            </button>
          );
        })}
      </div>
    </Popover>
  );
}
