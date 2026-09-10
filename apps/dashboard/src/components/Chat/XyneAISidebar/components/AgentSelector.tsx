import { ReactElement, useEffect, useMemo, useState } from 'react';
import { ChevronDown, Bot, SearchDefault } from '@xyne/icons';
import { Popover } from '../../../ui/Popover';
import { cn } from '../../../../utils/classNames';
import { usePlatform } from '../../../../hooks/usePlatform';

/** Get initials from a name (e.g., "Xyne Grafana" -> "XG", "Assistant" -> "As") */
const getInitials = (name: string): string => {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) {
    return (words[0]?.[0] ?? '') + (words[1]?.[0] ?? '');
  }
  // Single word: take first 2 characters
  return name.slice(0, 2);
};

export interface AgentOption {
  slug: string;
  name: string;
  color: string;
}

interface AgentSelectorProps {
  /** Currently selected agent slug, or null for Ask AI (legacy). */
  selectedAgentSlug: string | null;
  /** Available agents (excludes ask-ai). */
  agents: AgentOption[];
  /** Called when the user picks a different agent. `null` = Ask AI. */
  onSelect: (slug: string | null) => void;
  /** Whether the selector is disabled (e.g. while streaming). */
  disabled?: boolean;
  /** Optional compact mode for mobile or tight layouts. */
  compact?: boolean;
  /** Optional label shown instead of the default. */
  label?: string;
}

const MAX_VISIBLE_AGENTS = 6;

/**
 * Global agent selector dropdown.
 * Shows "Ask AI" by default, plus any claw agents the user has access to.
 */
export const AgentSelector = ({
  selectedAgentSlug,
  agents,
  onSelect,
  disabled = false,
  compact = false,
  label,
}: AgentSelectorProps): ReactElement => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const { isMobile } = usePlatform();

  useEffect(() => {
    if (disabled) {
      setOpen(false);
      setQuery('');
    }
  }, [disabled]);

  const filteredAgents = useMemo(() => {
    const withoutAskAI = agents.filter(a => a.slug !== 'ask-ai');
    if (!query.trim()) return withoutAskAI;
    const q = query.toLowerCase();
    return withoutAskAI.filter(a => a.name.toLowerCase().includes(q));
  }, [agents, query]);

  const selectedAgent = useMemo(
    () => agents.filter(a => a.slug !== 'ask-ai').find(a => a.slug === selectedAgentSlug) ?? null,
    [agents, selectedAgentSlug],
  );

  // On mobile in compact mode, show only color dot + initials (no chevron)
  const isMobileCompact = isMobile && compact;
  const displayText = label ?? selectedAgent?.name ?? 'Ask AI';
  const displayLabel = isMobileCompact ? getInitials(displayText) : displayText;

  const trigger = (
    <button
      disabled={disabled}
      className={cn(
        // Borderless surface/primary pill — see Figma node 1655:24608.
        'flex items-center gap-1 rounded-lg transition-colors bg-card',
        isMobileCompact ? 'h-7 px-1.5 text-sm' : compact ? 'h-7 px-1.5 text-sm' : 'px-3 py-2',
        disabled ? 'cursor-not-allowed opacity-60' : 'hover:bg-accent cursor-pointer',
      )}
      data-track-category='XyneAI'
      data-track-name='OPEN_AGENT_SELECTOR'
    >
      {/* The frame shows label + chevron only, so the generic Bot fallback is
          gone. The colour dot stays for a selected agent — that's the only cue
          for which agent is active, and the frame depicts the unselected state. */}
      {selectedAgent && (
        <span
          className={cn(
            'inline-block rounded-full shrink-0',
            !selectedAgent.color && 'bg-muted-foreground',
          )}
          style={{
            width: compact ? 10 : 12,
            height: compact ? 10 : 12,
            ...(selectedAgent.color ? { backgroundColor: selectedAgent.color } : {}),
          }}
        />
      )}
      <span className='text-muted-foreground font-medium'>{displayLabel}</span>
      <ChevronDown
        className={cn(
          'text-muted-foreground transition-transform shrink-0 w-4 h-4',
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
      className='w-64 p-0 bg-popover border border-border rounded-lg shadow-lg overflow-hidden'
    >
      <div className='flex flex-col max-h-[min(320px,70vh)]'>
        {/* Search bar */}
        <div className='sticky top-0 z-10 bg-popover border-b border-border px-2.5 py-2'>
          <div className='flex items-center gap-2 rounded-md bg-muted px-2.5 py-1.5'>
            <SearchDefault size={14} className='text-muted-foreground shrink-0' />
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
                data-track-name='ClearAgentSearch'
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Scrollable list */}
        <div className='overflow-auto py-1'>
          {/* Ask AI option */}
          <button
            onClick={() => {
              if (disabled) return;
              onSelect(null);
              setOpen(false);
            }}
            className={cn(
              'flex items-center gap-2.5 px-3 py-2 mx-1 rounded-md text-left text-sm transition-colors',
              selectedAgentSlug === null
                ? 'bg-primary/10 text-primary'
                : 'hover:bg-accent text-foreground',
            )}
            data-track-category='XyneAI'
            data-track-name='SELECT_AGENT'
            data-track-metadata={JSON.stringify({ agentSlug: 'ask-ai' })}
          >
            <Bot className='w-4 h-4 shrink-0' />
            <span className='font-medium'>Ask AI</span>
          </button>

          {/* Divider if there are agents */}
          {filteredAgents.length > 0 && <div className='my-1 h-px bg-border mx-2' />}

          {/* Agent list */}
          {filteredAgents.length === 0 && agents.length > 0 ? (
            <div className='px-3 py-4 text-sm text-muted-foreground text-center'>
              No agents match {query}
            </div>
          ) : (
            filteredAgents.map(agent => (
              <button
                key={agent.slug}
                onClick={() => {
                  if (disabled) return;
                  onSelect(agent.slug);
                  setOpen(false);
                }}
                className={cn(
                  'flex items-center gap-2.5 px-3 py-2 mx-1 rounded-md text-left text-sm transition-colors',
                  selectedAgentSlug === agent.slug
                    ? 'bg-primary/10 text-primary'
                    : 'hover:bg-accent text-foreground',
                )}
                data-track-category='XyneAI'
                data-track-name='SELECT_AGENT'
                data-track-metadata={JSON.stringify({ agentSlug: agent.slug })}
              >
                <span
                  className={cn(
                    'inline-block rounded-full shrink-0',
                    !agent.color && 'bg-muted-foreground',
                  )}
                  style={{
                    width: 12,
                    height: 12,
                    ...(agent.color ? { backgroundColor: agent.color } : {}),
                  }}
                />
                <span className='font-medium truncate'>{agent.name}</span>
              </button>
            ))
          )}
        </div>

        {/* Footer count */}
        {filteredAgents.length > MAX_VISIBLE_AGENTS && (
          <div className='sticky bottom-0 bg-popover border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground text-center'>
            {filteredAgents.length} agents
          </div>
        )}
      </div>
    </Popover>
  );
};
