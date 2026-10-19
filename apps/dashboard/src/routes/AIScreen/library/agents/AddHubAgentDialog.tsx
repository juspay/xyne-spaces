import { useMemo, useState, type ReactElement } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button/index';
import { useClawAuthAgents } from '@/hooks/useClawAuthAgents';
import { apiInstance } from '@/services/clients/apiClient';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';
import { searchByNameThenDescription } from '../shared/librarySearch';
import { LibraryIconTile } from '../shared/components/LibraryCard';
import { V2Dialog } from '../shared/primitives/V2Dialog';
import { isSpacesRegistered } from './detail/agentRegistration';
import { sdlcHubAgentsKey, useSdlcHubAgents, type SdlcHubAgents } from './useSdlcHubAgents';

interface AddHubAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hubId: string;
}

/** Pick an agent you can already use and add it to an SDLC hub as a member. */
export function AddHubAgentDialog({
  open,
  onOpenChange,
  hubId,
}: AddHubAgentDialogProps): ReactElement {
  const queryClient = useQueryClient();
  const { data: agents, isLoading, isError } = useClawAuthAgents();
  const hub = useSdlcHubAgents(hubId);
  const [query, setQuery] = useState('');

  // Only approved agents can join; the rest are already here or pending in this hub.
  const candidates = useMemo(() => {
    const inHub = new Set([...(hub.data?.memberSlugs ?? []), ...(hub.data?.pendingSlugs ?? [])]);
    const eligible = (agents ?? []).filter(
      agent => isSpacesRegistered(agent) && !inHub.has(agent.slug),
    );
    return searchByNameThenDescription(eligible, query.trim(), agent => ({
      name: agent.name,
      description: agent.description,
    }));
  }, [agents, hub.data, query]);

  const add = useMutation<{ slug: string }, Error, Agent>({
    mutationFn: async agent =>
      (
        await apiInstance.post<{ slug: string }>(
          `/sdlc/channels/${encodeURIComponent(hubId)}/agents`,
          { agentId: agent.id },
        )
      ).data,
    onSuccess: ({ slug }, agent) => {
      queryClient.setQueryData<SdlcHubAgents>(sdlcHubAgentsKey(hubId), old =>
        old ? { ...old, memberSlugs: [...old.memberSlugs, slug] } : old,
      );
      void queryClient.invalidateQueries({ queryKey: sdlcHubAgentsKey(hubId) });
      toast.success(`${agent.name} added to the hub`);
      onOpenChange(false);
    },
    onError: () => {
      toast.error("Couldn't add the agent to this hub.");
    },
  });

  const loading = isLoading || hub.isPending;
  const failed = isError || hub.isError;

  return (
    <V2Dialog
      open={open}
      onOpenChange={next => {
        if (!next) setQuery('');
        onOpenChange(next);
      }}
      title='Add an agent'
      description='Add an agent you can already use to this hub.'
      testId='add-hub-agent-dialog'
      className='max-w-[520px]'
    >
      <input
        type='text'
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder='Search agents'
        aria-label='Search agents'
        autoFocus
        data-track-category='SdlcHub'
        data-track-name='Search add existing agent'
        className='h-9 w-full rounded-xl border border-border bg-card px-3.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring'
      />
      <div className='flex max-h-[360px] w-full flex-col gap-1 overflow-y-auto'>
        {loading ? (
          <p className='px-1 py-3 text-sm text-muted-foreground'>Loading agents…</p>
        ) : failed ? (
          <p role='alert' className='px-1 py-3 text-sm text-destructive'>
            Couldn&apos;t load agents.
          </p>
        ) : candidates.length === 0 ? (
          <p className='px-1 py-3 text-sm text-muted-foreground'>
            {query.trim()
              ? 'No matching agents.'
              : 'Every agent you can use is already in this hub.'}
          </p>
        ) : (
          candidates.map(agent => (
            <div
              key={agent.id}
              className='flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-muted/60'
              data-testid='add-hub-agent-row'
            >
              <LibraryIconTile name={agent.name} color={agent.color || '#6366f1'} />
              <div className='flex min-w-0 flex-1 flex-col'>
                <span className='truncate text-sm font-medium text-foreground'>{agent.name}</span>
                {agent.description && (
                  <span className='truncate text-xs text-muted-foreground'>
                    {agent.description}
                  </span>
                )}
              </div>
              <Button
                type='button'
                variant='outline'
                className='shrink-0 rounded-xl'
                disabled={add.isPending}
                onClick={() => add.mutate(agent)}
                data-track-category='SdlcHub'
                data-track-name='Add existing agent to hub'
              >
                {add.isPending && add.variables?.id === agent.id ? 'Adding…' : 'Add'}
              </Button>
            </div>
          ))
        )}
      </div>
    </V2Dialog>
  );
}
