import { ReactElement, useMemo } from 'react';
import { searchByNameThenDescription } from '../shared/librarySearch';
import { useParams } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useClawAuthAgents } from '@/hooks/useClawAuthAgents';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';
import { groupAgentsByCategory } from '@/services/claw/agentCategory';
import { LibraryCard, LibraryIconTile } from '../shared/components/LibraryCard';
import { LibraryFilterMenu } from '../shared/components/LibraryFilterMenu';
import {
  LibrarySections,
  LibraryTabShell,
  type LibraryEmptyState,
} from '../shared/components/LibraryTabShell';
import { LibraryToolbarPortal } from '../shared/components/LibraryToolbarSlot';
import { useCategoryFilter } from '../shared/hooks/useCategoryFilter';

const AgentsV2 = ({ query }: { query: string }): ReactElement => {
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const prefixWs = (path: string): string => (workspaceId ? `/${workspaceId}${path}` : path);
  const { data, isLoading, isError, refetch } = useClawAuthAgents();
  const agents = useMemo(() => data ?? [], [data]);

  const { user } = useAuth();
  const userId = user?.id;

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

  const sections = useMemo(() => {
    const mine: Agent[] = [];
    const global: Agent[] = [];
    for (const agent of filtered) {
      (agent.ownerUserId === userId ? mine : global).push(agent);
    }
    return [
      { key: 'mine', label: 'Created', agents: mine },
      { key: 'global', label: 'Agents', agents: global },
    ].filter(section => section.agents.length > 0);
  }, [filtered, userId]);

  const emptyState: LibraryEmptyState | undefined =
    agents.length === 0
      ? {
          icon: '🤖',
          title: 'No agents yet',
          description: 'Agents you have access to will show up here.',
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
          />
        </LibraryToolbarPortal>
      }
      isLoading={isLoading}
      error={
        isError ? { message: "Couldn't load agents.", onRetry: () => void refetch() } : undefined
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
