import { ReactElement, useCallback, useEffect, useState } from 'react';
import { Laptop, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/utils/classNames';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import type { LocalHarnessInstallation, LocalHarnessStatus } from '@/types/electron';

/* eslint-disable @typescript-eslint/naming-convention */
const HARNESS_LABEL: Record<LocalHarnessInstallation['provider'], string> = {
  'claude-code': 'Claude Code',
  'codex-cli': 'Codex CLI',
};

const INSTALL_HINT: Record<LocalHarnessInstallation['provider'], string> = {
  'claude-code': 'npm i -g @anthropic-ai/claude-code, then run `claude` once to sign in.',
  'codex-cli': 'npm i -g @openai/codex, then run `codex` once to sign in.',
};
/* eslint-enable @typescript-eslint/naming-convention */

const InstallationRow = ({ install }: { install: LocalHarnessInstallation }): ReactElement => (
  <div className='flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2'>
    <div className='min-w-0'>
      <div className='flex items-center gap-2'>
        <span className='text-sm font-medium text-foreground'>
          {HARNESS_LABEL[install.provider]}
        </span>
        {install.version && (
          <span className='truncate text-xs text-muted-foreground'>{install.version}</span>
        )}
      </div>
      <p className='truncate font-mono text-xs text-muted-foreground'>{install.binaryPath}</p>
    </div>
    {install.authenticated ? (
      <Badge variant='secondary'>Available</Badge>
    ) : (
      <Badge variant='secondary'>Not signed in</Badge>
    )}
  </div>
);

const LocalHarnessSection = (): ReactElement | null => {
  const api = typeof window !== 'undefined' ? window.electronAPI?.localHarness : undefined;

  const [status, setStatus] = useState<LocalHarnessStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    if (!api) {
      setLoading(false);
      return;
    }
    try {
      setStatus(await api.getStatus());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to read local harness status');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const rescan = async (): Promise<void> => {
    if (!api || busy) return;
    setBusy(true);
    try {
      await api.detect();
      await load();
      toast.success('Rescanned for local harnesses');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Rescan failed');
    } finally {
      setBusy(false);
    }
  };

  const toggleConnection = async (): Promise<void> => {
    if (!api || busy) return;
    setBusy(true);
    try {
      const next = status?.connected ? await api.disconnect() : await api.connect();
      setStatus(next);
      toast.success(
        next.connected ? 'This device is now connected' : 'This device was disconnected',
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update connection');
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <div className='mb-4'>
      <div className='flex items-center gap-2'>
        <Laptop className='size-4 text-muted-foreground' />
        <h2 className='text-sm font-semibold text-foreground'>Local harness</h2>
      </div>
      <p className='mt-0.5 text-sm text-muted-foreground'>
        Run agents on the Claude Code or Codex CLI installed on this machine, using your own login.
        Tools, permissions, and approvals stay on Xyne’s servers.
      </p>
    </div>
  );

  if (!api) return null;

  if (loading) {
    return (
      <section data-testid='claw-settings-local-harness'>
        {header}
        <Skeleton className='h-40 rounded-2xl' />
      </section>
    );
  }

  if (!status?.supported) return null;

  const installations = status?.installations ?? [];
  const usable = installations.filter(i => i.authenticated);
  const connected = status?.connected ?? false;

  return (
    <section data-testid='claw-settings-local-harness'>
      {header}

      <div
        className={cn(
          'flex flex-col gap-4 rounded-2xl border p-4 transition-colors',
          connected ? 'border-emerald-500/25 bg-emerald-500/5' : 'border-border bg-muted/40',
        )}
      >
        <div className='flex items-start justify-between gap-3'>
          <div className='min-w-0'>
            <div className='flex items-center gap-2'>
              <h3 className='truncate text-sm font-semibold text-foreground'>
                {status?.deviceName ?? 'This device'}
              </h3>
              {connected && (
                <Badge variant='success' className='gap-1'>
                  <span className='size-1.5 rounded-full bg-white' />
                  Connected
                </Badge>
              )}
            </div>
            <p className='text-xs text-muted-foreground'>
              {connected
                ? 'Agents set to a local harness will run here while the app is open.'
                : 'Connect to let agents run on this machine.'}
            </p>
          </div>
          <button
            type='button'
            onClick={() => void rescan()}
            disabled={busy}
            data-track-category='Claw Settings'
            data-track-name='Rescan local harnesses'
            aria-label='Rescan for local harnesses'
            className='flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40'
          >
            <RefreshCw className={cn('size-4', busy && 'animate-spin')} />
          </button>
        </div>

        {installations.length === 0 ? (
          <div className='rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground'>
            <p>No local harness found on this machine.</p>
            <ul className='mt-2 space-y-1 text-xs'>
              <li>Claude Code — {INSTALL_HINT['claude-code']}</li>
              <li>Codex CLI — {INSTALL_HINT['codex-cli']}</li>
            </ul>
          </div>
        ) : (
          <div className='flex flex-col gap-2'>
            {installations.map(install => (
              <InstallationRow key={install.provider} install={install} />
            ))}
          </div>
        )}

        {status?.lastError && (
          <p className='rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive'>
            {status.lastError}
          </p>
        )}

        <div className='flex items-center justify-between gap-3'>
          <span className='text-xs text-muted-foreground'>
            {!connected
              ? usable.length > 0
                ? `${usable.length} harness${usable.length === 1 ? '' : 'es'} ready to pair.`
                : 'Sign in to a harness CLI before connecting.'
              : 'Pick which harness an agent uses in its Model & Provider tab — this card only pairs the machine.'}
          </span>
          <Button
            size='sm'
            variant={connected ? 'secondary' : 'default'}
            loading={busy}
            disabled={busy || (!connected && usable.length === 0)}
            onClick={() => void toggleConnection()}
          >
            {connected ? 'Disconnect' : 'Connect this device'}
          </Button>
        </div>
      </div>
    </section>
  );
};

export default LocalHarnessSection;
