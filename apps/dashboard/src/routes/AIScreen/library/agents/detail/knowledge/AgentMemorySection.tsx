import { useMemo, useState, type ReactElement } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { clawErrorText } from '@/services/claw/clawRequest';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';
import { Pill } from '../../../shared/primitives/Pill';
import { DetailListCard, type DetailListItem } from '../../../shared/primitives/DetailListCard';
import {
  DetailLockedNote,
  DetailSection,
  ReadOnlyBadge,
} from '../../../shared/primitives/DetailPrimitives';
import {
  agentMemoryKey,
  deleteAgentMemory,
  useAgentMemories,
  useAgentMemoryStatus,
} from './agentMemoryService';
import { MemoryManageDialog } from './MemoryManageDialog';

const LOCK_NOTE = 'Only the owner, a contributor, or an admin can change what this agent knows.';

const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function formatAdded(value: string | null): string {
  if (!value) return 'Added recently';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Added recently' : `Added ${DATE.format(parsed)}`;
}

/** What the agent remembers between sessions. Skills and documents live on the profile. */
export function AgentMemorySection({
  agent,
  canEdit,
}: {
  agent: Agent;
  canEdit: boolean;
}): ReactElement {
  const queryClient = useQueryClient();
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [removingMemory, setRemovingMemory] = useState(false);

  const memories = useAgentMemories(agent.slug);
  const memoryStatus = useAgentMemoryStatus(agent.slug);

  const memoryItems = useMemo<DetailListItem[]>(
    () =>
      (memories.data ?? []).map(memory => ({
        key: memory.id,
        name: memory.content,
        description: formatAdded(memory.createdAt),
        ...(memory.category ? { badge: <Pill tone='neutral'>{memory.category}</Pill> } : {}),
        ...(memory.recallHits7d > 0
          ? { meta: `${memory.recallHits7d} recall${memory.recallHits7d === 1 ? '' : 's'}` }
          : {}),
      })),
    [memories.data],
  );

  const removeMemory = async (id: string): Promise<void> => {
    if (removingMemory) return;
    setRemovingMemory(true);
    try {
      await deleteAgentMemory(agent.slug, id);
      void queryClient.invalidateQueries({ queryKey: agentMemoryKey(agent.slug) });
      toast.success('Memory removed');
    } catch (err) {
      toast.error(clawErrorText(err, 'Could not remove that memory'));
    } finally {
      setRemovingMemory(false);
    }
  };

  return (
    <div className='flex w-full flex-col gap-8'>
      <DetailSection
        label='Memory'
        info='Facts this agent carries between sessions'
        trailing={
          canEdit ? (
            <button
              type='button'
              onClick={() => setMemoryOpen(true)}
              aria-label='Manage memory'
              data-track-category='Claw Agents'
              data-track-name='Agent settings: manage memory'
              className='flex h-6 shrink-0 items-center rounded-md bg-muted px-1.5 text-sm leading-5 text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground'
            >
              Manage
            </button>
          ) : (
            <ReadOnlyBadge />
          )
        }
        trailingAlign='end'
      >
        <DetailListCard
          items={memoryItems}
          loading={memories.isLoading}
          emptyLabel={
            memoryStatus.data?.memoryEnabled === false
              ? 'Memory is off for this agent.'
              : 'Nothing remembered yet.'
          }
          canEdit={canEdit && !removingMemory}
          note={canEdit ? null : <DetailLockedNote>{LOCK_NOTE}</DetailLockedNote>}
          removeLabel={() => 'Forget this memory'}
          onRemove={item => void removeMemory(item.key)}
        />
      </DetailSection>

      <MemoryManageDialog
        open={memoryOpen}
        onOpenChange={setMemoryOpen}
        slug={agent.slug}
        status={memoryStatus.data}
        memoryCount={memoryItems.length}
        canEdit={canEdit}
      />
    </div>
  );
}
