import { ReactElement, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronRight, Plus, Search } from 'lucide-react';
import { cn } from '@/utils/classNames';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/Board/EmptyState/EmptyState';
import { Tooltip } from '@/components/ui/Tooltip/Tooltip';
import { useAuth } from '@/hooks/useAuth';
import { useClawSkills } from '@/hooks/useClawSkills';
import type { Skill } from '@/services/claw/clawSkillsTypes';
import {
  AGENT_CATEGORIES,
  groupSkillsByCategory,
  type AgentCategoryId,
} from '@/services/claw/agentCategory';

/** Human-facing provenance badge, mirroring claw-auth's SkillRow. */
const getSourceBadge = (source: string): { label: string; accent: boolean } => {
  switch (source) {
    case 'seeded':
      return { label: 'Built-in', accent: false };
    case 'user-created':
      return { label: 'Custom', accent: true };
    case 'uploaded':
      return { label: 'Uploaded', accent: true };
    default:
      return { label: source, accent: false };
  }
};

const SourceBadge = ({ source }: { source: string }): ReactElement => {
  const { label, accent } = getSourceBadge(source);
  return (
    <span
      className={cn(
        'shrink-0 rounded-full border px-1.5 py-px text-[11px] font-medium leading-none',
        accent
          ? 'border-[color:var(--mention-color)]/30 bg-[color:var(--mention-color)]/10 text-[color:var(--mention-color)]'
          : 'border-border bg-muted text-muted-foreground',
      )}
    >
      {label}
    </span>
  );
};

const SkillCard = ({ skill }: { skill: Skill }): ReactElement => (
  <Link
    to={`/claw-agents/skills/${skill.slug}`}
    data-testid='claw-skill-card'
    className={cn(
      'group/item flex w-full items-start gap-3.5 rounded-2xl border border-transparent bg-muted/50 px-4 py-3.5 text-sm transition-colors hover:bg-muted',
      !skill.enabled && 'opacity-60',
    )}
  >
    <div className='flex min-w-0 flex-1 flex-col gap-1'>
      <div className='flex min-w-0 items-center gap-2'>
        <Tooltip
          side='top'
          content={
            skill.enabled
              ? 'Active — agents can use this skill'
              : 'Disabled — agents cannot use this skill'
          }
        >
          <span
            className={cn(
              'size-2 shrink-0 rounded-full',
              skill.enabled ? 'bg-emerald-500' : 'bg-amber-500',
            )}
          />
        </Tooltip>
        <span className='truncate text-sm font-medium leading-snug text-foreground'>
          {skill.name || skill.slug}
        </span>
        <SourceBadge source={skill.source} />
      </div>
      <span className='truncate font-mono text-xs text-muted-foreground'>{skill.slug}</span>
      {skill.description && (
        <p className='line-clamp-2 text-sm text-muted-foreground'>{skill.description}</p>
      )}
    </div>
    <ChevronRight className='mt-0.5 size-4 shrink-0 self-start text-muted-foreground' />
  </Link>
);

const SkillCardSkeleton = (): ReactElement => (
  <div className='flex w-full flex-col gap-2 rounded-2xl border border-transparent bg-muted/50 px-4 py-3.5'>
    <Skeleton className='h-3.5 w-32' />
    <Skeleton className='h-3 w-24' />
    <Skeleton className='h-3 w-full max-w-52' />
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
    data-track-name={`Filter skills by category: ${label}`}
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

const skillMatchesSearch = (skill: Skill, q: string): boolean =>
  `${skill.name} ${skill.slug} ${skill.description ?? ''}`.toLowerCase().includes(q);

const SkillsTab = (): ReactElement => {
  const { data, isLoading, isError, refetch } = useClawSkills();
  const skills = useMemo(() => data ?? [], [data]);

  const { user } = useAuth();
  const userId = user?.id;

  const navigate = useNavigate();

  // Search + category filters live in the URL (?q=&category=) so the view is
  // shareable and survives navigation, mirroring the Agents and MCP tabs.
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
    () => (q ? skills.filter(s => skillMatchesSearch(s, q)) : skills),
    [skills, q],
  );

  const groupedByCategory = useMemo(() => groupSkillsByCategory(searchFiltered), [searchFiltered]);

  const idToCategory = useMemo(() => {
    const map = new Map<string, AgentCategoryId>();
    for (const [catId, list] of groupedByCategory) {
      for (const skill of list) map.set(skill.id, catId);
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

  // Split into up to two sections: skills I own vs everything else (global /
  // shared), mirroring the Agents tab's mine/global split.
  const sections = useMemo(() => {
    const mine: Skill[] = [];
    const global: Skill[] = [];
    for (const skill of categoryFiltered) {
      (skill.ownerUserId && skill.ownerUserId === userId ? mine : global).push(skill);
    }
    return [
      { key: 'mine', label: 'My skills', skills: mine },
      { key: 'global', label: 'Global', skills: global },
    ].filter(section => section.skills.length > 0);
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

        {/* Right: search header + skill sections */}
        <div className='flex min-w-0 flex-1 flex-col'>
          <header className='sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-border bg-background pt-4 pb-4'>
            <h1 className='text-lg font-semibold text-foreground'>Skills</h1>
            <div className='flex items-center gap-3'>
              <div className='relative w-64 max-w-full'>
                <Search className='pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
                <input
                  type='text'
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  data-track-category='Claw Agents'
                  data-track-name='Search skills'
                  placeholder='Search skills'
                  className='h-9 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'
                />
              </div>
              <Button
                type='button'
                className='shrink-0'
                onClick={() => void navigate('/claw-agents/skills/create')}
                data-track-category='Claw Agents'
                data-track-name='GO_TO_CREATE_SKILL'
              >
                <Plus className='size-4' />
                Create skill
              </Button>
            </div>
          </header>

          <div className='pt-6'>
            {isLoading ? (
              <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                {Array.from({ length: 6 }).map((_, i) => (
                  <SkillCardSkeleton key={i} />
                ))}
              </div>
            ) : isError ? (
              <div className='flex flex-col items-center gap-3 py-16 text-center'>
                <p className='text-sm text-muted-foreground'>Couldn&apos;t load skills.</p>
                <button
                  type='button'
                  onClick={() => void refetch()}
                  data-track-category='Claw Agents'
                  data-track-name='Retry skills load'
                  className='text-sm font-medium text-[color:var(--mention-color)] underline underline-offset-2'
                >
                  Retry
                </button>
              </div>
            ) : skills.length === 0 ? (
              <EmptyState
                icon='✨'
                title='No skills yet'
                description='Skills available to you will show up here.'
              />
            ) : sections.length === 0 ? (
              <EmptyState
                icon='🔍'
                title='No matching skills'
                description='Try a different search or category.'
              />
            ) : (
              <div className='flex flex-col gap-8'>
                {sections.map(section => (
                  <section key={section.key}>
                    <div className='mb-3 flex items-center gap-2'>
                      <h2 className='text-sm font-semibold text-foreground'>{section.label}</h2>
                      <span className='text-xs tabular-nums text-muted-foreground'>
                        {section.skills.length}
                      </span>
                    </div>
                    <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                      {section.skills.map(skill => (
                        <SkillCard key={skill.id} skill={skill} />
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

export default SkillsTab;
