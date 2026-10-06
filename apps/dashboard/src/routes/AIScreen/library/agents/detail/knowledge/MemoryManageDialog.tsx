import { useMemo, useState, type ReactElement } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { SearchDefault } from '@xyne/icons';
import { Button } from '@/components/ui/Button/index';
import { clawErrorText } from '@/services/claw/clawRequest';
import { V2Dialog } from '../../../shared/primitives/V2Dialog';
import { BehaviourRow, BehaviourToggle } from '../behaviour/BehaviourRows';
import { DetailCard } from '../../../shared/primitives/DetailPrimitives';
import { DetailListCard, type DetailListItem } from '../../../shared/primitives/DetailListCard';
import { Pill } from '../../../shared/primitives/Pill';
import {
  agentMemoryKey,
  agentMemoryStatusKey,
  clearAgentMemories,
  deleteAgentMemory,
  setAgentMemoryEnabled,
  useAgentMemories,
  type AgentMemory,
  type AgentMemoryStatus,
} from './agentMemoryService';

const APPROVAL_LABELS: Record<AgentMemoryStatus['memoryApprovalStrategy'], string> = {
  HUMAN_ONLY: 'Human review',
  EVALS_ONLY: 'Auto via evals',
  EVALS_THEN_HUMAN: 'Evals, then human',
};

// Mirrors AgentActivityTabV2's relative-date convention: recent as "Nd ago",
// older as a localized date.
function formatMemoryDate(iso: string | null): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  const days = Math.floor((Date.now() - parsed.getTime()) / 86_400_000);
  return days < 14 ? `${days}d ago` : parsed.toLocaleDateString();
}

function memoryMeta(memory: AgentMemory): string {
  const parts: string[] = [];
  const date = formatMemoryDate(memory.createdAt);
  if (date) parts.push(date);
  if (memory.recallHits7d > 0) parts.push(`${memory.recallHits7d} recalls in 7d`);
  return parts.join(' · ');
}

interface MemoryManageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  status: AgentMemoryStatus | undefined;
  memoryCount: number;
  canEdit: boolean;
}

