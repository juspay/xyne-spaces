import { ReactElement, useState } from 'react';
import { Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { useClawAgentMemories } from '@/hooks/useClawAgentMemories';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';
import type { AgentPermissions } from '@/services/claw/agentPermissions';
import { DetailSection, EmptyPanel, formatDateTime, InfoRow } from './detailTabUtils';

interface MemoryTabProps {
  agent: Agent;
  permissions: AgentPermissions;
}

type ApprovalStrategy = 'HUMAN_ONLY' | 'EVALS_ONLY' | 'EVALS_THEN_HUMAN';

const readBool = (value: unknown): boolean => value === true || value === 'true';

const readApprovalStrategy = (value: unknown): ApprovalStrategy => {
  if (value === 'EVALS_ONLY' || value === 'EVALS_THEN_HUMAN') return value;
  return 'HUMAN_ONLY';
};

const strategyLabel = (strategy: ApprovalStrategy): string => {
  switch (strategy) {
    case 'EVALS_ONLY':
      return 'Evals only';
    case 'EVALS_THEN_HUMAN':
      return 'Evals, then human review';
    case 'HUMAN_ONLY':
    default:
      return 'Human review';
  }
};

const MemoryTab = ({ agent, permissions }: MemoryTabProps): ReactElement => {
  const [search, setSearch] = useState('');
  const { data, isLoading, remove } = useClawAgentMemories(agent.slug, search);
  const memoryEnabled = readBool(agent.config['memoryEnabled']);
  const sharedAllowed = readBool(agent.config['memorySharedAllowed']);
  const approvalStrategy = readApprovalStrategy(agent.config['memoryApprovalStrategy']);

  const deleteMemory = async (hindsightMemoryId: string): Promise<void> => {
    if (!window.confirm('Delete this memory permanently? Recall history will be retained.')) return;
    try {
      await remove.mutateAsync(hindsightMemoryId);
      toast.success('Memory deleted');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete memory');
    }
  };

  return (
    <div className='flex max-w-2xl flex-col gap-6'>
      <DetailSection
        title='Agent memory'
        description='Controls whether this agent can retain and search longer-lived memories from completed runs.'
      >
        <div className='divide-y divide-border rounded-lg border border-border px-4 py-1'>
          <InfoRow
            label='Status'
            value={
              <Badge variant={memoryEnabled ? 'success' : 'outline'}>
                {memoryEnabled ? 'Enabled' : 'Disabled'}
              </Badge>
            }
          />
          <InfoRow
            label='Shared memory'
            value={sharedAllowed ? 'Allowed across users' : 'Private to the running user'}
          />
          <InfoRow label='Approval' value={strategyLabel(approvalStrategy)} />
        </div>
      </DetailSection>

      <DetailSection title='Runtime behavior'>
        <div className='rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm leading-relaxed text-muted-foreground'>
          {memoryEnabled
            ? 'Runs can call memory-search when a question overlaps retained context. New memories are proposed from completed runs and follow the approval policy above.'
            : 'Memory is off for this agent. Runs will not receive the memory-search tool, and completed sessions will not be queued for retention.'}
        </div>
      </DetailSection>

      <DetailSection
        title='Stored memories'
        description='Approved memories retained in this agent’s Hindsight bank.'
      >
        <div className='relative'>
          <Search className='absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground' />
          <Input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder='Search memories…'
            className='pl-9'
          />
        </div>
        {isLoading ? (
          <div className='mt-3 flex flex-col gap-2'>
            <Skeleton className='h-20 w-full' />
            <Skeleton className='h-20 w-full' />
          </div>
        ) : !data?.memories.length ? (
          <div className='mt-3'>
            <EmptyPanel
              title={search ? 'No matching memories' : 'No memories yet'}
              description={
                search ? 'Try another search term.' : 'Approved memories will appear here.'
              }
            />
          </div>
        ) : (
          <div className='mt-3 flex flex-col gap-2'>
            <p className='text-xs text-muted-foreground'>
              Showing {data.memories.length} of {data.total}
            </p>
            {data.memories.map(memory => (
              <div key={memory.id} className='rounded-lg border border-border p-3'>
                <div className='flex items-center gap-2'>
                  {memory.category && <Badge variant='outline'>{memory.category}</Badge>}
                  <span className='text-xs text-muted-foreground'>
                    {formatDateTime(memory.createdAt)}
                  </span>
                  {memory.recallHits7d > 0 && (
                    <span className='text-xs text-muted-foreground'>
                      {memory.recallHits7d} recalls in 7d
                    </span>
                  )}
                  {permissions.canEdit && (
                    <Button
                      type='button'
                      variant='ghost'
                      size='iconSm'
                      disabled={remove.isPending}
                      onClick={() => void deleteMemory(memory.hindsightMemoryId)}
                      data-track-category='Claw Agents'
                      data-track-name='DELETE_MEMORY'
                      aria-label='Delete memory'
                      className='ml-auto text-muted-foreground hover:text-destructive'
                    >
                      <Trash2 className='size-4' />
                    </Button>
                  )}
                </div>
                <p className='mt-2 text-sm leading-relaxed text-foreground'>{memory.content}</p>
                {memory.curatorReasoning && (
                  <p className='mt-2 rounded-md bg-muted/40 p-2 text-xs text-muted-foreground'>
                    {memory.curatorReasoning}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </DetailSection>
    </div>
  );
};

export default MemoryTab;
