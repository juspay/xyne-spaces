import { ReactElement, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Laptop } from 'lucide-react';
import { cn } from '@/utils/classNames';
import { useAuth } from '@/hooks/useAuth';
import type { LocalHarnessInstallation } from '@/types/electron';
import {
  clearUserAgentProvider,
  getLocalHarnessDefaultProvider,
  getUserAgentProvider,
  setUserAgentProvider,
} from '@/services/claw/localHarnessService';
import { PROVIDER_DISPLAY } from '@/services/claw/modelProviderConfig';

/** Clearing the per-agent row is how an agent follows the account-wide default. */
const INHERIT = '__inherit__';
const HOSTED = 'spaces';

/* eslint-disable @typescript-eslint/naming-convention */
// PROVIDER_DISPLAY spells these "Claude Code (this device)", which reads badly
// once the row already says "this device" — use the bare product name here.
const HARNESS_LABEL: Record<string, string> = {
  'claude-code': 'Claude Code',
  'codex-cli': 'Codex CLI',
};
/* eslint-enable @typescript-eslint/naming-convention */

const providerLabel = (provider: string): string =>
  HARNESS_LABEL[provider] ?? PROVIDER_DISPLAY[provider] ?? provider;

interface Props {
  agentSlug: string;
}

const PersonalHarnessSection = ({ agentSlug }: Props): ReactElement | null => {
  const { user } = useAuth();
  const userId = user?.id ?? '';
  const api = typeof window !== 'undefined' ? window.electronAPI?.localHarness : undefined;

  const [installations, setInstallations] = useState<LocalHarnessInstallation[]>([]);
  const [accountDefault, setAccountDefault] = useState<string | null>(null);
  const [current, setCurrent] = useState<string>(INHERIT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    if (!api || !userId) {
      setLoading(false);
      return;
    }
    try {
      const [found, config, preferred] = await Promise.all([
        api.getStatus().then(status => status.installations.filter(i => i.authenticated)),
        getUserAgentProvider(agentSlug, userId).catch(() => null),
        getLocalHarnessDefaultProvider().catch(() => null),
      ]);
      setInstallations(found);
      setAccountDefault(preferred);
      setCurrent(!config || config.inherited ? INHERIT : config.provider);
    } catch {
      setInstallations([]);
    } finally {
      setLoading(false);
    }
  }, [api, agentSlug, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!api || loading || installations.length === 0) return null;

  // With no account default, an explicit "spaces" row and no row at all route
  // identically, so they share one option rather than two rows meaning the same.
  const effective = !accountDefault && current === HOSTED ? INHERIT : current;

  const choose = async (value: string): Promise<void> => {
    if (saving || value === effective) return;
    setSaving(true);
    const previous = current;
    setCurrent(value);
    try {
      if (value === INHERIT) await clearUserAgentProvider(agentSlug, userId);
      else await setUserAgentProvider(agentSlug, userId, value);
      toast.success(
        value === INHERIT
          ? 'This agent follows your default again'
          : value === HOSTED
            ? 'Your runs of this agent stay on Xyne’s servers'
            : `Your runs of this agent will use ${providerLabel(value)}`,
      );
    } catch (err) {
      setCurrent(previous);
      toast.error(err instanceof Error ? err.message : 'Could not save your choice');
    } finally {
      setSaving(false);
    }
  };

  const options = [
    {
      value: INHERIT,
      label: accountDefault
        ? `Use my default (${providerLabel(accountDefault)})`
        : 'Workspace default',
      detail: accountDefault ? 'Set in Claw Agents → Settings.' : 'Runs on Xyne’s servers.',
    },
    ...installations.map(install => ({
      value: install.provider,
      label: providerLabel(install.provider),
      detail: install.version ? `${install.version} · this device` : 'this device',
    })),
    ...(accountDefault
      ? [{ value: HOSTED, label: 'Xyne’s servers', detail: 'Ignore my default for this agent.' }]
      : []),
  ];

  // A provider picked on another surface (a personal Anthropic/Codex key, a
  // harness that has since been disconnected) still has to render as THE
  // selection — otherwise this list would show "inherit" and one stray click
  // would clear a setting the user never touched here.
  if (effective !== INHERIT && !options.some(option => option.value === effective)) {
    options.push({
      value: effective,
      label: providerLabel(effective),
      detail: 'your current pick for this agent',
    });
  }

  return (
    <section className='flex max-w-2xl flex-col gap-3'>
      <div className='flex flex-col gap-0.5'>
        <div className='flex items-center gap-2'>
          <Laptop className='size-4 text-muted-foreground' />
          <h2 className='text-sm font-semibold text-foreground'>Run this agent on my machine</h2>
        </div>
        <p className='text-xs text-muted-foreground'>
          Applies to your runs only — it doesn’t change the agent for anyone else.
        </p>
      </div>

      <div
        className='flex flex-col'
        role='radiogroup'
        aria-label='Where your runs of this agent go'
      >
        {options.map((option, i) => {
          const selected = option.value === effective;
          return (
            <button
              key={option.value}
              type='button'
              role='radio'
              aria-checked={selected}
              disabled={saving}
              onClick={() => void choose(option.value)}
              data-track-category='Claw Agents'
              data-track-name={`Personal provider: ${option.value}`}
              className={cn(
                'flex items-center gap-3 py-2.5 text-left transition-opacity disabled:opacity-60',
                i > 0 && 'border-t border-border',
              )}
            >
              <span
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors',
                  selected ? 'border-foreground' : 'border-border',
                )}
              >
                {selected && <span className='size-1.5 rounded-full bg-foreground' />}
              </span>
              <span className='flex min-w-0 flex-1 items-baseline gap-2'>
                <span className='text-sm text-foreground'>{option.label}</span>
                <span className='truncate text-xs text-muted-foreground'>{option.detail}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
};

export default PersonalHarnessSection;
