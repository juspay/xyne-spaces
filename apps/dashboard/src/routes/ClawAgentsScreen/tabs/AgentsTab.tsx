import { ReactElement, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronRight, Plus, Search } from 'lucide-react';
import { cn } from '@/utils/classNames';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/Board/EmptyState/EmptyState';
import { Tooltip } from '@/components/ui/Tooltip/Tooltip';
import { useAuth } from '@/hooks/useAuth';
import { useClawAuthAgents } from '@/hooks/useClawAuthAgents';
import type { Agent } from '@/services/claw/clawAuthAgentTypes';
import {
  AGENT_CATEGORIES,
  groupAgentsByCategory,
  type AgentCategoryId,
} from '@/services/claw/agentCategory';

/** Initials from a name, e.g. "Xyne Grafana" -> "XG", "Assistant" -> "AS". */
const getInitials = (name: string): string => {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) {
    return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
};

const AgentAvatar = ({ agent }: { agent: Agent }): ReactElement => (
  <div
    className='flex size-10 shrink-0 items-center justify-center self-start rounded-lg text-sm font-semibold text-white'
    style={{ backgroundColor: agent.color || '#6366f1' }}
    aria-hidden='true'
  >
    {getInitials(agent.name)}
  </div>
);

const AgentCard = ({ agent }: { agent: Agent }): ReactElement => (
  <Link
    to={`/claw-agents/agents/${agent.slug}?tab=persona`}
    data-testid='claw-agent-card'
    className='group/item flex w-full items-center gap-3.5 rounded-2xl border border-transparent bg-muted/50 px-4 py-3.5 text-sm transition-colors hover:bg-muted'
  >
    <AgentAvatar agent={agent} />
    <div className='flex min-w-0 flex-1 flex-col gap-1'>
      <div className='flex items-center gap-2'>
        <Tooltip
          side='top'
          content={
            agent.enabled
              ? 'Active — this agent is enabled and available to use'
              : 'Paused — this agent is disabled and cannot be used'
          }
        >
          <span
            className={cn(
              'size-2 shrink-0 rounded-full',
              agent.enabled ? 'bg-emerald-500' : 'bg-amber-500',
            )}
          />
        </Tooltip>
        <span className='line-clamp-1 text-sm font-medium leading-snug text-foreground'>
          {agent.name}
        </span>
      </div>
      <p className='line-clamp-2 text-sm text-muted-foreground'>
        {agent.description || 'No description added'}
      </p>
    </div>
    <ChevronRight className='size-4 shrink-0 self-start text-muted-foreground' />
  </Link>
);

