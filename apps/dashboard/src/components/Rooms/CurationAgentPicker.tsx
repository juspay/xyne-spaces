import { ReactElement, useMemo, useState } from 'react';
import { Check, ChevronDown, Search, Sparkles } from 'lucide-react';
import { Popover } from '../ui/Popover';
import { useClawAgents } from '../../hooks/useClawAgents';
import { cn } from '../../utils/classNames';

const MAX_VISIBLE_AGENTS = 6;

interface CurationAgentPickerProps {
  value: string | null;
  onChange: (agentSlug: string | null) => void;
  className?: string;
}

export function CurationAgentPicker({
  value,
  onChange,
  className,
}: CurationAgentPickerProps): ReactElement {
  const { agents, isLoading, isError } = useClawAgents();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const filteredAgents = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter(agent => agent.name.toLowerCase().includes(q));
  }, [agents, query]);

  const selectedAgent = useMemo(
    () => agents.find(agent => agent.slug === value) ?? null,
    [agents, value],
  );

  const isMissingAgent = value !== null && !isLoading && !selectedAgent;

  const handleOpenChange = (next: boolean): void => {
    setOpen(next);
    if (!next) setQuery('');
  };

  const handleSelect = (slug: string | null): void => {
    onChange(slug);
    setOpen(false);
    setQuery('');
  };

  const triggerLabel = isMissingAgent ? value : (selectedAgent?.name ?? 'Ask AI (default)');

  const trigger = (
    <button
      type='button'
      aria-label='Select curation agent'
      data-track-category='Rooms'
      data-track-name='OpenCurationAgentPicker'
      data-testid='curation-agent-trigger'
      className={cn(
        'flex h-10 w-full items-center gap-2.5 rounded-lg border border-input bg-background px-3 text-left',
        'transition-[background-color,border-color] duration-150 ease-out hover:bg-accent',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      {selectedAgent ? (
        <span
          className={cn(
            'inline-block size-3 shrink-0 rounded-full',
            !selectedAgent.color && 'bg-muted-foreground',
          )}
          {...(selectedAgent.color ? { style: { backgroundColor: selectedAgent.color } } : {})}
        />
      ) : (
        <Sparkles size={15} className='shrink-0 text-muted-foreground' />
      )}
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-sm font-medium',
          isMissingAgent ? 'text-destructive' : 'text-foreground',
        )}
      >
        {triggerLabel}
      </span>
      <ChevronDown
        size={16}
        className={cn(
          'shrink-0 text-muted-foreground transition-transform duration-150',
          open && 'rotate-180',
        )}
      />
    </button>
  );

  return (
    <div className={cn('flex flex-col gap-1.5', className)} data-slot='curation-agent-picker'>
      <Popover
        open={open}
        onOpenChange={handleOpenChange}
        align='start'
        sideOffset={4}
        trigger={trigger}
        modal
        className='w-[var(--radix-popover-trigger-width)] overflow-hidden rounded-xl border border-border bg-popover p-0 shadow-lg'
      >
        <div className='flex max-h-[min(320px,60vh)] flex-col'>
          {agents.length > MAX_VISIBLE_AGENTS && (
            <div className='shrink-0 border-b border-border bg-popover px-2.5 py-2'>
              <div className='flex items-center gap-2 rounded-lg bg-muted px-2.5 py-1.5'>
                <Search size={14} className='shrink-0 text-muted-foreground' />
                <input
                  type='text'
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder='Search agents…'
                  autoFocus
                  className='flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60'
                  data-track-category='Rooms'
                  data-track-name='SearchCurationAgents'
                  data-testid='curation-agent-search'
                />
              </div>
            </div>
          )}

          <div className='min-h-0 flex-1 overflow-y-auto p-1'>
            <button
              type='button'
              onClick={() => handleSelect(null)}
              className={cn(
                'flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left',
                'transition-colors duration-150 hover:bg-accent',
                value === null && 'bg-accent',
              )}
              data-track-category='Rooms'
              data-track-name='SelectCurationAgent'
              data-testid='curation-agent-default'
            >
              <Sparkles size={15} className='mt-0.5 shrink-0 text-muted-foreground' />
              <span className='min-w-0 flex-1'>
                <span className='block text-sm font-medium text-foreground'>Ask AI (default)</span>
                <span className='block text-xs text-muted-foreground [text-wrap:pretty]'>
                  Reads the room&apos;s sources and writes a cited summary. No setup needed.
                </span>
              </span>
              {value === null && (
                <Check size={15} className='mt-0.5 shrink-0 text-primary' strokeWidth={2.5} />
              )}
            </button>

            {(filteredAgents.length > 0 || isLoading) && (
              <div className='mx-1.5 my-1 h-px bg-border' />
            )}

            {isLoading &&
              [0, 1].map(index => (
                <div key={index} className='mx-1 my-1 h-9 animate-pulse rounded-lg bg-muted' />
              ))}

            {!isLoading &&
              filteredAgents.map(agent => (
                <button
                  key={agent.slug}
                  type='button'
                  onClick={() => handleSelect(agent.slug)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left',
                    'transition-colors duration-150 hover:bg-accent',
                    value === agent.slug && 'bg-accent',
                  )}
                  data-track-category='Rooms'
                  data-track-name='SelectCurationAgent'
                  data-track-metadata={JSON.stringify({ agentSlug: agent.slug })}
                >
                  <span
                    className={cn(
                      'inline-block size-3 shrink-0 rounded-full',
                      !agent.color && 'bg-muted-foreground',
                    )}
                    {...(agent.color ? { style: { backgroundColor: agent.color } } : {})}
                  />
                  <span className='min-w-0 flex-1 truncate text-sm font-medium text-foreground'>
                    {agent.name}
                  </span>
                  {value === agent.slug && (
                    <Check size={15} className='shrink-0 text-primary' strokeWidth={2.5} />
                  )}
                </button>
              ))}

            {!isLoading && isError && (
              <p className='px-2.5 py-3 text-center text-xs text-destructive [text-wrap:pretty]'>
                Couldn’t reach the agent service. Ask AI still works.
              </p>
            )}

            {!isLoading && !isError && agents.length === 0 && (
              <p className='px-2.5 py-3 text-center text-xs text-muted-foreground [text-wrap:pretty]'>
                No claw agents available — Ask AI will run this room.
              </p>
            )}

            {!isLoading && agents.length > 0 && filteredAgents.length === 0 && (
              <p className='px-2.5 py-3 text-center text-xs text-muted-foreground'>
                No agents match “{query}”.
              </p>
            )}
          </div>
        </div>
      </Popover>

      {isMissingAgent && (
        <p className='text-xs text-destructive [text-wrap:pretty]'>
          This agent is no longer available. Pick another, or switch back to Ask AI.
        </p>
      )}
    </div>
  );
}
