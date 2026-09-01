import { useState, type ReactElement } from 'react';
import { InformationCircle, PlusDefault } from '@xyne/icons';
import { Tooltip } from '@/components/ui/Tooltip/Tooltip';
import { BrowseCallableAgentsDialog } from './BrowseCallableAgentsDialog';
import { SubagentChip } from '../subagent/SubagentChip';
import { useCallableAgents } from './useCallableAgents';

const CAPTION = 'Hand a whole task to another agent, once its owner approves.';

interface CallableAgentCapabilityRowProps {
  agentSlug: string;
  agentOwnerUserId: string | null;
  selected: string[];
  onSelectedChange: (next: string[]) => void;
}

export function CallableAgentCapabilityRow({
  agentSlug,
  agentOwnerUserId,
  selected,
  onSelectedChange,
}: CallableAgentCapabilityRowProps): ReactElement {
  const [browseOpen, setBrowseOpen] = useState(false);
  const callable = useCallableAgents({
    agentSlug,
    agentOwnerUserId,
    selected,
    onSelectedChange,
  });

  const addedEntries = callable.catalog.filter(entry => entry.status !== null);

  return (
    <div className='flex w-full flex-col gap-1.5'>
      <div className='flex w-full items-center justify-between gap-4'>
        <div className='flex min-w-0 items-center gap-4'>
          <div className='flex shrink-0 items-center gap-2'>
            <span className='text-sm font-medium leading-[1.2] tracking-[-0.1px] text-foreground'>
              Agents
            </span>
            <Tooltip side='top' content={CAPTION}>
              <span className='inline-flex'>
                <InformationCircle className='size-4 text-muted-foreground' aria-hidden />
              </span>
            </Tooltip>
          </div>
          {addedEntries.length > 0 && (
            <span className='text-xs leading-5 tracking-[-0.24px] text-muted-foreground'>
              {addedEntries.length} added
            </span>
          )}
        </div>

        <button
          type='button'
          onClick={() => setBrowseOpen(true)}
          aria-label='Browse agents'
          data-track-category='Claw Agents'
          data-track-name='Create agent v2: browse callable agents'
          className='flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
        >
          <PlusDefault className='size-4' aria-hidden />
        </button>
      </div>

      <p className='text-sm leading-5 text-muted-foreground'>{CAPTION}</p>

      {addedEntries.length > 0 && (
        <div className='flex flex-wrap items-start gap-2 pt-1'>
          {addedEntries.map(entry => (
            <SubagentChip
              key={entry.slug}
              label={entry.status === 'pending' ? `${entry.name} · pending` : entry.name}
              selected
              onToggle={() => callable.remove(entry.slug)}
            />
          ))}
        </div>
      )}

      <BrowseCallableAgentsDialog
        open={browseOpen}
        onOpenChange={setBrowseOpen}
        catalog={callable.catalog}
        loading={callable.loading}
        isError={callable.isError}
        onRetry={callable.refetch}
        busySlug={callable.busySlug}
        onAdd={callable.add}
        onRemove={callable.remove}
      />
    </div>
  );
}