const AgentCardSkeleton = (): ReactElement => (
  <div className='flex w-full items-center gap-3.5 rounded-2xl border border-transparent bg-muted/50 px-4 py-3.5'>
    <Skeleton className='size-10 shrink-0 self-start rounded-lg' />
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
    data-track-name={`Filter agents by category: ${label}`}
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

const AgentsTab = (): ReactElement => {
  const { data, isLoading, isError, refetch } = useClawAuthAgents();
  const agents = useMemo(() => data ?? [], [data]);

  const { user } = useAuth();
  const userId = user?.id;

  const navigate = useNavigate();

  // Category filter lives in the URL (?category=) so the view is shareable and
  // survives navigation, mirroring the ?tab= pattern on the agent detail
  // screen. Search stays local — it's transient and not worth persisting.
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const rawCategory = searchParams.get('category');
  const activeCategory: AgentCategoryId | null =
    rawCategory && AGENT_CATEGORIES.some(cat => cat.id === rawCategory)
      ? (rawCategory as AgentCategoryId)
      : null;

  const setActiveCategory = (id: AgentCategoryId | null): void => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set('category', id);
    else next.delete('category');
    setSearchParams(next, { replace: true });
  };

  const q = query.trim().toLowerCase();

  const searchFiltered = useMemo(
    () =>
      q ? agents.filter(a => `${a.name} ${a.description ?? ''}`.toLowerCase().includes(q)) : agents,
    [agents, q],
  );

  const groupedByCategory = useMemo(() => groupAgentsByCategory(searchFiltered), [searchFiltered]);

  const idToCategory = useMemo(() => {
    const map = new Map<string, AgentCategoryId>();
    for (const [catId, list] of groupedByCategory) {
      for (const agent of list) map.set(agent.id, catId);
    }
    return map;
  }, [groupedByCategory]);

  // Only categories with matches under the current search get a filter row.
  const visibleCategories = useMemo(
    () => AGENT_CATEGORIES.filter(cat => (groupedByCategory.get(cat.id)?.length ?? 0) > 0),
    [groupedByCategory],
  );

  // Drop a stale category selection if it has no matches in the current search.
  const effectiveCategory =
    activeCategory && (groupedByCategory.get(activeCategory)?.length ?? 0) > 0
      ? activeCategory
      : null;

  const categoryFiltered = useMemo(
    () =>
      effectiveCategory
        ? searchFiltered.filter(a => idToCategory.get(a.id) === effectiveCategory)
        : searchFiltered,
    [searchFiltered, effectiveCategory, idToCategory],
  );

  // Split the current view into up to two sections: agents I own vs everything
  // else (global / shared). Only non-empty sections are kept.
  const sections = useMemo(() => {
    const mine: Agent[] = [];
    const global: Agent[] = [];
    for (const agent of categoryFiltered) {
      (agent.ownerUserId === userId ? mine : global).push(agent);
    }
    return [
      { key: 'mine', label: 'My agents', agents: mine },
      { key: 'global', label: 'Global', agents: global },
    ].filter(section => section.agents.length > 0);
  }, [categoryFiltered, userId]);

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

        {/* Right: search header + agent grid */}
        <div className='flex min-w-0 flex-1 flex-col'>
          <header className='sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-border bg-background pt-4 pb-4'>
            <h1 className='text-lg font-semibold text-foreground'>Agents</h1>
            <div className='flex items-center gap-3'>
              <div className='relative w-64 max-w-full'>
                <Search className='pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
                <input
                  type='text'
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  data-track-category='Claw Agents'
                  data-track-name='Search agents'
                  placeholder='Search agents'
                  className='h-9 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'
                />
              </div>
              <Button
                type='button'
                className='shrink-0'
                onClick={() => void navigate('/claw-agents/create')}
                data-track-category='Claw Agents'
                data-track-name='GO_TO_CREATE_AGENT'
              >
                <Plus className='size-4' />
                Create agent
              </Button>
            </div>
          </header>

          <div className='pt-6'>
            {isLoading ? (
              <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                {Array.from({ length: 6 }).map((_, i) => (
                  <AgentCardSkeleton key={i} />
                ))}
              </div>
            ) : isError ? (
              <div className='flex flex-col items-center gap-3 py-16 text-center'>
                <p className='text-sm text-muted-foreground'>Couldn&apos;t load agents.</p>
                <button
                  type='button'
                  onClick={() => void refetch()}
                  data-track-category='Claw Agents'
                  data-track-name='Retry agents load'
                  className='text-sm font-medium text-[color:var(--mention-color)] underline underline-offset-2'
                >
                  Retry
                </button>
              </div>
            ) : agents.length === 0 ? (
              <EmptyState
                icon='🤖'
                title='No agents yet'
                description='Agents you have access to will show up here.'
              />
            ) : sections.length === 0 ? (
              <EmptyState
                icon='🔍'
                title='No matching agents'
                description='Try a different search or category.'
              />
            ) : (
              <div className='flex flex-col gap-8'>
                {sections.map(section => (
                  <section key={section.key}>
                    <div className='mb-3 flex items-center gap-2'>
                      <h2 className='text-sm font-semibold text-foreground'>{section.label}</h2>
                      <span className='text-xs tabular-nums text-muted-foreground'>
                        {section.agents.length}
                      </span>
                    </div>
                    <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                      {section.agents.map(agent => (
                        <AgentCard key={agent.id} agent={agent} />
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

export default AgentsTab;
