import { ReactElement, useCallback, useEffect, useState } from 'react';
import { Code2, Laptop, RefreshCw, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/utils/classNames';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Switch } from '@/components/ui/Switch';
import { Skeleton } from '@/components/ui/Skeleton';
import type { LocalHarnessInstallation, LocalHarnessStatus } from '@/types/electron';
import {
  getLocalHarnessDefaultProvider,
  setLocalHarnessDefaultProvider,
} from '@/services/claw/localHarnessService';

type HarnessProvider = LocalHarnessInstallation['provider'];

/* eslint-disable @typescript-eslint/naming-convention */
const HARNESS_META: Record<
  HarnessProvider,
  { name: string; description: string; icon: typeof Sparkles; install: string }
> = {
  'claude-code': {
    name: 'Claude Code',
    description: 'Runs on your own Claude login',
    icon: Sparkles,
    install: 'npm i -g @anthropic-ai/claude-code, then run `claude` once to sign in.',
  },
  'codex-cli': {
    name: 'Codex CLI',
    description: 'Runs on your own OpenAI login',
    icon: Code2,
    install: 'npm i -g @openai/codex, then run `codex` once to sign in.',
  },
};
/* eslint-enable @typescript-eslint/naming-convention */

const HARNESS_ORDER: HarnessProvider[] = ['claude-code', 'codex-cli'];

const errText = (err: unknown, fallback: string): string =>
  err instanceof Error ? err.message : fallback;

const HarnessCard = ({
  provider,
  install,
  isDefault,
  busy,
  locked,
  onToggleConnected,
  onToggleDefault,
}: {
  provider: HarnessProvider;
  install: LocalHarnessInstallation | undefined;
  isDefault: boolean;
  busy: boolean;
  locked: boolean;
  onToggleConnected: () => void;
  onToggleDefault: (next: boolean) => void;
}): ReactElement => {
  const meta = HARNESS_META[provider];
  const Icon = meta.icon;
  const connected = install?.enabled === true;
  const signedIn = install?.authenticated === true;

  return (
    <div
      data-testid={`claw-settings-harness-${provider}`}
      className={cn(
        'flex min-h-40 flex-col gap-3 rounded-2xl border p-4 transition-colors',
        connected ? 'border-emerald-500/25 bg-emerald-500/5' : 'border-border bg-muted/40',
      )}
    >
      <div className='flex items-start justify-between gap-3'>
        <div className='flex min-w-0 items-center gap-3'>
          <div
            className={cn(
              'flex size-10 shrink-0 items-center justify-center rounded-lg',
              connected
                ? 'bg-emerald-500/10 text-emerald-600'
                : 'bg-background text-muted-foreground',
            )}
          >
            <Icon className='size-5' />
          </div>
          <div className='min-w-0'>
            <div className='flex min-w-0 items-center gap-2'>
              <h3 className='truncate text-sm font-semibold text-foreground'>{meta.name}</h3>
              {install?.version && (
                <span className='truncate text-xs text-muted-foreground'>{install.version}</span>
              )}
            </div>
            <p className='truncate text-xs text-muted-foreground'>{meta.description}</p>
          </div>
        </div>
        {connected && (
          <Badge variant='success' className='gap-1'>
            <span className='size-1.5 rounded-full bg-white' />
            Connected
          </Badge>
        )}
      </div>

      {!install ? (
        <p className='text-xs text-muted-foreground'>Not installed — {meta.install}</p>
      ) : !signedIn ? (
        <p className='text-xs text-muted-foreground'>
          Found at <span className='font-mono'>{install.binaryPath}</span>, but not signed in. Run
          it once in your terminal to log in.
        </p>
      ) : (
        <p className='truncate font-mono text-xs text-muted-foreground'>{install.binaryPath}</p>
      )}

      {connected && (
        <div className='flex items-center justify-between gap-3 rounded-lg border border-border bg-background/60 px-3 py-2'>
          <div className='min-w-0'>
            <p className='text-xs font-medium text-foreground'>Use for all my agents</p>
            <p className='text-xs text-muted-foreground'>
              Every agent runs here unless you pick something else for it.
            </p>
          </div>
          <Switch
            checked={isDefault}
            disabled={locked}
            onCheckedChange={onToggleDefault}
            aria-label={`Use ${meta.name} for all my agents`}
          />
        </div>
      )}

      <div className='mt-auto flex justify-end'>
        <Button
          size='sm'
          variant={connected ? 'secondary' : 'default'}
          loading={busy}
          disabled={locked || !signedIn}
          onClick={onToggleConnected}
          data-track-category='Claw Settings'
          data-track-name={`${connected ? 'Disconnect' : 'Connect'} local harness: ${provider}`}
        >
          {connected ? 'Disconnect' : 'Connect'}
        </Button>
      </div>
    </div>
  );
};

const LocalHarnessSection = (): ReactElement | null => {
  const api = typeof window !== 'undefined' ? window.electronAPI?.localHarness : undefined;

  const [status, setStatus] = useState<LocalHarnessStatus | null>(null);
  const [defaultProvider, setDefaultProvider] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (!api) {
      setLoading(false);
      return;
    }
    try {
      const [next, preferred] = await Promise.all([
        api.getStatus(),
        getLocalHarnessDefaultProvider().catch(() => null),
      ]);
      setStatus(next);
      setDefaultProvider(preferred);
    } catch (err) {
      toast.error(errText(err, 'Failed to read local harness status'));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const rescan = async (): Promise<void> => {
    if (!api || busy) return;
    setBusy('rescan');
    try {
      await api.detect();
      await load();
      toast.success('Rescanned this machine');
    } catch (err) {
      toast.error(errText(err, 'Rescan failed'));
    } finally {
      setBusy(null);
    }
  };

  const toggleConnected = async (provider: HarnessProvider, connect: boolean): Promise<void> => {
    if (!api || busy) return;
    setBusy(provider);
    try {
      setStatus(await api.setProviderEnabled(provider, connect));
      // A harness you just disconnected can't stay the default for every agent.
      if (!connect && defaultProvider === provider) {
        setDefaultProvider(await setLocalHarnessDefaultProvider(null));
      }
      toast.success(
        connect
          ? `${HARNESS_META[provider].name} is connected on this device`
          : `${HARNESS_META[provider].name} was disconnected`,
      );
    } catch (err) {
      toast.error(errText(err, 'Could not update this harness'));
    } finally {
      setBusy(null);
    }
  };

  const toggleDefault = async (provider: HarnessProvider, next: boolean): Promise<void> => {
    if (busy) return;
    const previous = defaultProvider;
    setBusy(`default:${provider}`);
    setDefaultProvider(next ? provider : null);
    try {
      await setLocalHarnessDefaultProvider(next ? provider : null);
      toast.success(
        next
          ? `All your agents will run on ${HARNESS_META[provider].name}`
          : 'Your agents use the workspace default again',
      );
    } catch (err) {
      setDefaultProvider(previous);
      toast.error(errText(err, 'Could not save your default harness'));
    } finally {
      setBusy(null);
    }
  };

  const header = (
    <div className='mb-4'>
      <div className='flex items-center gap-2'>
        <Laptop className='size-4 text-muted-foreground' />
        <h2 className='text-sm font-semibold text-foreground'>Local harness</h2>
      </div>
      <p className='mt-0.5 text-sm text-muted-foreground'>
        Connect the coding CLIs installed on this machine and run agents on your own login. Tools,
        permissions and approvals still run on Xyne’s servers — only the model runs here.
      </p>
    </div>
  );

  if (!api) return null;

  if (loading) {
    return (
      <section data-testid='claw-settings-local-harness'>
        {header}
        <div className='grid gap-3 sm:grid-cols-2'>
          <Skeleton className='h-40 rounded-2xl' />
          <Skeleton className='h-40 rounded-2xl' />
        </div>
      </section>
    );
  }

  if (!status?.supported) return null;

  const byProvider = new Map(status.installations.map(install => [install.provider, install]));

  return (
    <section data-testid='claw-settings-local-harness'>
      {header}

      <div className='mb-3 flex items-center justify-between gap-3'>
        <p className='truncate text-xs text-muted-foreground'>
          This device: <span className='font-medium text-foreground'>{status.deviceName}</span>
        </p>
        <button
          type='button'
          onClick={() => void rescan()}
          disabled={busy !== null}
          data-track-category='Claw Settings'
          data-track-name='Rescan local harnesses'
          aria-label='Rescan this machine for coding CLIs'
          className='flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40'
        >
          <RefreshCw className={cn('size-4', busy === 'rescan' && 'animate-spin')} />
        </button>
      </div>

      <div className='grid gap-3 sm:grid-cols-2'>
        {HARNESS_ORDER.map(provider => {
          const install = byProvider.get(provider);
          return (
            <HarnessCard
              key={provider}
              provider={provider}
              install={install}
              isDefault={defaultProvider === provider}
              busy={busy === provider}
              locked={busy !== null}
              onToggleConnected={() => void toggleConnected(provider, install?.enabled !== true)}
              onToggleDefault={next => void toggleDefault(provider, next)}
            />
          );
        })}
      </div>

      {status.lastError && (
        <p className='mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive'>
          {status.lastError}
        </p>
      )}
    </section>
  );
};

export default LocalHarnessSection;
