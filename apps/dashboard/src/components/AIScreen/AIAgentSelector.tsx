import { ReactElement, useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Bot, Search, X } from 'lucide-react';
import { Popover } from '../ui/Popover';
import { cn } from '../../utils/classNames';
import {
  fetchAccessibleClawAgents,
  type AccessibleClawAgent,
} from '../../services/clawAgentListService';
import { useSelectedAgent } from '../../hooks/useSelectedAgent';

export interface AIAgentSelectorProps {
  /** Whether the selector is disabled (e.g. while streaming). */
  disabled?: boolean;
  /** Called after the user picks a different agent — mirrors the sidebar's
   *  handleSelectAgent: parent uses this to open a fresh chat scoped to that
   *  agent. Skipped when the user re-selects the current agent. */
  onAgentChange?: ((slug: string | null) => void) | undefined;
  /** Controlled open state. Paired with `hideTrigger` so a narrow composer can
   *  drive the selector from the "+" menu instead of showing its own pill. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Render only the popover, anchored to a zero-size element in the toolbar. */
  hideTrigger?: boolean;
}

export const SELECTOR_ROW_CLASS =
  'flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent';

export function AgentGlyph({
  color,
  name,
  size = 20,
}: {
  color?: string | undefined;
  name: string;
  size?: number;
}): ReactElement {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-medium uppercase text-white',
        !color && 'bg-muted-foreground',
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.45),
        ...(color ? { backgroundColor: color } : {}),
      }}
    >
      {name.trim().charAt(0) || '?'}
    </span>
  );
}

/**
 * Agent selector for the /ai page composer.
 * Uses useSelectedAgent for persistence and fetchAccessibleClawAgents for the list.
 */
export function AIAgentSelector({
  disabled = false,
  onAgentChange,
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
}: AIAgentSelectorProps): ReactElement {
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

  const { selectedAgentSlug, setSelectedAgentSlug } = useSelectedAgent();

  const { data: agents = [], isLoading } = useQuery({
    queryKey: ['accessible-claw-agents'],
    queryFn: fetchAccessibleClawAgents,
    staleTime: 5 * 60 * 1000,
  });

  const filteredAgents = useMemo(() => {
    const withoutAskAI = agents.filter((a: AccessibleClawAgent) => a.slug !== 'ask-ai');
    if (!query.trim()) return withoutAskAI;
    const q = query.toLowerCase();
    return withoutAskAI.filter(
      (a: AccessibleClawAgent) =>
        a.name.toLowerCase().includes(q) || (a.description ?? '').toLowerCase().includes(q),
    );
  }, [agents, query]);

  const selectedAgent = useMemo(
    () => agents.find((a: AccessibleClawAgent) => a.slug === selectedAgentSlug) ?? null,
    [agents, selectedAgentSlug],
  );

  const displayText = selectedAgent?.name ?? 'Ask AI';

  const clearAgent = useCallback(() => {
    if (selectedAgentSlug !== null) {
      setSelectedAgentSlug(null);
      onAgentChange?.(null);
    }
  }, [selectedAgentSlug, setSelectedAgentSlug, onAgentChange]);

  // Zero-size anchor when the pill is hidden — Radix positions the popover
  // against the trigger, so it still needs an element in the toolbar.
  const trigger = hideTrigger ? (
    <span aria-hidden className='block h-0 w-0' />
  ) : (
    <button
      disabled={disabled}
      className={cn(
        'flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm transition-colors',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
      )}
      data-track-category='XyneAI'
      data-track-name='OPEN_AGENT_SELECTOR'
    >
      {selectedAgent ? (
        <AgentGlyph color={selectedAgent.color} name={selectedAgent.name} size={18} />
      ) : (
        <Bot className='w-4 h-4 text-primary shrink-0' />
      )}
      <span className='font-medium truncate max-w-[180px] text-foreground'>{displayText}</span>
      <ChevronDown
        className={cn(
          'text-muted-foreground transition-transform shrink-0 w-3.5 h-3.5',
          open && 'rotate-180',
        )}
      />
    </button>
  );

  const popover = (
    <Popover
      open={open}
      onOpenChange={next => {
        setOpen(next);
        if (!next) setQuery('');
      }}
      side='top'
      align='start'
      sideOffset={8}
      trigger={trigger}
      className='w-[290px] p-0 ai-agent-selector border border-border rounded-[14px] shadow-lg'
    >
      <div className='flex flex-col max-h-[min(340px,70vh)] overflow-hidden rounded-[14px]'>
        {/* Search bar*/}
        <div className='sticky top-0 z-10 ai-agent-selector flex items-center gap-2.5 border-b border-border px-4 py-3'>
          <Search size={15} className='text-muted-foreground shrink-0' />
          <input
            type='text'
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder='Search'
            className='flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60'
            autoFocus
            data-track-category='XyneAI'
            data-track-name='SearchAgentSelector'
          />
        </div>

        {/* Loading state */}
        {isLoading && (
          <div className='px-3 py-4 text-sm text-muted-foreground text-center'>Loading agents…</div>
        )}

        {/* Scrollable list */}
        {!isLoading && (
          <div className='overflow-auto p-1.5'>
            {filteredAgents.length === 0 && agents.length > 0 && query.trim() ? (
              <div className='px-3 py-4 text-sm text-muted-foreground text-center'>
                No agents match &ldquo;{query}&rdquo;
              </div>
            ) : (
              filteredAgents.map((agent: AccessibleClawAgent) => (
                <button
                  key={agent.slug}
                  onClick={() => {
                    if (selectedAgentSlug !== agent.slug) {
                      setSelectedAgentSlug(agent.slug);
                      onAgentChange?.(agent.slug);
                    }
                    setOpen(false);
                  }}
                  className={cn(
                    SELECTOR_ROW_CLASS,
                    selectedAgentSlug === agent.slug && 'bg-accent',
                  )}
                  data-track-category='XyneAI'
                  data-track-name='SELECT_AGENT'
                  data-track-metadata={JSON.stringify({ agentSlug: agent.slug })}
                >
                  <AgentGlyph color={agent.color} name={agent.name} size={24} />
                  <span className='min-w-0 flex-1 truncate font-normal'>{agent.name}</span>
                </button>
              ))
            )}

            <button
              onClick={() => {
                if (selectedAgentSlug !== null) {
                  setSelectedAgentSlug(null);
                  onAgentChange?.(null);
                }
                setOpen(false);
              }}
              className={cn(SELECTOR_ROW_CLASS, selectedAgentSlug === null && 'bg-accent')}
              data-track-category='XyneAI'
              data-track-name='SELECT_AGENT'
              data-track-metadata={JSON.stringify({ agentSlug: 'ask-ai' })}
            >
              <span className='grid size-6 shrink-0 place-items-center text-primary'>
                <Bot className='size-[18px]' aria-hidden />
              </span>
              <span className='font-normal'>Ask AI</span>
            </button>
          </div>
        )}
      </div>
    </Popover>
  );

  if (hideTrigger) return popover;

  return (
    <div className='flex min-w-0 items-center gap-0.5'>
      {popover}
      {selectedAgent && (
        <button
          type='button'
          disabled={disabled}
          onClick={clearAgent}
          aria-label='Back to Ask AI'
          title='Back to Ask AI'
          className={cn(
            'grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors',
            disabled
              ? 'cursor-not-allowed opacity-60'
              : 'hover:bg-foreground/5 hover:text-foreground',
          )}
          data-track-category='XyneAI'
          data-track-name='CLEAR_AGENT_SELECTION'
        >
          <X className='size-3.5' aria-hidden />
        </button>
      )}
    </div>
  );
}
