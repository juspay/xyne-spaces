import { ReactElement, useMemo } from 'react';
import { searchByNameThenDescription } from '../shared/librarySearch';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiInstance } from '@/services/clients/apiClient';
import { useCachedQuery } from '@/hooks/useCachedQuery';
import { queries } from '@/zero/queries';
import { useAuth } from '@/hooks/useAuth';
import { useClawAuthAgents } from '@/hooks/useClawAuthAgents';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';
import { groupAgentsByCategory } from '@/services/claw/agentCategory';
import { isSpacesRegistered } from './detail/agentRegistration';
import { LibraryCard, LibraryIconTile } from '../shared/components/LibraryCard';
import { channelIcon } from '../shared/components/channelIcon';
import { LibraryFilterMenu } from '../shared/components/LibraryFilterMenu';
import {
  LibrarySections,
  LibraryTabShell,
  type LibraryEmptyState,
} from '../shared/components/LibraryTabShell';
import { LibraryToolbarPortal } from '../shared/components/LibraryToolbarSlot';
import { useCategoryFilter } from '../shared/hooks/useCategoryFilter';

const AgentsV2 = ({
  query,
  channelId,
}: {
  query: string;
  channelId?: string | undefined;
}): ReactElement => {
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const prefixWs = (path: string): string => (workspaceId ? `/${workspaceId}${path}` : path);
  const { data, isLoading, isError, refetch } = useClawAuthAgents();
  // `?hub=` picks the hub; inside an SDLC hub it defaults to that hub, `all` clears it.
  const [searchParams, setSearchParams] = useSearchParams();
  const hubParam = searchParams.get('hub');
  const hubId = hubParam === 'all' ? null : (hubParam ?? channelId ?? null);
  const setHubId = (id: string | null): void => {
    const next = new URLSearchParams(searchParams);
    if (id === (channelId ?? null)) next.delete('hub');
    else next.set('hub', id ?? 'all');
    setSearchParams(next, { replace: true });
  };
  const [channelStatuses] = useCachedQuery(queries.userVisibleChannelsV3());
  const hubs = useMemo(
    () =>
      (Array.isArray(channelStatuses) ? channelStatuses : [])
        .flatMap(status =>
          status.channel?.name
            ? [
                {
                  id: status.channel.id,
                  name: status.channel.name,
                  visibility: status.channel.visibility,
                },
              ]
            : [],
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [channelStatuses],
  );
  const hub = useQuery({
    queryKey: ['sdlc-hub-agents', hubId],
    queryFn: async () =>
      (
        await apiInstance.get<{ memberSlugs: string[]; pendingSlugs: string[] }>(
          `/sdlc/channels/${encodeURIComponent(hubId ?? '')}/agents`,
        )
      ).data,
    enabled: Boolean(hubId),
  });
  const agents = useMemo(() => {
    if (!hubId) return data ?? [];
    const inHub = new Set([...(hub.data?.memberSlugs ?? []), ...(hub.data?.pendingSlugs ?? [])]);
    return (data ?? []).filter(agent => inHub.has(agent.slug));
  }, [data, hubId, hub.data]);

  const q = query.trim();
  const searched = useMemo(
    () =>
      searchByNameThenDescription(agents, q, agent => ({
        name: agent.name,
        description: agent.description,
        ...(agent.slug && agent.slug !== agent.name ? { aliases: [agent.slug] as const } : {}),
      })),
    [agents, q],
  );

  const { filtered, activeId, setActive, options } = useCategoryFilter({
    items: searched,
    groupBy: groupAgentsByCategory,
  });

  const { user } = useAuth();
  const userId = user?.id;

  const sections = useMemo(() => {
    const mine: Agent[] = [];
    const global: Agent[] = [];
    const pending: Agent[] = [];
    for (const agent of filtered) {
      if (!isSpacesRegistered(agent)) pending.push(agent);
      else (agent.ownerUserId === userId ? mine : global).push(agent);
    }
    return [
      { key: 'mine', label: 'Created', agents: mine },
      { key: 'global', label: 'Agents', agents: global },
      { key: 'pending', label: 'Pending approval', agents: pending },
    ].filter(section => section.agents.length > 0);
  }, [filtered, userId]);

  const emptyState: LibraryEmptyState | undefined =
    agents.length === 0
      ? {
          icon: '🤖',
          title: 'No agents yet',
          description: hubId
            ? 'Agents in this channel, and ones created from it awaiting approval, show up here.'
            : 'Agents you have access to will show up here.',
        }
      : sections.length === 0
        ? {
            icon: '🔍',
            title: 'No matching agents',
            description: 'Try a different search or category.',
          }
        : undefined;

  return (
    <LibraryTabShell
      toolbar={
        <LibraryToolbarPortal>
          <LibraryFilterMenu
            title='Categories'
            options={options}
            activeId={activeId}
            onSelect={setActive}
            trackName='Filter agents by category'
            extraGroups={[
              {
                title: 'Channel',
                options: [
                  { id: 'all', label: 'All channels' },
                  ...hubs.map(channel => ({
                    id: channel.id,
                    label: channel.name,
                    icon: channelIcon(channel.visibility),
                  })),
                ],
                activeId: hubId,
                onSelect: setHubId,
              },
            ]}
          />
        </LibraryToolbarPortal>
      }
      isLoading={isLoading || (Boolean(hubId) && hub.isPending)}
      error={
        isError || hub.isError
          ? {
              message: "Couldn't load agents.",
              onRetry: () => void Promise.all([refetch(), hub.refetch()]),
            }
          : undefined
      }
      emptyState={emptyState}
    >
      <LibrarySections
        sections={sections.map(section => ({
          key: section.key,
          label: section.label,
          items: section.agents.map(agent => (
            <LibraryCard
              key={agent.id}
              to={prefixWs(`/ai/library/agent/${agent.slug}?tab=persona`)}
              testId='claw-agent-card'
              icon={<LibraryIconTile name={agent.name} color={agent.color || '#6366f1'} />}
              name={agent.name}
              description={agent.description}
            />
          )),
        }))}
      />
    </LibraryTabShell>
  );
};

export default AgentsV2;
