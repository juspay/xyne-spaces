/**
 * Combined model + thinking picker, shared by the /ai composer and the Ask AI
 * sidebar. Styled after the Claude app's model menu — see the component doc
 * below. Lists come from the agent models endpoint (the agent's own LiteLLM
 * credential, or the platform allowed list); `defaultModel` labels the
 * Recommended row.
 */
import { useCallback, useMemo, useState } from 'react';
import { Brain, Check, ChevronDown, ChevronRight, Laptop, Search, Sparkles } from 'lucide-react';
import { Popover } from '../ui/Popover';
import { SELECTOR_ROW_CLASS } from './AIAgentSelector';
import { cn } from '../../utils/classNames';
import type { ClawAgentModel } from '../../services/clawAgentModelsService';

/**
 * Model ids carry a trailing release stamp (`claude-sonnet-4-20250514`) that
 * adds noise in a narrow pill. Strip it for display only — the full id stays
 * in the title attribute and is what we send.
 */
export const formatModelLabel = (id: string): string => id.replace(/-\d{8}$/, '');

/** Per-run thinking level for the composer. null = the agent's configured
 *  default. Applies to whichever provider serves the run (same precedence as
 *  the agent's modelSettings.thinkingLevel). */
const THINKING_LEVEL_OPTIONS: Array<{
  value: 'off' | 'minimal' | 'low' | 'medium' | 'high' | null;
  label: string;
}> = [
  { value: null, label: 'Default' },
  { value: 'off', label: 'Off' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

/**
 * Combined model + thinking picker, styled after the Claude app's model menu:
 * the trigger leads with the MODEL name ("Recommended" when no pin, with the
 * thinking level beside it when set), and the menu holds the Recommended row,
 * a search bar over the account's allowed models, and an expandable Thinking
 * section (Default / Off / Minimal / Low / Medium / High).
 */
export function ModelThinkingSelector({
  models,
  defaultModel,
  selectedModel,
  onSelectModel,
  thinkingLevel,
  onSelectThinking,
  disabled,
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
}: {
  models: ClawAgentModel[];
  defaultModel: string | null;
  selectedModel: string | null;
  onSelectModel: (m: string | null) => void;
  thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | null;
  onSelectThinking: (v: 'off' | 'minimal' | 'low' | 'medium' | 'high' | null) => void;
  disabled?: boolean;
  /** Controlled open state. Paired with `hideTrigger` so a narrow composer can
   *  drive the menu from the "+" menu instead of showing its own pill. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Render only the popover, anchored to a zero-size element in the toolbar. */
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
  const [query, setQuery] = useState('');
  const [thinkingOpen, setThinkingOpen] = useState(false);
  // Which side the Thinking flyout opens on. Measured when it opens: in the
  // right-docked sidebar there is no viewport space to the right of the menu,
  // so the flyout flips to the left there.
  const [flyoutSide, setFlyoutSide] = useState<'right' | 'left'>('right');

  const selected = useMemo(
    () => models.find(m => m.id === selectedModel) ?? null,
    [models, selectedModel],
  );
  const harnessModels = useMemo(() => models.filter(m => m.provider === 'local-harness'), [models]);
  const serverModels = useMemo(() => models.filter(m => m.provider !== 'local-harness'), [models]);
  const recommendedHarness = useMemo(
    () => harnessModels.find(m => m.recommended) ?? null,
    [harnessModels],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return serverModels;
    return serverModels.filter(
      m => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q),
    );
  }, [serverModels, query]);
  const thinkingLabel =
    THINKING_LEVEL_OPTIONS.find(o => o.value === thinkingLevel)?.label ?? 'Default';

  const rowClass = (active: boolean) =>
    cn(SELECTOR_ROW_CLASS, 'justify-between', active && 'bg-accent');

  return (
    <Popover
      open={open}
      onOpenChange={o => {
        setOpen(o);
        if (!o) {
          setQuery('');
          setThinkingOpen(false);
        }
      }}
      side='top'
      align='end'
      sideOffset={8}
      trigger={
        // Zero-size anchor when the pill is hidden — Radix positions the
        // popover against the trigger, so it still needs an element in the row.
        hideTrigger ? (
          <span aria-hidden className='block h-0 w-0' />
        ) : (
          <button
            type='button'
            disabled={disabled}
            title={
              selected
                ? selected.id
                : defaultModel
                  ? `Recommended (${defaultModel})`
                  : 'Recommended model'
            }
            aria-label='Model and thinking'
            data-track-category='XyneAI'
            data-track-name='OPEN_MODEL_SELECTOR'
            className={cn(
              'flex h-7 min-w-0 shrink items-center gap-1.5 rounded-lg px-2 text-sm transition-colors',
              disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
            )}
          >
            <Sparkles
              className='h-3.5 w-3.5 shrink-0 text-primary'
              aria-hidden
              strokeWidth={1.75}
            />
            <span className='min-w-0 truncate font-medium text-foreground'>
              {selected
                ? selected.provider === 'local-harness'
                  ? selected.name
                  : formatModelLabel(selected.name)
                : recommendedHarness
                  ? recommendedHarness.name
                  : defaultModel
                    ? formatModelLabel(defaultModel)
                    : 'Recommended'}
            </span>
            {thinkingLevel && <span className='text-muted-foreground'>{thinkingLabel}</span>}
            <ChevronDown className='h-3 w-3 shrink-0 text-muted-foreground' aria-hidden />
          </button>
        )
      }
      className='w-[290px] p-0 bg-popover border border-border rounded-[14px] shadow-lg overflow-visible'
    >
      <div className='flex flex-col'>
        {serverModels.length > 0 && (
          <div className='flex items-center gap-2.5 border-b border-border px-4 py-3'>
            <Search className='size-[15px] shrink-0 text-muted-foreground' aria-hidden />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder='Search'
              data-id='model-search'
              data-track-category='XyneAI'
              data-track-name='SEARCH_MODELS'
              className='flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60'
            />
          </div>
        )}

        <div className='flex max-h-[min(300px,60vh)] flex-col overflow-auto p-1.5'>
          {harnessModels.length > 0 && (
            <>
              {harnessModels.map(h => (
                <button
                  key={h.id}
                  type='button'
                  title={h.deviceName ? `${h.name} — ${h.deviceName}` : h.name}
                  onClick={() => {
                    onSelectModel(h.id);
                    setOpen(false);
                  }}
                  data-track-category='XyneAI'
                  data-track-name='SELECT_MODEL'
                  data-track-metadata={JSON.stringify({ model: h.id })}
                  className={rowClass(selectedModel === h.id)}
                >
                  <span className='flex min-w-0 items-center gap-2.5'>
                    <span className='grid size-6 shrink-0 place-items-center text-muted-foreground'>
                      <Laptop className='size-[18px]' aria-hidden strokeWidth={1.75} />
                    </span>
                    <span className='flex min-w-0 flex-col items-start gap-0.5'>
                      <span className='max-w-full truncate'>{h.name}</span>
                      <span className='max-w-full truncate text-[11px] text-muted-foreground'>
                        {h.recommended ? 'Runs on this Mac (Recommended)' : 'Runs on this Mac'}
                      </span>
                    </span>
                  </span>
                </button>
              ))}
              <div className='px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>
                Run on server
              </div>
            </>
          )}
          {/* Recommended — clears the pin; the run uses the model configured in the DB. */}
          <button
            type='button'
            onClick={() => {
              onSelectModel(null);
              setOpen(false);
            }}
            data-track-category='XyneAI'
            data-track-name='SELECT_MODEL'
            data-track-metadata='{"model":"recommended"}'
            className={rowClass(selectedModel === null)}
          >
            <span className='flex min-w-0 items-center gap-1.5'>
              <span className='min-w-0 truncate'>
                {defaultModel ? formatModelLabel(defaultModel) : 'Recommended'}
              </span>
              {defaultModel && !recommendedHarness && (
                <span className='shrink-0 text-[11px] text-muted-foreground'>(Recommended)</span>
              )}
            </span>
          </button>

          {serverModels.length > 0 &&
            (filtered.length === 0 ? (
              <div className='px-2.5 py-2 text-sm text-muted-foreground'>No models match</div>
            ) : (
              filtered.map(m => (
                <button
                  key={m.id}
                  type='button'
                  title={m.id}
                  onClick={() => {
                    onSelectModel(m.id);
                    setOpen(false);
                  }}
                  data-track-category='XyneAI'
                  data-track-name='SELECT_MODEL'
                  data-track-metadata={JSON.stringify({ model: m.id })}
                  className={rowClass(selectedModel === m.id)}
                >
                  <span className='min-w-0 flex-1 truncate font-normal'>
                    {formatModelLabel(m.name)}
                  </span>
                </button>
              ))
            ))}
        </div>

        {/* Thinking — opens a submenu beside the menu, outside the scroll area. */}
        <div className='relative border-t border-border p-1.5'>
          <button
            type='button'
            onClick={e => {
              const menu = (e.currentTarget as HTMLElement).closest('[class*="bg-popover"]');
              const rect = (menu ?? e.currentTarget).getBoundingClientRect();
              // 160px flyout + 6px gap, with a small margin.
              setFlyoutSide(rect.right + 176 <= window.innerWidth ? 'right' : 'left');
              setThinkingOpen(v => !v);
            }}
            data-id='thinking-expand'
            data-track-category='XyneAI'
            data-track-name='TOGGLE_THINKING_MENU'
            aria-expanded={thinkingOpen}
            className={cn(SELECTOR_ROW_CLASS, 'justify-between')}
          >
            <span className='flex items-center gap-2.5'>
              <span className='grid size-6 shrink-0 place-items-center text-muted-foreground'>
                <Brain className='size-[18px]' aria-hidden strokeWidth={1.75} />
              </span>
              Thinking
            </span>
            <span className='flex items-center gap-1 text-muted-foreground'>
              {thinkingLabel}
              <ChevronRight className='h-3 w-3 shrink-0' aria-hidden />
            </span>
          </button>
          {thinkingOpen && (
            <div
              className={cn(
                'absolute bottom-0 z-50 w-40 rounded-[14px] border border-border bg-popover p-1.5 shadow-lg',
                flyoutSide === 'right'
                  ? 'right-0 translate-x-[calc(100%+6px)]'
                  : 'left-0 -translate-x-[calc(100%+6px)]',
              )}
            >
              {THINKING_LEVEL_OPTIONS.map(o => (
                <button
                  key={o.label}
                  type='button'
                  onClick={() => {
                    onSelectThinking(o.value);
                    setOpen(false);
                  }}
                  data-id={`thinking-option-${o.label.toLowerCase()}`}
                  data-track-category='XyneAI'
                  data-track-name='SELECT_THINKING_LEVEL'
                  data-track-metadata={JSON.stringify({ level: o.label })}
                  className={rowClass(o.value === thinkingLevel)}
                >
                  <span>{o.label}</span>
                  {o.value === thinkingLevel && (
                    <Check className='h-3.5 w-3.5 shrink-0' aria-hidden />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </Popover>
  );
}