export function MemoryManageDialog({
  open,
  onOpenChange,
  slug,
  status,
  memoryCount,
  canEdit,
}: MemoryManageDialogProps): ReactElement {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [search, setSearch] = useState('');

  const enabled = status?.memoryEnabled ?? false;
  const memories = useAgentMemories(slug);

  const filtered = useMemo(() => {
    const all = memories.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      memory =>
        memory.content.toLowerCase().includes(q) ||
        (memory.category ?? '').toLowerCase().includes(q),
    );
  }, [memories.data, search]);

  const memoryItems: DetailListItem[] = filtered.map(memory => ({
    key: memory.id,
    name: memory.category ?? 'Memory',
    description: memory.content,
    ...(memory.scope === 'shared' ? { badge: <Pill tone='neutral'>Shared</Pill> } : {}),
    meta: memoryMeta(memory),
  }));

  const deleteOne = useMutation({
    mutationFn: (memory: AgentMemory) => deleteAgentMemory(slug, memory.hindsightMemoryId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: agentMemoryKey(slug) });
      toast.success('Memory deleted');
    },
    onError: err => toast.error(clawErrorText(err, 'Could not delete the memory')),
  });

  const toggleEnabled = async (next: boolean): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const updated = await setAgentMemoryEnabled(slug, next);
      queryClient.setQueryData(agentMemoryStatusKey(slug), updated);
      toast.success(next ? 'Memory enabled' : 'Memory disabled');
    } catch (err) {
      toast.error(clawErrorText(err, 'Could not change the memory setting'));
    } finally {
      setBusy(false);
    }
  };

  const clearAll = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await clearAgentMemories(slug);
      void queryClient.invalidateQueries({ queryKey: agentMemoryKey(slug) });
      toast.success('All memories cleared');
      setConfirmClear(false);
    } catch (err) {
      toast.error(clawErrorText(err, 'Could not clear the memories'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <V2Dialog
      open={open}
      onOpenChange={next => {
        setConfirmClear(false);
        setSearch('');
        onOpenChange(next);
      }}
      title='Memory'
      description='What this agent remembers between sessions.'
      testId='memory-manage-dialog'
      width='wide'
      footer={
        <Button
          variant='ghost'
          onClick={() => onOpenChange(false)}
          className='h-auto rounded-xl px-3 py-2.5 text-[15px]'
          data-track-category='Claw Agents'
          data-track-name='Agent detail v2: close memory dialog'
        >
          Done
        </Button>
      }
    >
      <p className='text-sm font-normal leading-5 text-muted-foreground'>
        When memory is on, each session is summarised by the nightly curator and the useful facts
        are recalled at the start of later sessions.
      </p>

      <DetailCard>
        <BehaviourRow
          title='Memory enabled'
          hint='Enrols this agent in the memory pipeline from its next session onwards.'
        >
          <BehaviourToggle
            checked={enabled}
            editable={canEdit}
            disabled={busy}
            label='Memory enabled'
            trackName='Agent detail v2: toggle memory'
            onChange={next => void toggleEnabled(next)}
          />
        </BehaviourRow>

        <BehaviourRow title='Approval' hint='How a curated memory gets accepted into the bank.'>
          <span className='text-sm font-normal leading-5 text-foreground'>
            {APPROVAL_LABELS[status?.memoryApprovalStrategy ?? 'HUMAN_ONLY']}
          </span>
        </BehaviourRow>

        <BehaviourRow
          title='Shared memory'
          hint='Whether a memory learned from one user is visible to everyone who runs this agent.'
          last
        >
          <span className='text-sm font-normal leading-5 text-foreground'>
            {status?.memorySharedAllowed ? 'Allowed across users' : 'Private to the running user'}
          </span>
        </BehaviourRow>
      </DetailCard>

      <section className='flex w-full flex-col gap-3'>
        <span className='text-sm font-medium leading-[1.2] tracking-[-0.1px] text-foreground'>
          Stored memories
        </span>

        <div className='relative'>
          <SearchDefault className='pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
          <input
            type='text'
            value={search}
            onChange={e => setSearch(e.target.value)}
            data-track-category='Claw Agents'
            data-track-name='Agent detail v2: search memories'
            placeholder='Search memories…'
            className='h-9 w-full rounded-[10px] border border-border bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'
          />
        </div>

        <DetailListCard
          items={memoryItems}
          loading={memories.isLoading}
          emptyLabel={search ? 'No matching memories' : 'Approved memories will appear here.'}
          canEdit={canEdit}
          removeLabel={() => 'Delete memory'}
          onRemove={item => {
            const memory = filtered.find(m => m.id === item.key);
            if (
              memory &&
              window.confirm('Delete this memory permanently? Recall history is kept.')
            ) {
              deleteOne.mutate(memory);
            }
          }}
        />
      </section>

      {canEdit && (
        <section className='flex w-full flex-col gap-3'>
          <span className='text-sm font-medium leading-[1.2] tracking-[-0.1px] text-foreground'>
            Clear memories
          </span>
          <p className='text-sm font-normal leading-5 text-muted-foreground'>
            Deletes all {memoryCount} stored {memoryCount === 1 ? 'memory' : 'memories'} for this
            agent. This can&apos;t be undone.
          </p>
          {confirmClear ? (
            <div className='flex items-center gap-3'>
              <Button
                variant='ghost'
                onClick={() => setConfirmClear(false)}
                disabled={busy}
                className='h-auto rounded-xl px-3 py-2 text-sm'
                data-track-category='Claw Agents'
                data-track-name='Agent detail v2: cancel clear memories'
              >
                Cancel
              </Button>
              <Button
                onClick={() => void clearAll()}
                loading={busy}
                className='h-auto rounded-xl bg-destructive px-3 py-2 text-sm text-destructive-foreground hover:bg-destructive/90'
                data-track-category='Claw Agents'
                data-track-name='Agent detail v2: confirm clear memories'
              >
                Yes, clear everything
              </Button>
            </div>
          ) : (
            <Button
              variant='ghost'
              onClick={() => setConfirmClear(true)}
              disabled={busy || memoryCount === 0}
              className='h-auto w-fit rounded-xl px-3 py-2 text-sm text-destructive hover:bg-destructive/10'
              data-track-category='Claw Agents'
              data-track-name='Agent detail v2: clear memories'
            >
              Clear all memories
            </Button>
          )}
        </section>
      )}
    </V2Dialog>
  );
}
