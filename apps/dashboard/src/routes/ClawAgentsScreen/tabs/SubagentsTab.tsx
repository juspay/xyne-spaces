import { ReactElement, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronRight, Network, Plus, Search } from 'lucide-react';
import { cn } from '@/utils/classNames';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/Board/EmptyState/EmptyState';
import { Tooltip } from '@/components/ui/Tooltip/Tooltip';
import { useClawSubagents } from '@/hooks/useClawSubagents';
import type { SubagentDef, SubagentSource } from '@/services/claw/clawSubagentsTypes';

const SubagentAvatar = ({ subagent }: { subagent: SubagentDef }): ReactElement => (
  <div
    className={cn(
      'flex size-10 shrink-0 items-center justify-center self-start rounded-lg border',
      subagent.source === 'builtin'
        ? 'border-border bg-muted text-muted-foreground'
        : 'border-primary/20 bg-primary/10 text-primary',
    )}
    aria-hidden='true'
  >
    <Network className='size-5' />
  </div>
);

const SubagentCard = ({ subagent }: { subagent: SubagentDef }): ReactElement => {
  const toolCount = (subagent.tools?.direct?.length ?? 0) + (subagent.tools?.custom?.length ?? 0);
  return (
    <Link
      to={`/claw-agents/subagents/${encodeURIComponent(subagent.name)}`}
      data-testid='claw-subagent-card'
      className={cn(
        'group/item flex w-full items-start gap-3.5 rounded-2xl border border-transparent bg-muted/50 px-4 py-3.5 text-sm transition-colors hover:bg-muted',
        !subagent.enabled && 'opacity-60',
      )}
    >
      <SubagentAvatar subagent={subagent} />
      <div className='flex min-w-0 flex-1 flex-col gap-1'>
        <div className='flex min-w-0 items-center gap-2'>
          <Tooltip
            side='top'
            content={
              subagent.enabled
                ? 'Enabled — available to agents'
                : 'Disabled — cannot be used by agents'
            }
          >
            <span
              className={cn(
                'size-2 shrink-0 rounded-full',
                subagent.enabled ? 'bg-emerald-500' : 'bg-amber-500',
              )}
            />
          </Tooltip>
          <span className='truncate font-mono text-sm font-medium leading-snug text-foreground'>
            {subagent.name}
          </span>
          <Badge variant={subagent.source === 'builtin' ? 'outline' : 'secondary'}>
            {subagent.source === 'builtin' ? 'Built-in' : 'Custom'}
          </Badge>
        </div>
        <p className='line-clamp-2 text-sm text-muted-foreground'>
          {subagent.description || 'No description added'}
        </p>
        <div className='flex items-center gap-3 text-xs text-muted-foreground'>
          <span>{subagent.skills.length} skills</span>
          <span>{toolCount} tools</span>
          {subagent.source === 'custom' && (subagent.createdByName || subagent.createdByEmail) && (
            <span className='truncate'>by {subagent.createdByName || subagent.createdByEmail}</span>
          )}
        </div>
      </div>
      <ChevronRight className='size-4 shrink-0 self-start text-muted-foreground' />
    </Link>
  );
};

