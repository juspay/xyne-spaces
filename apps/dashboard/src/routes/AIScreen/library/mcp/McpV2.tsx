import { ReactElement, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { searchByNameThenDescription } from '../shared/librarySearch';
import { McpServerIcon } from '@/components/ClawAgents/McpServerIcon';
import { useClawMcp } from '@/hooks/useClawMcp';
import type { McpServer } from '@/services/claw/clawMcpTypes';
import { groupMcpsByCategory } from '@/services/claw/agentCategory';
import { LibraryCard } from '../shared/components/LibraryCard';
import { LibraryFilterMenu } from '../shared/components/LibraryFilterMenu';
import {
  LibrarySections,
  LibraryTabShell,
  type LibraryEmptyState,
} from '../shared/components/LibraryTabShell';
import { LibraryToolbarPortal } from '../shared/components/LibraryToolbarSlot';
import { useCategoryFilter } from '../shared/hooks/useCategoryFilter';
import { Badge } from '@/components/ui/Badge';
import { Pill } from '../shared/primitives/Pill';

const McpV2 = ({ query }: { query: string }): ReactElement => {
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const prefixWs = (path: string): string => (workspaceId ? `/${workspaceId}${path}` : path);
  const { data, isLoading, isError, refetch } = useClawMcp();
  const servers = useMemo(() => data?.servers ?? [], [data]);
  const connections = useMemo(() => data?.connections ?? [], [data]);

  const q = query.trim();
  const searched = useMemo(
    () =>
      searchByNameThenDescription(servers, q, server => ({
        name: server.name,
        description: server.description,
      })),
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
      cardVariant='flat'
    >
      <LibrarySections
        sections={sections.map(section => ({
          key: section.key,
          label: section.label,
          items: section.servers.map(server => {
            const connected = connectedServerIds.has(server.id);
            return (
              <LibraryCard
                key={server.id}
                to={prefixWs(`/ai/library/mcp/${encodeURIComponent(server.type)}`)}
                testId='claw-mcp-card'
                dimmed={server.enabled === false}
                variant='flat'
                chevron
                highlighted={connected}
                icon={<McpServerIcon server={server} size='tile' />}
                name={server.name}
                description={server.description ?? undefined}
                meta={
                  connected || server.oauth ? (
                    <>
                      {connected ? (
                        <Pill tone='success' size='md'>
                          Connected
                        </Pill>
                      ) : null}
                      {server.oauth ? (
                        <Badge
                          variant='secondary'
                          className='px-1.5 py-0 text-[10px] leading-tight'
                        >
                          OAuth
                        </Badge>
                      ) : null}
                    </>
                  ) : undefined
                }
              />
            );
          }),
        }))}
      />
    </LibraryTabShell>
  );
};

export default McpV2;
