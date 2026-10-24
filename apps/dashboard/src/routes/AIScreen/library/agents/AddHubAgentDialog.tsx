import { ReactElement, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { useZero } from '@/hooks/useZero';
import { mutators } from '@/zero/mutators';
import { useClawAuthAgents } from '@/hooks/useClawAuthAgents';
import { Button } from '@/components/ui/Button/index';
import Input from '@/components/ui/Input';
import { SkeletonRows } from '@/routes/SdlcScreen/AddSkillList';
import { V2Dialog } from '../shared/primitives/V2Dialog';
import { LibraryIconTile } from '../shared/components/LibraryCard';
import { useHubAgents } from './AgentsV2';

interface AddHubAgentDialogProps {
  channelId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Approved agents not yet in the hub. Adding one adds its bot user as a channel member, as Add members does. */
export function AddHubAgentDialog({
  channelId,
  open,
  onOpenChange,
}: AddHubAgentDialogProps): ReactElement {
  const queryClient = useQueryClient();
  const zero = useZero();
  const { data, isLoading } = useClawAuthAgents();
  const hubKey = ['sdlc-hub-agents', channelId];
  const { data: hub } = useHubAgents(channelId);
  const [query, setQuery] = useState('');

  const candidates = useMemo(() => {
    const inHub = new Set([...(hub?.memberSlugs ?? []), ...(hub?.pendingSlugs ?? [])]);
    const q = query.trim().toLowerCase();
    return (data ?? []).filter(
      agent =>
        agent.spacesAppUserId &&
        !inHub.has(agent.slug) &&
        (!q || agent.name.toLowerCase().includes(q) || agent.slug.toLowerCase().includes(q)),
    );
  }, [data, hub, query]);

  const add = useMutation({
    mutationFn: async (agent: { slug: string; spacesAppUserId: string | null }) => {
      const userId = agent.spacesAppUserId ?? '';
      const res = await zero.mutate(
        mutators.channel.addParticipants({
          channelId,
          userIds: [userId],
          timestamp: Date.now(),
          participantIds: { [userId]: uuidv4() },
          userStatusIds: { [userId]: uuidv4() },
        }),
      ).server;
      if (res.type === 'error') throw new Error(res.error?.message);
    },
    onSuccess: (_, agent) => {
      queryClient.setQueryData<{ memberSlugs: string[]; pendingSlugs: string[] }>(hubKey, old =>
        old ? { ...old, memberSlugs: [...old.memberSlugs, agent.slug] } : old,
      );
      void queryClient.invalidateQueries({ queryKey: hubKey });
    },
    onError: err => toast.error(err.message || 'Could not add the agent to this hub.'),
  });

  return (
    <V2Dialog
      open={open}
      onOpenChange={onOpenChange}
      title='Add agent'
      description='Add an existing agent to this hub. Hub members can then use it here.'
      testId='add-hub-agent-dialog'
    >
      <div className='relative'>
        <Search
          size={14}
          className='pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground'
        />
        <Input
          autoFocus
          className='h-9 pl-9'
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder='Search agents'
          aria-label='Search agents'
          data-track-category='Claw Agents'
          data-track-name='Add hub agent: search'
        />
      </div>
      {isLoading ? (
        <SkeletonRows />
      ) : candidates.length === 0 ? (
        <p className='px-2 py-3 text-sm text-muted-foreground'>
          {query.trim() ? 'No matching agents.' : 'Every agent you can add is already in this hub.'}
        </p>
      ) : (
        <ul className='-mx-2 flex flex-col'>
          {candidates.map(agent => (
            <li
              key={agent.id}
              className='flex min-h-[4.5rem] items-center gap-3 rounded-lg px-2 py-3 hover:bg-muted/40'
            >
              <LibraryIconTile name={agent.name} color={agent.color || '#6366f1'} />
              <div className='min-w-0 flex-1'>
                <p className='truncate text-sm font-medium' title={agent.name}>
                  {agent.name}
                </p>
                {agent.description && (
                  <p className='line-clamp-2 text-xs text-muted-foreground'>{agent.description}</p>
                )}
              </div>
              <Button
                type='button'
                size='sm'
                variant='outline'
                aria-label={`Add ${agent.name}`}
                disabled={add.isPending}
                onClick={() => add.mutate(agent)}
                data-track-category='Claw Agents'
                data-track-name='Add hub agent: add'
              >
                Add
              </Button>
            </li>
          ))}
        </ul>
      )}
    </V2Dialog>
  );
}
