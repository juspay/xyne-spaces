import { ReactElement, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { Tooltip } from '@/components/ui/Tooltip/Tooltip';
import { McpServerIcon } from '@/components/ClawAgents/McpServerIcon';
import { useClawMcp } from '@/hooks/useClawMcp';
import type { McpServer } from '@/services/claw/clawMcpTypes';
import { groupMcpsByCategory } from '@/services/claw/agentCategory';
import { LibraryCard } from './components/LibraryCard';
import { LibraryFilterMenu } from './components/LibraryFilterMenu';
import {
  LibrarySections,
  LibraryTabShell,
  type LibraryEmptyState,
} from './components/LibraryTabShell';
import { LibraryToolbarPortal } from './components/LibraryToolbarSlot';
import { useCategoryFilter } from './hooks/useCategoryFilter';

const McpV2 = ({ query }: { query: string }): ReactElement => {
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const mcpDetailPath = (id: string): string =>
    workspaceId ? `/${workspaceId}/ai/library/mcp/${id}` : `/ai/library/mcp/${id}`;
  const { data, isLoading, isError, refetch } = useClawMcp();
  const servers = useMemo(() => data?.servers ?? [], [data]);
  const connections = useMemo(() => data?.connections ?? [], [data]);

  const q = query.trim().toLowerCase();
  const searched = useMemo(
    () =>
      q
        ? servers.filter(s => `${s.name} ${s.description ?? ''}`.toLowerCase().includes(q))
        : servers,
    [servers, q],
  );

  const { filtered, activeId, setActive, options } = useCategoryFilter({
    items: searched,
    groupBy: groupMcpsByCategory,
  });

  const connectedServerIds = useMemo(
    () => new Set(connections.map(c => c.mcpServerId)),
    [connections],
  );

  const sections = useMemo(() => {
    const connected: McpServer[] = [];
    const available: McpServer[] = [];
    for (const server of filtered) {
      (connectedServerIds.has(server.id) ? connected : available).push(server);
    }
    return [
      { key: 'connected', label: 'Connected', servers: connected },
      { key: 'available', label: 'Available', servers: available },
    ].filter(section => section.servers.length > 0);
  }, [filtered, connectedServerIds]);

  const emptyState: LibraryEmptyState | undefined =
    servers.length === 0
      ? {
          icon: '🔌',
          title: 'No MCP servers yet',
          description: 'MCP servers you have access to will show up here.',
        }
      : sections.length === 0
        ? {
            icon: '🔍',
            title: 'No matching MCP servers',
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
            trackName='Filter MCP by category'
          />
        </LibraryToolbarPortal>
      }
      isLoading={isLoading}
      error={
        isError
          ? { message: "Couldn't load MCP servers.", onRetry: () => void refetch() }
          : undefined
      }
      emptyState={emptyState}
    >
      <LibrarySections
        sections={sections.map(section => ({
          key: section.key,
          label: section.label,
          items: section.servers.map(server => {
            const isConnected = connectedServerIds.has(server.id);
            return (
              <LibraryCard
                key={server.id}
                to={mcpDetailPath(server.id)}
                testId='claw-mcp-card'
                dimmed={server.enabled === false}
                icon={<McpServerIcon server={server} size='sm' />}
                name={server.name}
                meta={isConnected ? 'Connected' : undefined}
                statusDot={
                  isConnected ? (
                    <Tooltip side='top' content='Connected'>
                      <span className='size-2 shrink-0 rounded-full bg-emerald-500' />
                    </Tooltip>
                  ) : undefined
                }
                description={server.description ?? undefined}
              />
            );
          }),
        }))}
      />
    </LibraryTabShell>
  );
};

export default McpV2;