const SubagentCardSkeleton = (): ReactElement => (
  <div className='flex w-full items-start gap-3.5 rounded-2xl border border-transparent bg-muted/50 px-4 py-3.5'>
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
    data-track-name={`Subagents filter: ${label}`}
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

type SourceFilter = 'all' | SubagentSource;

const SubagentsTab = (): ReactElement => {
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch } = useClawSubagents();
  const subagents = useMemo(() => data ?? [], [data]);

  // Search + source filter live in the URL (?q=&source=) so the view is
  // shareable and survives navigation, mirroring the Agents / MCP lists.
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('q') ?? '';
  const rawSource = searchParams.get('source');
  const activeSource: SourceFilter =
    rawSource === 'custom' || rawSource === 'builtin' ? rawSource : 'all';

  const setQuery = (value: string): void => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set('q', value);
    else next.delete('q');
    setSearchParams(next, { replace: true });
  };

  const setSource = (value: SourceFilter): void => {
    const next = new URLSearchParams(searchParams);
    if (value !== 'all') next.set('source', value);
    else next.delete('source');
    setSearchParams(next, { replace: true });
  };

  const q = query.trim().toLowerCase();

  const searchFiltered = useMemo(
    () =>
      q ? subagents.filter(s => `${s.name} ${s.description}`.toLowerCase().includes(q)) : subagents,
    [subagents, q],
  );

  const custom = useMemo(
    () =>
      searchFiltered
        .filter(s => s.source === 'custom')
        .sort((a, b) => a.name.localeCompare(b.name)),
    [searchFiltered],
  );
  const builtIn = useMemo(
    () =>
      searchFiltered
        .filter(s => s.source === 'builtin')
        .sort((a, b) => a.name.localeCompare(b.name)),
    [searchFiltered],
  );

  const sections = useMemo(() => {
    const all = [
      { key: 'custom', label: 'Custom', items: custom },
      { key: 'builtin', label: 'Built-in', items: builtIn },
    ];
    return all
      .filter(section => activeSource === 'all' || section.key === activeSource)
      .filter(section => section.items.length > 0);
  }, [custom, builtIn, activeSource]);

  return (
    <div className='mx-auto w-full max-w-7xl px-6 pt-4 pb-16'>
      <div className='flex gap-8'>
        {/* Left: source filter */}
        <nav className='sticky top-0 hidden w-44 shrink-0 flex-col gap-1 self-start pt-[68px] md:flex'>
          <span className='px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground'>
            Type
          </span>
          <FilterButton
            label='All'
            count={searchFiltered.length}
            active={activeSource === 'all'}
            onClick={() => setSource('all')}
          />
          <FilterButton
            label='Custom'
            count={custom.length}
            active={activeSource === 'custom'}
            onClick={() => setSource(activeSource === 'custom' ? 'all' : 'custom')}
          />
          <FilterButton
            label='Built-in'
            count={builtIn.length}
            active={activeSource === 'builtin'}
            onClick={() => setSource(activeSource === 'builtin' ? 'all' : 'builtin')}
          />
        </nav>

        {/* Right: search header + subagent grid */}
        <div className='flex min-w-0 flex-1 flex-col'>
          <header className='sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-border bg-background pt-4 pb-4'>
            <h1 className='text-lg font-semibold text-foreground'>Subagents</h1>
            <div className='flex items-center gap-3'>
              <div className='relative w-64 max-w-full'>
                <Search className='pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
                <input
                  type='text'
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder='Search subagents'
                  data-track-category='Claw Agents'
                  data-track-name='Search subagents'
                  className='h-9 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'
                />
              </div>
              <Button
                type='button'
                className='shrink-0'
                data-track-category='Claw Agents'
                data-track-name='Create subagent'
                onClick={() => void navigate('/claw-agents/subagents/create')}
              >
                <Plus className='size-4' />
                Create subagent
              </Button>
            </div>
          </header>

          <div className='pt-6'>
            {isLoading ? (
              <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                {Array.from({ length: 6 }).map((_, i) => (
                  <SubagentCardSkeleton key={i} />
                ))}
              </div>
            ) : isError ? (
              <div className='flex flex-col items-center gap-3 py-16 text-center'>
                <p className='text-sm text-muted-foreground'>Couldn&apos;t load subagents.</p>
                <button
                  type='button'
                  onClick={() => void refetch()}
                  data-track-category='Claw Agents'
                  data-track-name='Retry subagents load'
                  className='text-sm font-medium text-[color:var(--mention-color)] underline underline-offset-2'
                >
                  Retry
                </button>
              </div>
            ) : subagents.length === 0 ? (
              <EmptyState
                icon='🧩'
                title='No subagents yet'
                description='Create a specialist your agents can delegate work to.'
              />
            ) : sections.length === 0 ? (
              <EmptyState
                icon='🔍'
                title='No matching subagents'
                description='Try a different search or type.'
              />
            ) : (
              <div className='flex flex-col gap-8'>
                {sections.map(section => (
                  <section key={section.key}>
                    <div className='mb-3 flex items-center gap-2'>
                      <h2 className='text-sm font-semibold text-foreground'>{section.label}</h2>
                      <span className='text-xs tabular-nums text-muted-foreground'>
                        {section.items.length}
                      </span>
                    </div>
                    <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                      {section.items.map(subagent => (
                        <SubagentCard key={subagent.name} subagent={subagent} />
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

export default SubagentsTab;
