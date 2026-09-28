import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { toast } from 'sonner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select/index';
import { useAuth } from '@/hooks/useAuth';
import {
  clearUserAgentProvider,
  getLocalHarnessDefaultProvider,
  getUserAgentProvider,
  setUserAgentProvider,
} from '@/services/claw/localHarnessService';
import { clawErrorText } from '@/services/claw/clawRequest';
import { PROVIDER_DISPLAY } from '@/services/claw/modelProviderConfig';
import type { LocalHarnessInstallation } from '@/types/electron';
import {
  DetailCard,
  DetailRow,
  DetailSection,
} from '../../../../shared/primitives/DetailPrimitives';

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

/**
 * Per-user, per-agent override for where *my* runs of this agent go — distinct
 * from the agent-level provider order in {@link ModelCard}, which is the same
 * for everyone who runs it. Only renders when the viewer's Electron app has at
 * least one authenticated local harness installed.
 */
export function PersonalHarnessSection({ agentSlug }: { agentSlug: string }): ReactElement | null {
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
      toast.error(clawErrorText(err, 'Could not save your choice'));
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
    },
    ...installations.map(install => ({
      value: install.provider,
      label: `${providerLabel(install.provider)} — this device`,
    })),
    ...(accountDefault
      ? [{ value: HOSTED, label: "Xyne's servers (ignore my default for this agent)" }]
      : []),
  ];

  // A provider picked on another surface (a personal key, a harness that has
  // since been disconnected) still has to render as THE selection — otherwise
  // this list would show "inherit" and one stray click would clear a setting
  // the user never touched here.
  if (effective !== INHERIT && !options.some(option => option.value === effective)) {
    options.push({ value: effective, label: `${providerLabel(effective)} (current pick)` });
  }

  return (
    <DetailSection
      label='Run this agent on my machine'
      info='Applies to your runs only — it does not change the agent for anyone else.'
    >
      <DetailCard>
        <DetailRow title='Where your runs go' last>
          <Select value={effective} onValueChange={v => void choose(v)}>
            <SelectTrigger
              size='sm'
              aria-label='Where your runs of this agent go'
              disabled={saving}
              data-track-category='Claw Agents'
              data-track-name='Agent detail v2: set personal harness'
              className='h-9 w-auto min-w-0 max-w-[260px] gap-2 rounded-[10px]'
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align='end'>
              {options.map(option => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </DetailRow>
      </DetailCard>
    </DetailSection>
  );
}

export default PersonalHarnessSection;
