import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, Plus } from 'lucide-react';
import { Dialog } from '../../ui/Dialog/Dialog';
import { fetchAccessibleClawAgents } from '../../../services/clawAgentListService';

export interface AddAgentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectAgent: (slug: string | null) => void;
}

export const AddAgentModal: React.FC<AddAgentModalProps> = ({
  open,
  onOpenChange,
  onSelectAgent,
}) => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  const { data: agents = [], isLoading } = useQuery({
    queryKey: ['accessible-claw-agents'],
    queryFn: fetchAccessibleClawAgents,
    staleTime: 60_000,
    enabled: open,
  });

  const filteredAgents = useMemo(() => {
    const withoutAskAI = agents.filter(a => a.slug !== 'ask-ai');
    if (!query.trim()) return withoutAskAI;
    const q = query.toLowerCase();
    return withoutAskAI.filter(a => a.name.toLowerCase().includes(q));
  }, [agents, query]);

  const handleSelect = (slug: string): void => {
    onSelectAgent(slug);
    setQuery('');
    onOpenChange(false);
  };

  const handleCreateNew = (): void => {
    onOpenChange(false);
    void navigate('/claw-agents/create');
  };

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        onOpenChange(next);
        if (!next) setQuery('');
      }}
      title='Add agent'
      className='w-[420px] max-w-[90vw] rounded-[14px] p-0'
    >
      <div className='flex flex-col'>
        <div className='border-b border-border px-4 py-3'>
          <div className='text-sm font-semibold text-foreground'>Add agent</div>
          <div className='text-desk-helper'>Pick a Claw agent to use for this channel</div>
        </div>

        <div className='px-4 pt-3'>
          <div className='flex items-center gap-2 rounded-md bg-muted px-2.5 py-2'>
            <Search size={14} className='shrink-0 text-muted-foreground' />
            <input
              type='text'
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder='Search agents…'
              autoFocus
              className='flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60'
              data-track-category='DeskSettings'
              data-track-name='SearchAddAgent'
            />
          </div>
        </div>

        <div className='max-h-[320px] overflow-y-auto px-2 py-2'>
          {isLoading ? (
            <div className='px-2 py-6 text-center text-sm text-muted-foreground'>Loading…</div>
          ) : filteredAgents.length === 0 ? (
            <div className='px-2 py-6 text-center text-sm text-muted-foreground'>
              {query ? `No agents match "${query}"` : 'No agents available'}
            </div>
          ) : (
            filteredAgents.map(agent => (
              <button
                key={agent.slug}
                type='button'
                onClick={() => handleSelect(agent.slug)}
                className='flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:bg-accent'
                data-track-category='DeskSettings'
                data-track-name='SelectAddAgent'
                data-track-metadata={JSON.stringify({ agentSlug: agent.slug })}
              >
                <span
                  className='inline-block h-2.5 w-2.5 shrink-0 rounded-full'
                  style={{ backgroundColor: agent.color || 'var(--desk-accent)' }}
                />
                <span className='truncate font-medium'>{agent.name}</span>
              </button>
            ))
          )}
        </div>

        <div className='border-t border-border p-2'>
          <button
            type='button'
            onClick={handleCreateNew}
            className='flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm font-medium text-desk-accent transition-colors hover:bg-accent'
            data-track-category='DeskSettings'
            data-track-name='CreateNewAgentFromModal'
          >
            <Plus size={14} className='shrink-0' />
            Create new agent
          </button>
        </div>
      </div>
    </Dialog>
  );
};
