import { ReactElement, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Laptop } from 'lucide-react';
import { cn } from '@/utils/classNames';
import { useAuth } from '@/hooks/useAuth';
import type { LocalHarnessInstallation } from '@/types/electron';
import {
  clearUserAgentProvider,
  getUserAgentProvider,
  setUserAgentProvider,
} from '@/services/claw/localHarnessService';
import { isLocalHarnessProvider, PROVIDER_DISPLAY } from '@/services/claw/modelProviderConfig';

const WORKSPACE_DEFAULT = 'spaces';

interface Props {
  agentSlug: string;
}

const PersonalHarnessSection = ({ agentSlug }: Props): ReactElement | null => {
  const { user } = useAuth();
  const userId = user?.id ?? '';
  const api = typeof window !== 'undefined' ? window.electronAPI?.localHarness : undefined;

  const [installations, setInstallations] = useState<LocalHarnessInstallation[]>([]);
  const [current, setCurrent] = useState<string>(WORKSPACE_DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    if (!api || !userId) {
      setLoading(false);
      return;
    }
    try {
      const [found, provider] = await Promise.all([
        api.getStatus().then(s => s.installations.filter(i => i.authenticated)),
        getUserAgentProvider(agentSlug, userId).catch(() => WORKSPACE_DEFAULT),
      ]);
      setInstallations(found);
      setCurrent(provider || WORKSPACE_DEFAULT);
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

  const choose = async (value: string): Promise<void> => {
    if (saving || value === current) return;
    setSaving(true);
    const previous = current;
    setCurrent(value);
    try {
      if (value === WORKSPACE_DEFAULT) await clearUserAgentProvider(agentSlug, userId);
      else await setUserAgentProvider(agentSlug, userId, value);
      toast.success(
        value === WORKSPACE_DEFAULT
          ? 'Your runs use the workspace default again'
          : `Your runs of this agent will use ${PROVIDER_DISPLAY[value] ?? value}`,
      );
    } catch (err) {
      setCurrent(previous);
      toast.error(err instanceof Error ? err.message : 'Could not save your choice');
    } finally {
      setSaving(false);
    }
  };

  const options = [
    { value: WORKSPACE_DEFAULT, label: 'Workspace default', detail: 'Runs on Xyne’s servers.' },
    ...installations.map(i => ({
      value: i.provider,
      label: PROVIDER_DISPLAY[i.provider] ?? i.provider,
      detail: i.version ? `${i.version} · this device` : 'this device',
    })),
  ];

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

      <div className='flex flex-col'>
        {options.map((option, i) => {
          const selected =
            option.value === current || (i === 0 && !isLocalHarnessProvider(current));
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
