import React, { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { cn } from '../../utils/classNames';
import type { LocalHarnessInstallation } from '../../types/electron';
import { findDefaultAgent, setUserAgentProvider } from '../../services/claw/localHarnessService';

/* eslint-disable @typescript-eslint/naming-convention */
const HARNESS_LABEL: Record<LocalHarnessInstallation['provider'], string> = {
  'claude-code': 'Claude Code',
  'codex-cli': 'Codex CLI',
};
/* eslint-enable @typescript-eslint/naming-convention */

const PLATFORM_NOUN: Record<string, string> = {
  darwin: 'Mac',
  win32: 'PC',
  linux: 'machine',
};

function tildify(binaryPath: string): string {
  const match = /^(\/Users\/[^/]+|\/home\/[^/]+|[A-Z]:\\Users\\[^\\]+)(.*)$/.exec(binaryPath);
  return match ? `~${match[2]}` : binaryPath;
}

function machineLabel(deviceName: string): string {
  return deviceName.replace(/\s*\([^)]*\)\s*$/, '').trim() || 'This machine';
}

type Phase = 'idle' | 'connecting' | 'connected';

interface Props {
  installations: LocalHarnessInstallation[];
  userId: string;
  onNext: () => void;
}

const LocalHarnessOnboardingStep: React.FC<Props> = ({ installations, userId, onNext }) => {
  const [selected, setSelected] = useState<LocalHarnessInstallation['provider']>(
    installations[0]?.provider ?? 'claude-code',
  );
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [wiredAgent, setWiredAgent] = useState<string | null>(null);
  const [machine, setMachine] = useState({ name: 'This machine', platform: '' });

  useEffect(() => {
    const api = window.electronAPI?.localHarness;
    if (!api) return;
    let cancelled = false;
    void api
      .getStatus()
      .then(s => {
        if (!cancelled) setMachine({ name: machineLabel(s.deviceName), platform: s.platform });
      })
      .catch(() => {});
    return (): void => {
      cancelled = true;
    };
  }, []);

  const noun = PLATFORM_NOUN[machine.platform] ?? 'machine';
  const busy = phase === 'connecting';
  const single = installations.length === 1;
  /* eslint-disable @typescript-eslint/naming-convention */
  const groupRole = single ? {} : { role: 'radiogroup', 'aria-label': 'Which CLI to use' };
  const radioProps = (checked: boolean): Record<string, unknown> => ({
    role: 'radio',
    'aria-checked': checked,
  });
  /* eslint-enable @typescript-eslint/naming-convention */

  const connect = async (): Promise<void> => {
    const api = window.electronAPI?.localHarness;
    if (!api || busy) return;
    setPhase('connecting');
    setError(null);
    try {
      await api.connect();

      const agent = await findDefaultAgent(userId).catch(() => null);
      if (agent) {
        await setUserAgentProvider(agent.slug, userId, selected);
        setWiredAgent(agent.name);
      }

      setPhase('connected');
      setTimeout(onNext, 1400);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect this device');
      setPhase('idle');
    }
  };

  return (
    <div className='w-full h-screen flex items-center justify-center bg-background px-6'>
      <div className='flex w-full max-w-lg flex-col gap-10 opacity-0 translate-y-6 animate-[fadeUp_.6s_ease-out_forwards] motion-reduce:animate-none motion-reduce:opacity-100 motion-reduce:translate-y-0'>
        <header className='flex flex-col gap-3'>
          <h2 className='text-3xl font-medium leading-tight text-foreground'>
            This {noun} can run your agents
          </h2>
          <p className='text-sm leading-relaxed text-muted-foreground'>
            {installations.length === 1
              ? `${HARNESS_LABEL[installations[0]!.provider]} is signed in here.`
              : 'Two coding CLIs are signed in here.'}{' '}
            Connect and your agents think on this {noun}, on your own plan. Tools, permissions and
            approvals stay in Xyne.
          </p>
        </header>

        <div className='flex flex-col gap-3'>
          <div className='relative flex items-center' aria-hidden='true'>
            <span
              className={cn(
                'size-2.5 shrink-0 rounded-full transition-colors duration-500',
                phase === 'connected' ? 'bg-emerald-500' : 'bg-foreground',
              )}
            />
            <div className='relative mx-2 h-px flex-1'>
              <div
                className={cn(
                  'absolute inset-0 transition-opacity duration-500',
                  phase === 'connected'
                    ? 'bg-emerald-500/40'
                    : 'bg-[linear-gradient(90deg,currentColor_50%,transparent_50%)] bg-[length:6px_1px] text-border',
                )}
              />
              {busy && (
                <span className='absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground animate-[railTravel_1.1s_ease-in-out_infinite] motion-reduce:hidden' />
              )}
            </div>
            <span
              className={cn(
                'flex size-2.5 shrink-0 items-center justify-center rounded-full border transition-colors duration-500',
                phase === 'connected'
                  ? 'border-emerald-500 bg-emerald-500'
                  : 'border-border bg-transparent',
              )}
            />
          </div>
          <div className='flex items-baseline justify-between text-xs'>
            <span className='truncate pr-4 font-medium text-foreground'>{machine.name}</span>
            <span className='shrink-0 text-muted-foreground'>Xyne Spaces</span>
          </div>
        </div>

        <div className='flex flex-col' {...groupRole}>
          {installations.map((install, i) => {
            const isSelected = install.provider === selected;
            const Row = single ? 'div' : 'button';
            return (
              <Row
                key={install.provider}
                {...(single
                  ? {}
                  : {
                      type: 'button' as const,
                      disabled: busy,
                      onClick: () => setSelected(install.provider),
                      ...radioProps(isSelected),
                      'data-track-category': 'Onboarding',
                      'data-track-name': `Select local harness: ${install.provider}`,
                    })}
                className={cn(
                  'flex items-center gap-3 py-3 text-left transition-opacity',
                  i > 0 && 'border-t border-border',
                  !single &&
                    'cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground',
                  !single && !isSelected && 'opacity-45 hover:opacity-80',
                  busy && 'pointer-events-none',
                )}
              >
                {!single && (
                  <span
                    className={cn(
                      'flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors',
                      isSelected ? 'border-foreground' : 'border-border',
                    )}
                  >
                    {isSelected && <span className='size-1.5 rounded-full bg-foreground' />}
                  </span>
                )}
                <span className='flex min-w-0 flex-1 flex-col gap-0.5'>
                  <span className='flex items-baseline gap-2'>
                    <span className='text-sm font-medium text-foreground'>
                      {HARNESS_LABEL[install.provider]}
                    </span>
                    {install.version && (
                      <span className='truncate text-xs text-muted-foreground'>
                        {install.version}
                      </span>
                    )}
                  </span>
                  <span className='truncate font-mono text-xs text-muted-foreground'>
                    {tildify(install.binaryPath)}
                  </span>
                </span>
                <span className='flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground'>
                  <span className='size-1.5 rounded-full bg-emerald-500' />
                  Signed in
                </span>
              </Row>
            );
          })}
        </div>

        {error && (
          <p role='alert' className='text-sm text-red-600'>
            {error}
          </p>
        )}

        {phase === 'connected' ? (
          <p className='flex items-start gap-2 text-sm text-foreground'>
            <Check className='mt-0.5 size-4 shrink-0 text-emerald-600' strokeWidth={2.5} />
            {wiredAgent ? (
              <span>
                Connected. <span className='font-medium'>{wiredAgent}</span> will run on this {noun}
                .
              </span>
            ) : (
              <span>
                Connected. Open any agent and pick &ldquo;Run this agent on my machine&rdquo; under
                Model &amp; Provider.
              </span>
            )}
          </p>
        ) : (
          <div className='flex items-center gap-6'>
            <button
              type='button'
              onClick={() => void connect()}
              disabled={busy}
              data-track-category='Onboarding'
              data-track-name='Connect local harness'
              className='rounded-full bg-foreground px-6 py-3 text-sm font-medium text-background transition hover:opacity-90 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:opacity-50 motion-reduce:active:scale-100'
            >
              {busy ? 'Connecting…' : `Connect this ${noun}`}
            </button>
            <button
              type='button'
              onClick={onNext}
              disabled={busy}
              data-track-category='Onboarding'
              data-track-name='Skip local harness'
              className='text-sm text-muted-foreground underline-offset-4 transition hover:text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:opacity-50'
            >
              Not now
            </button>
          </div>
        )}

        <p className='text-xs text-muted-foreground'>
          Change this any time in Claw Agents → Settings.
        </p>
      </div>
    </div>
  );
};

export default LocalHarnessOnboardingStep;
