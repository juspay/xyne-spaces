import { ReactElement, ReactNode, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { cn } from '@/utils/classNames';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select';
import { clawAgentDetailKey } from '@/hooks/useClawAgentDetail';
import { updateClawAgent } from '@/services/claw/clawAuthAgentsService';
import {
  ALL_PROVIDERS,
  applyModelProvider,
  EMPTY_MODEL_PROVIDER_DRAFT,
  isLocalHarnessProvider,
  LOCAL_HARNESS_MODEL_OPTIONS,
  modelProviderDirty,
  PROVIDER_DISPLAY,
  readModelProviderDraft,
  THINKING_OPTIONS,
  validateModelProvider,
  type LocalHarnessProviderKey,
  type ModelProviderDraft,
} from '@/services/claw/modelProviderConfig';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';
import { isLocalHarnessAvailable } from '@/config';
import PersonalHarnessSection from './PersonalHarnessSection';

interface ModelProviderTabProps {
  agent: Agent;
  isActualOwner: boolean;
}

// Radix <Select.Item> forbids an empty-string value (it's reserved for
// "cleared"). THINKING_OPTIONS uses '' to mean "platform default", so we swap
// it for this sentinel at the UI boundary and map back to '' on change.
const THINKING_DEFAULT = '__default__';

const MODEL_DEFAULT = '__cli_default__';

const MODEL_CUSTOM = '__custom__';

const Section = ({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}): ReactElement => (
  <section className='flex flex-col gap-3'>
    <div className='flex flex-col gap-0.5'>
      <h2 className='text-sm font-semibold text-foreground'>{title}</h2>
      {description && <p className='text-xs text-muted-foreground'>{description}</p>}
    </div>
    {children}
  </section>
);

const RadioOption = ({
  selected,
  onSelect,
  title,
  description,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  description: string;
}): ReactElement => (
  <button
    type='button'
    onClick={onSelect}
    data-track-category='Claw Agents'
    data-track-name={`Select model provider option: ${title}`}
    className={cn(
      'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors',
      selected ? 'border-primary bg-muted/40' : 'border-border hover:bg-muted/40',
    )}
  >
    <span
      className={cn(
        'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
        selected ? 'border-primary' : 'border-muted-foreground',
      )}
    >
      {selected && <span className='size-2 rounded-full bg-primary' />}
    </span>
    <span className='flex flex-col gap-0.5'>
      <span className='text-sm font-medium text-foreground'>{title}</span>
      <span className='text-xs text-muted-foreground'>{description}</span>
    </span>
  </button>
);

const iconBtn =
  'flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40';

/**
 * Model & Provider tab — owner-only. Configures the agent's provider preference
 * order, upgrade policy, subagent routing, and model run params. All of it lives
 * in `agent.config` and is persisted together via updateClawAgent({ config }),
 * with its own Save button (separate from the header's Persona/Behaviour save).
 * Non-owners see a read-only note, mirroring the reference.
 */
const ModelProviderTab = ({ agent, isActualOwner }: ModelProviderTabProps): ReactElement => {
  const queryClient = useQueryClient();
  const isOwner = isActualOwner;

  const [draft, setDraft] = useState<ModelProviderDraft>(EMPTY_MODEL_PROVIDER_DRAFT);
  const [saving, setSaving] = useState(false);
  const [customModels, setCustomModels] = useState<Set<string>>(new Set());

  useEffect(() => {
    setDraft(readModelProviderDraft(agent.config));
    setCustomModels(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id]);

  const dirty = modelProviderDirty(agent.config, draft);
  const set = (patch: Partial<ModelProviderDraft>): void =>
    setDraft(prev => ({ ...prev, ...patch }));

  const localHarnessAvailable = isLocalHarnessAvailable();

  const remaining = useMemo(
    () =>
      ALL_PROVIDERS.filter(
        p =>
          !draft.providerOrder.includes(p) && (localHarnessAvailable || !isLocalHarnessProvider(p)),
      ),
    [draft.providerOrder, localHarnessAvailable],
  );

  const moveProvider = (idx: number, dir: -1 | 1): void => {
    const target = idx + dir;
    if (target < 0 || target >= draft.providerOrder.length) return;
    const next = [...draft.providerOrder];
    [next[idx], next[target]] = [next[target]!, next[idx]!];
    set({ providerOrder: next });
  };
  const removeProvider = (idx: number): void =>
    set({ providerOrder: draft.providerOrder.filter((_, i) => i !== idx) });
  const addProvider = (p: string): void => set({ providerOrder: [...draft.providerOrder, p] });

  const temperatureConflict =
    draft.temperature.trim() !== '' && draft.thinkingLevel !== '' && draft.thinkingLevel !== 'off';

  const localHarnesses = useMemo(
    () =>
      localHarnessAvailable
        ? draft.providerOrder.filter((p): p is LocalHarnessProviderKey => isLocalHarnessProvider(p))
        : [],
    [draft.providerOrder, localHarnessAvailable],
  );

  const handleSave = async (): Promise<void> => {
    if (!dirty || saving) return;
    const validationError = validateModelProvider(draft);
    if (validationError) {
      toast.error(validationError);
      return;
    }
    setSaving(true);
    try {
      const updated = await updateClawAgent(agent.slug, {
        config: applyModelProvider(agent.config, draft),
      });
      queryClient.setQueryData(clawAgentDetailKey(agent.slug), updated);
      void queryClient.invalidateQueries({ queryKey: ['claw-auth-agents'] });
      setDraft(readModelProviderDraft(updated.config));
      toast.success('Model & provider saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (!isOwner) {
    return (
      <div className='flex max-w-2xl flex-col gap-8'>
        <div className='rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground'>
          This agent runs on the workspace default model. Only the owner can change the model or
          provider.
        </div>
        <PersonalHarnessSection agentSlug={agent.slug} />
      </div>
    );
  }

  return (
    <div className='flex max-w-2xl flex-col gap-8'>
      <Section
        title='Provider preference order'
        description='The first provider is the parent; the rest form the quota-fallback chain. Empty = the platform default (Spaces) only.'
      >
        {draft.providerOrder.length === 0 ? (
          <p className='rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground'>
            No providers set — runs use the platform default.
          </p>
        ) : (
          <div className='flex flex-col gap-2'>
            {draft.providerOrder.map((p, i) => (
              <div
                key={p}
                className='flex items-center gap-2 rounded-lg border border-border px-3 py-2'
              >
                <span className='w-5 text-xs tabular-nums text-muted-foreground'>{i + 1}</span>
                <span className='flex-1 truncate text-sm text-foreground'>
                  {PROVIDER_DISPLAY[p] ?? p}
                </span>
                {i === 0 && <Badge variant='secondary'>Parent</Badge>}
                <button
                  type='button'
                  onClick={() => moveProvider(i, -1)}
                  data-track-category='Claw Agents'
                  data-track-name='Move provider up'
                  disabled={i === 0}
                  aria-label='Move up'
                  className={iconBtn}
                >
                  <ArrowUp className='size-4' />
                </button>
                <button
                  type='button'
                  onClick={() => moveProvider(i, 1)}
                  data-track-category='Claw Agents'
                  data-track-name='Move provider down'
                  disabled={i === draft.providerOrder.length - 1}
                  aria-label='Move down'
                  className={iconBtn}
                >
                  <ArrowDown className='size-4' />
                </button>
                <button
                  type='button'
                  onClick={() => removeProvider(i)}
                  data-track-category='Claw Agents'
                  data-track-name='Remove provider'
                  disabled={!localHarnessAvailable && isLocalHarnessProvider(p)}
                  aria-label={`Remove ${PROVIDER_DISPLAY[p] ?? p}`}
                  className={cn(iconBtn, 'hover:text-destructive')}
                >
                  <X className='size-4' />
                </button>
              </div>
            ))}
          </div>
        )}

        {remaining.length > 0 && (
          <div className='flex flex-wrap gap-2'>
            {remaining.map(p => (
              <button
                key={p}
                type='button'
                onClick={() => addProvider(p)}
                data-track-category='Claw Agents'
                data-track-name='Add provider'
                className='inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
              >
                <Plus className='size-3' />
                {PROVIDER_DISPLAY[p] ?? p}
              </button>
            ))}
          </div>
        )}
      </Section>

      {localHarnesses.length > 0 && (
        <Section
          title='Local harness models'
          description='Runs on your own machine using your own CLI login. Tools still execute on Xyne’s servers with the agent’s normal permissions — the local harness only runs the model.'
        >
          <div className='flex flex-col gap-4'>
            {localHarnesses.map(harness => {
              const current = draft.localHarnessModels[harness] ?? '';
              const known = LOCAL_HARNESS_MODEL_OPTIONS[harness].some(o => o.value === current);
              const isCustom = customModels.has(harness) || (current !== '' && !known);
              const setModel = (value: string): void =>
                set({ localHarnessModels: { ...draft.localHarnessModels, [harness]: value } });

              return (
                <div key={harness} className='flex max-w-sm flex-col gap-1.5'>
                  <span className='text-xs font-medium text-foreground'>
                    {PROVIDER_DISPLAY[harness] ?? harness}
                  </span>
                  <Select
                    value={isCustom ? MODEL_CUSTOM : current || MODEL_DEFAULT}
                    onValueChange={v => {
                      setCustomModels(prev => {
                        const next = new Set(prev);
                        if (v === MODEL_CUSTOM) next.add(harness);
                        else next.delete(harness);
                        return next;
                      });
                      if (v !== MODEL_CUSTOM) setModel(v === MODEL_DEFAULT ? '' : v);
                    }}
                  >
                    <SelectTrigger size='sm' className='w-full'>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LOCAL_HARNESS_MODEL_OPTIONS[harness].map(o => (
                        <SelectItem key={o.value || MODEL_DEFAULT} value={o.value || MODEL_DEFAULT}>
                          {o.label}
                        </SelectItem>
                      ))}
                      <SelectItem value={MODEL_CUSTOM}>Custom…</SelectItem>
                    </SelectContent>
                  </Select>
                  {isCustom && (
                    <Input
                      value={current}
                      onChange={e => setModel(e.target.value)}
                      placeholder={
                        harness === 'claude-code' ? 'e.g. claude-opus-4-5' : 'e.g. gpt-5.5'
                      }
                      aria-label={`Custom model for ${PROVIDER_DISPLAY[harness] ?? harness}`}
                    />
                  )}
                </div>
              );
            })}
            <span className='text-xs text-muted-foreground'>
              Requires the Xyne desktop app with that harness connected. If no device is online,
              runs fall back to the next provider in the order.
            </span>
          </div>
        </Section>
      )}

      <Section title='Provider policy'>
        <div className='grid gap-2 sm:grid-cols-2'>
          <RadioOption
            selected={draft.alwaysOn}
            onSelect={() => set({ alwaysOn: true })}
            title='Always on'
            description='The agent’s provider serves every run.'
          />
          <RadioOption
            selected={!draft.alwaysOn}
            onSelect={() => set({ alwaysOn: false })}
            title='On /upgrade'
            description='Runs default to the platform model unless the user opts in.'
          />
        </div>
      </Section>

      <Section title='Subagent provider'>
        <div className='grid gap-2 sm:grid-cols-2'>
          <RadioOption
            selected={draft.subagentMode === 'spaces'}
            onSelect={() => set({ subagentMode: 'spaces' })}
            title='Spaces default'
            description='Subagents run on the platform model.'
          />
          <RadioOption
            selected={draft.subagentMode === 'parent'}
            onSelect={() => set({ subagentMode: 'parent' })}
            title='Follow parent'
            description='Subagents inherit this agent’s provider (uses more credits).'
          />
        </div>
      </Section>

      <Section
        title='Model settings'
        description='Applied to whichever provider serves the run, including quota fallbacks.'
      >
        <div className='grid gap-4 sm:grid-cols-2'>
          <div className='flex flex-col gap-1.5'>
            <span className='text-xs font-medium text-foreground'>Thinking level</span>
            <Select
              value={draft.thinkingLevel || THINKING_DEFAULT}
              onValueChange={v => set({ thinkingLevel: v === THINKING_DEFAULT ? '' : v })}
            >
              <SelectTrigger size='sm' className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {THINKING_OPTIONS.map(o => (
                  <SelectItem key={o.value || THINKING_DEFAULT} value={o.value || THINKING_DEFAULT}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className='flex flex-col gap-1.5'>
            <span className='text-xs font-medium text-foreground'>Temperature (0–1)</span>
            <Input
              value={draft.temperature}
              onChange={e => set({ temperature: e.target.value })}
              placeholder='provider default'
              inputMode='decimal'
            />
            {temperatureConflict ? (
              <span className='text-xs text-destructive'>
                Temperature requires thinking “Off” — thinking models ignore it.
              </span>
            ) : (
              <span className='text-xs text-muted-foreground'>
                Setting a temperature turns extended thinking off.
              </span>
            )}
          </div>

          <div className='flex flex-col gap-1.5'>
            <span className='text-xs font-medium text-foreground'>Max output tokens</span>
            <Input
              value={draft.maxTokens}
              onChange={e => set({ maxTokens: e.target.value })}
              placeholder='16384'
              inputMode='numeric'
            />
            <span className='text-xs text-muted-foreground'>
              1024–64000. Higher values raise per-run cost ceilings.
            </span>
          </div>
        </div>
      </Section>

      <PersonalHarnessSection agentSlug={agent.slug} />

      <div className='flex items-center gap-3 border-t border-border pt-4'>
        <Button
          type='button'
          size='sm'
          loading={saving}
          disabled={!dirty || temperatureConflict}
          onClick={() => void handleSave()}
          data-track-category='Claw Agents'
          data-track-name='SAVE_MODEL_PROVIDER'
        >
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
        {dirty && !saving && <span className='text-xs text-muted-foreground'>Unsaved changes</span>}
      </div>
    </div>
  );
};

export default ModelProviderTab;
