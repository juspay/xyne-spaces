import { ReactElement, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { cn } from '@/utils/classNames';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/Board/EmptyState/EmptyState';
import { Tooltip } from '@/components/ui/Tooltip/Tooltip';
import { McpServerIcon } from '@/components/ClawAgents/McpServerIcon';
import { useClawMcp } from '@/hooks/useClawMcp';
import { Badge } from '@/components/ui/Badge';
import type { McpServer } from '@/services/claw/clawMcpTypes';
import {
  AGENT_CATEGORIES,
  groupMcpsByCategory,
  type AgentCategoryId,
} from '@/services/claw/agentCategory';

const McpCard = ({
  server,
  connected,
}: {
  server: McpServer;
  connected: boolean;
}): ReactElement => (
  <Link
    to={`/claw-agents/mcp/${server.id}`}
    data-testid='claw-mcp-card'
    className={cn(
      'group/item flex w-full items-start gap-3.5 rounded-2xl border border-transparent bg-muted/50 px-4 py-3.5 text-sm transition-colors hover:bg-muted',
      server.enabled === false && 'opacity-60',
    )}
  >
    <McpServerIcon server={server} />
    <div className='flex min-w-0 flex-1 flex-col gap-1'>
      <div className='flex min-w-0 items-center gap-2'>
        {connected && (
          <Tooltip side='top' content='Connected'>
            <span className='size-2 shrink-0 rounded-full bg-emerald-500' />
          </Tooltip>
        )}
        <span className='truncate text-sm font-medium leading-snug text-foreground'>
          {server.name}
        </span>
        {server.oauth && (
          <Badge variant='secondary' className='px-1.5 py-0 text-[10px] leading-tight'>
            OAuth
          </Badge>
        )}
      </div>
      {server.description && (
        <p className='line-clamp-2 text-sm text-muted-foreground'>{server.description}</p>
      )}
    </div>
  </Link>
);

const McpCardSkeleton = (): ReactElement => (
  <div className='flex w-full items-start gap-3.5 rounded-2xl border border-transparent bg-muted/50 px-4 py-3.5'>
    <Skeleton className='size-10 shrink-0 rounded-lg' />
    <div className='flex flex-1 flex-col gap-2'>
      <Skeleton className='h-3.5 w-32' />
      <Skeleton className='h-3 w-full max-w-52' />
      <Skeleton className='h-3 w-40' />
    </div>
  </div>
);

const FilterButton = ({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}): ReactElement => (
  <button
    type='button'
    onClick={onClick}
    data-track-category='Claw Agents'
    data-track-name={`Filter MCPs by category: ${label}`}
    className={cn(
      'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
      active
        ? 'bg-muted font-medium text-foreground'
        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
    )}
  >
    <span className='truncate'>{label}</span>
    <span className='shrink-0 text-xs tabular-nums text-muted-foreground'>{count}</span>
  </button>
);

const serverMatchesSearch = (server: McpServer, q: string): boolean =>
  `${server.name} ${server.description ?? ''}`.toLowerCase().includes(q);

const McpTab = (): ReactElement => {
  const { data, isLoading, isError, refetch } = useClawMcp();
  const servers = useMemo(() => data?.servers ?? [], [data]);
  const connections = useMemo(() => data?.connections ?? [], [data]);

  // Search + category filters live in the URL (?q=&category=) so the view is
  // shareable and survives navigation, mirroring the ?tab= pattern on the
  // agent detail screen.
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('q') ?? '';
  const rawCategory = searchParams.get('category');
  const activeCategory: AgentCategoryId | null =
    rawCategory && AGENT_CATEGORIES.some(cat => cat.id === rawCategory)
      ? (rawCategory as AgentCategoryId)
      : null;

  const setQuery = (value: string): void => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set('q', value);
    else next.delete('q');
    setSearchParams(next, { replace: true });
  };

  const setActiveCategory = (id: AgentCategoryId | null): void => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set('category', id);
    else next.delete('category');
    setSearchParams(next, { replace: true });
  };

  const q = query.trim().toLowerCase();

  const searchFiltered = useMemo(
    () => (q ? servers.filter(s => serverMatchesSearch(s, q)) : servers),
    [servers, q],
  );

  const groupedByCategory = useMemo(() => groupMcpsByCategory(searchFiltered), [searchFiltered]);

  const idToCategory = useMemo(() => {
    const map = new Map<string, AgentCategoryId>();
    for (const [catId, list] of groupedByCategory) {
      for (const server of list) map.set(server.id, catId);
    }
    return map;
  }, [groupedByCategory]);

  const visibleCategories = useMemo(
    () => AGENT_CATEGORIES.filter(cat => (groupedByCategory.get(cat.id)?.length ?? 0) > 0),
    [groupedByCategory],
  );

  const effectiveCategory =
    activeCategory && (groupedByCategory.get(activeCategory)?.length ?? 0) > 0
      ? activeCategory
      : null;

  const categoryFiltered = useMemo(
    () =>
      effectiveCategory
        ? searchFiltered.filter(s => idToCategory.get(s.id) === effectiveCategory)
        : searchFiltered,
    [searchFiltered, effectiveCategory, idToCategory],
  );

  // A server is "connected" if the user has a connection referencing it.
  const connectedServerIds = useMemo(
    () => new Set(connections.map(c => c.mcpServerId)),
    [connections],
  );

  const sections = useMemo(() => {
    const connected: McpServer[] = [];
    const available: McpServer[] = [];
    for (const server of categoryFiltered) {
      (connectedServerIds.has(server.id) ? connected : available).push(server);
    }
    return [
      { key: 'connected', label: 'Connected', servers: connected },
      { key: 'available', label: 'Available', servers: available },
    ].filter(section => section.servers.length > 0);
  }, [categoryFiltered, connectedServerIds]);

  return (
    <div className='mx-auto w-full max-w-7xl px-6 pt-4 pb-16'>
      <div className='flex gap-8'>
        {/* Left: category filter */}
        <nav className='sticky top-0 hidden w-44 shrink-0 flex-col gap-1 self-start pt-[68px] md:flex'>
          <span className='px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground'>
            Categories
          </span>
          <FilterButton
            label='All'
            count={searchFiltered.length}
            active={!effectiveCategory}
            onClick={() => setActiveCategory(null)}
          />
          {visibleCategories.map(cat => (
            <FilterButton
              key={cat.id}
              label={cat.label}
              count={groupedByCategory.get(cat.id)?.length ?? 0}
              active={effectiveCategory === cat.id}
              onClick={() => setActiveCategory(effectiveCategory === cat.id ? null : cat.id)}
            />
          ))}
        </nav>

        {/* Right: search header + MCP sections */}
        <div className='flex min-w-0 flex-1 flex-col'>
          <header className='sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-border bg-background pt-4 pb-4'>
            <h1 className='text-lg font-semibold text-foreground'>MCPs</h1>
            <div className='relative w-64 max-w-full'>
              <Search className='pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
              <input
                type='text'
                value={query}
                onChange={e => setQuery(e.target.value)}
                data-track-category='Claw Agents'
                data-track-name='Search MCP integrations'
                placeholder='Search integrations'
                className='h-9 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'
              />
            </div>
          </header>

          <div className='pt-6'>
            {isLoading ? (
              <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                {Array.from({ length: 6 }).map((_, i) => (
                  <McpCardSkeleton key={i} />
                ))}
              </div>
            ) : isError ? (
              <div className='flex flex-col items-center gap-3 py-16 text-center'>
                <p className='text-sm text-muted-foreground'>Couldn&apos;t load integrations.</p>
                <button
                  type='button'
                  onClick={() => void refetch()}
                  data-track-category='Claw Agents'
                  data-track-name='Retry MCP integrations load'
                  className='text-sm font-medium text-[color:var(--mention-color)] underline underline-offset-2'
                >
                  Retry
                </button>
              </div>
            ) : servers.length === 0 ? (
              <EmptyState
                icon='🔌'
                title='No integrations yet'
                description='MCP servers available to you will show up here.'
              />
            ) : sections.length === 0 ? (
              <EmptyState
                icon='🔍'
                title='No matching integrations'
                description='Try a different search or category.'
              />
            ) : (
              <div className='flex flex-col gap-8'>
                {sections.map(section => (
                  <section key={section.key}>
                    <div className='mb-3 flex items-center gap-2'>
                      <h2 className='text-sm font-semibold text-foreground'>{section.label}</h2>
                      <span className='text-xs tabular-nums text-muted-foreground'>
                        {section.servers.length}
                      </span>
                    </div>
                    <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                      {section.servers.map(server => (
                        <McpCard
                          key={server.id}
                          server={server}
                          connected={section.key === 'connected'}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default McpTab;
