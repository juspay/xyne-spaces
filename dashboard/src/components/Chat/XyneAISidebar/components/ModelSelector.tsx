import { ReactElement, useMemo, useState } from 'react';
import { ChevronDown, Sparkles } from 'lucide-react';
import { Popover } from '../../../ui/Popover';
import { cn } from '../../../../utils/classNames';
import { usePlatform } from '../../../../hooks/usePlatform';
import type { ClawAgentModel } from '../../../../services/clawAgentModelsService';

/**
 * Model ids carry a trailing release stamp (`claude-sonnet-4-20250514`) that
 * adds noise in a narrow pill. Strip it for display only — the full id stays in
 * the title attribute and is what we send. Deliberately generic rather than a
 * name→label table: claw derives its list from a live /v1/models call, so a
 * hardcoded table would drift the moment the proxy's models change.
 */
export const formatModelLabel = (id: string): string => id.replace(/-\d{8}$/, '');

interface ModelSelectorProps {
  /** Currently pinned model id, or null for the agent's default. */
  selectedModel: string | null;
  /** Models the agent's LiteLLM credential can serve. Empty ⇒ renders nothing. */
  models: ClawAgentModel[];
  /** The agent's configured model, used to label the default row. */
  defaultModel: string | null;
  /** Called when the user picks a model. `null` = agent default (no pin). */
  onSelect: (model: string | null) => void;
  /** Whether the selector is disabled (e.g. while streaming). */
  disabled?: boolean;
  /** Optional compact mode for mobile or tight layouts. */
  compact?: boolean;
}

/**
 * Per-run model switcher for the Ask AI composer.
 *
 * Lists only the models the selected agent's shared LiteLLM key can access, so
 * a pick can never be one the run would reject. Empty list ⇒ renders nothing
 * (the agent has no litellm credential, and its model comes from elsewhere —
 * a premium provider credential or the platform default — where a pin would be
 * silently ignored). Mirrors the claw console's ModelSelect.
 */
export const ModelSelector = ({
  selectedModel,
  models,
  defaultModel,
  onSelect,
  disabled = false,
  compact = false,
}: ModelSelectorProps): ReactElement | null => {
  const [open, setOpen] = useState(false);
  const { isMobile } = usePlatform();

  const selected = useMemo(
    () => models.find(m => m.id === selectedModel) ?? null,
    [models, selectedModel],
  );

  // No models ⇒ nothing this picker could usefully offer.
  if (models.length === 0) return null;

  const isMobileCompact = isMobile && compact;
  const displayText = selected ? formatModelLabel(selected.name) : 'Default';

  const trigger = (
    <button
      disabled={disabled}
      title={selected?.id ?? (defaultModel ? `Agent default (${defaultModel})` : 'Agent default')}
      className={cn(
        'flex items-center gap-1.5 rounded-lg transition-colors border border-border',
        compact ? 'px-2 py-1.5 text-sm' : 'px-3 py-2',
        disabled ? 'cursor-not-allowed opacity-60' : 'hover:bg-accent cursor-pointer',
      )}
      data-track-category='XyneAI'
      data-track-name='OPEN_MODEL_SELECTOR'
    >
      <Sparkles className={cn(compact ? 'w-3.5 h-3.5' : 'w-4 h-4', 'text-primary shrink-0')} />
      {!isMobileCompact && (
        <span className='text-foreground font-medium truncate'>{displayText}</span>
      )}
      <ChevronDown
        className={cn(
          'text-muted-foreground transition-transform shrink-0',
          compact ? 'w-3.5 h-3.5' : 'w-4 h-4',
          open && 'rotate-180',
        )}
      />
    </button>
  );

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align='start'
      sideOffset={4}
      trigger={trigger}
      className='w-64 p-0 bg-popover border border-border rounded-lg shadow-lg overflow-hidden'
    >
      <div className='flex flex-col max-h-[min(320px,70vh)] overflow-auto py-1'>
        {/* Agent default — clears the pin. */}
        <button
          onClick={() => {
            onSelect(null);
            setOpen(false);
          }}
          className={cn(
            'flex flex-col items-start gap-0.5 px-3 py-2 mx-1 rounded-md text-left text-sm transition-colors',
            selectedModel === null
              ? 'bg-primary/10 text-primary'
              : 'hover:bg-accent text-foreground',
          )}
          data-track-category='XyneAI'
          data-track-name='SELECT_MODEL'
          data-track-metadata={JSON.stringify({ model: 'default' })}
        >
          <span className='font-medium'>Default</span>
          {defaultModel && (
            <span className='text-[11px] text-muted-foreground truncate max-w-full'>
              {formatModelLabel(defaultModel)}
            </span>
          )}
        </button>

        <div className='my-1 h-px bg-border mx-2' />

        {models.map(model => (
          <button
            key={model.id}
            onClick={() => {
              onSelect(model.id);
              setOpen(false);
            }}
            title={model.id}
            className={cn(
              'flex items-center gap-2.5 px-3 py-2 mx-1 rounded-md text-left text-sm transition-colors',
              selectedModel === model.id
                ? 'bg-primary/10 text-primary'
                : 'hover:bg-accent text-foreground',
            )}
            data-track-category='XyneAI'
            data-track-name='SELECT_MODEL'
            data-track-metadata={JSON.stringify({ model: model.id })}
          >
            <span className='font-medium truncate'>{formatModelLabel(model.name)}</span>
          </button>
        ))}
      </div>
    </Popover>
  );
};
