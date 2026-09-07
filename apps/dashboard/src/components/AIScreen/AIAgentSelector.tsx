import { ReactElement, useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Bot, Search } from 'lucide-react';
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

const MAX_VISIBLE_AGENTS = 6;

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
    return withoutAskAI.filter((a: AccessibleClawAgent) => a.name.toLowerCase().includes(q));
  }, [agents, query]);

  const selectedAgent = useMemo(
    () => agents.find((a: AccessibleClawAgent) => a.slug === selectedAgentSlug) ?? null,
    [agents, selectedAgentSlug],
  );

  const displayText = selectedAgent?.name ?? 'Ask AI';

  // Zero-size anchor when the pill is hidden — Radix positions the popover
  // against the trigger, so it still needs an element in the toolbar.
  const trigger = hideTrigger ? (
    <span aria-hidden className='block h-0 w-0' />
  ) : (
    <button
      disabled={disabled}
      className={cn(
        'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm transition-colors',
        disabled ? 'cursor-not-allowed opacity-60' : 'hover:bg-accent cursor-pointer',
      )}
      data-track-category='XyneAI'
      data-track-name='OPEN_AGENT_SELECTOR'
    >
      {selectedAgent ? (
        <span
          className={cn(
            'inline-block rounded-full shrink-0',
            !selectedAgent.color && 'bg-muted-foreground',
          )}
          style={{
            width: 10,
            height: 10,
            ...(selectedAgent.color ? { backgroundColor: selectedAgent.color } : {}),
          }}
        />
      ) : (
        <Bot className='w-3.5 h-3.5 text-primary shrink-0' />
      )}
      <span className='text-muted-foreground font-medium truncate max-w-[140px]'>
        {displayText}
      </span>
      <ChevronDown
        className={cn(
          'text-muted-foreground transition-transform shrink-0 w-3.5 h-3.5',
          open && 'rotate-180',
        )}
      />
    </button>
  );

  return (
    <Popover
      open={open}
      onOpenChange={next => {
        setOpen(next);
        if (!next) setQuery('');
      }}
      align='start'
      sideOffset={4}
      trigger={trigger}
      className='w-60 p-0 ai-agent-selector border border-border rounded-lg shadow-lg overflow-hidden'
    >
      <div className='flex flex-col max-h-[min(300px,70vh)]'>
        {/* Search bar */}
        <div className='sticky top-0 z-10 ai-agent-selector border-b border-border px-2.5 py-2'>
          <div className='flex items-center gap-2 rounded-md bg-muted px-2.5 py-1.5'>
            <Search size={13} className='text-muted-foreground shrink-0' />
            <input
              type='text'
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder='Search agents…'
              className='flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60'
              autoFocus
              data-track-category='XyneAI'
              data-track-name='SearchAgentSelector'
            />
            {query && (
              <button
                type='button'
                onClick={() => setQuery('')}
                className='text-muted-foreground hover:text-foreground text-xs shrink-0'
                data-track-category='XyneAI'
                data-track-name='CLEAR_AGENT_SEARCH'
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Loading state */}
        {isLoading && (
          <div className='px-3 py-4 text-sm text-muted-foreground text-center'>Loading agents…</div>
        )}

        {/* Scrollable list */}
        {!isLoading && (
          <div className='overflow-auto py-1'>
            {/* Ask AI option */}
            <button
              onClick={() => {
                if (selectedAgentSlug !== null) {
                  setSelectedAgentSlug(null);
                  onAgentChange?.(null);
                }
                setOpen(false);
              }}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 mx-1 rounded-md text-left text-sm transition-colors w-full',
                selectedAgentSlug === null
                  ? 'bg-primary/10 text-primary'
                  : 'hover:bg-accent text-foreground',
              )}
              data-track-category='XyneAI'
              data-track-name='SELECT_AGENT'
              data-track-metadata={JSON.stringify({ agentSlug: 'ask-ai' })}
            >
              <Bot className='w-4 h-4 shrink-0' />
              <span className='font-normal'>Ask AI</span>
            </button>

            {/* Divider if there are agents */}
            {filteredAgents.length > 0 && <div className='my-1 h-px bg-border mx-2' />}

            {/* Agent list */}
            {filteredAgents.length === 0 && agents.length > 0 ? (
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
                    'flex items-center gap-2.5 px-3 py-2 mx-1 rounded-md text-left text-sm transition-colors w-full',
                    selectedAgentSlug === agent.slug
                      ? 'bg-primary/10 text-primary'
                      : 'hover:bg-accent text-foreground',
                  )}
                  data-track-category='XyneAI'
                  data-track-name='SELECT_AGENT'
                  data-track-metadata={JSON.stringify({ agentSlug: agent.slug })}
                >
                  <span className='font-normal truncate'>{agent.name}</span>
                </button>
              ))
            )}
          </div>
        )}

        {/* Footer count */}
        {filteredAgents.length > MAX_VISIBLE_AGENTS && (
          <div className='sticky bottom-0 ai-agent-selector border-t border-border px-3 py-1.5 text-[11px] font-normal text-muted-foreground/60 text-center'>
            {filteredAgents.length} agents
          </div>
        )}
      </div>
    </Popover>
  );
}
