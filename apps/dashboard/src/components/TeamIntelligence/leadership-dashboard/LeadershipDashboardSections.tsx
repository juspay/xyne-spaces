import { ArrowUpRightIcon, ChevronDownIcon, Loader2Icon, UsersIcon } from 'lucide-react';
import { type ReactElement, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type {
  LeadershipBullet,
  LeadershipItem,
} from '@/services/TeamIntelligence/teamIntelligenceService';
import { useLeadershipSection, useTeamMembers } from '@/hooks/useTeamIntelligence';
import { cn } from '@/utils/classNames';
import { formatReportDate } from '@/utils/teamIntelligenceUtils';
import type {
  PaginationState,
  SectionProps,
  SectionRequest,
  SnapshotShellProps,
  TextHeadline,
} from './leadershipDashboardTypes';
import { SECTION_PAGE_SIZE } from './leadershipDashboardTypes';
import {
  cleanText,
  confidenceTone,
  firstNonEmpty,
  formatLabel,
  momentumTone,
} from './leadershipDashboardUtils';
import {
  bulletCategoryTone,
  EmptyState,
  ErrorState,
  ItemGrid,
  LoadingState,
  PaginationControls,
  Pill,
  SectionHeading,
  StringList,
  Zone,
} from './LeadershipDashboardPrimitives';

export const responsePagination = (response: {
  page: number;
  totalPages: number;
  total: number;
  limit: number;
  items: unknown[];
}): PaginationState<unknown> => ({
  pageIndex: response.page - 1,
  pageCount: Math.max(1, response.totalPages),
  rangeStart: response.total === 0 ? 0 : (response.page - 1) * response.limit + 1,
  rangeEnd: (response.page - 1) * response.limit + response.items.length,
  total: response.total,
  visibleItems: response.items,
});

export const PaginatedItemSection = ({
  request,
  section,
  emptyTitle,
  emptyText,
}: {
  request: SectionRequest;
  section: string;
  emptyTitle: string;
  emptyText: string;
}): ReactElement => {
  const [page, setPage] = useState(1);
  useEffect(
    () => setPage(1),
    [request.from, request.to, request.teamId, request.userEmail, section],
  );
  const { data, isLoading, isError } = useLeadershipSection<LeadershipItem>({
    ...request,
    section,
    page,
    limit: SECTION_PAGE_SIZE,
  });
  if (isLoading && !data) return <LoadingState label='Loading section...' />;
  if (isError || !data) return <ErrorState label='Could not load this section.' />;
  const pagination = responsePagination(data);
  return (
    <>
      <ItemGrid items={data.items} emptyTitle={emptyTitle} emptyText={emptyText} />
      <PaginationControls
        pagination={pagination}
        setPage={nextPage => setPage(nextPage + 1)}
        trackName={section}
        className='mt-3 rounded-xl border border-border/70'
      />
    </>
  );
};

export const PaginatedTextSection = ({
  request,
  section,
  emptyTitle,
  emptyText,
}: {
  request: SectionRequest;
  section: string;
  emptyTitle: string;
  emptyText: string;
}): ReactElement => {
  const [page, setPage] = useState(1);
  useEffect(
    () => setPage(1),
    [request.from, request.to, request.teamId, request.userEmail, section],
  );
  const { data, isLoading, isError } = useLeadershipSection<string | TextHeadline>({
    ...request,
    section,
    page,
    limit: SECTION_PAGE_SIZE,
  });
  if (isLoading && !data) return <LoadingState label='Loading section...' />;
  if (isError || !data) return <ErrorState label='Could not load this section.' />;
  const pagination = responsePagination(data);
  return (
    <>
      <StringList items={data.items} emptyTitle={emptyTitle} emptyText={emptyText} />
      <PaginationControls
        pagination={pagination}
        setPage={nextPage => setPage(nextPage + 1)}
        trackName={section}
        className='mt-3 rounded-xl border border-border/70'
      />
    </>
  );
};

export const Section = ({
  id,
  icon,
  title,
  eyebrow,
  tone = 'neutral',
  question,
  children,
}: SectionProps): ReactElement => (
  <Zone tone={tone} {...(id ? { id } : {})}>
    <SectionHeading
      icon={icon}
      title={title}
      tone={tone}
      {...((question ?? eyebrow) ? { question: question ?? eyebrow } : {})}
    />
    {children}
  </Zone>
);

/* ── Zone: Team members grid ── */
export const TeamMembersPanel = ({ teamId }: { teamId: string }): ReactElement => {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [teamId]);
  const { data: teamMembers, isLoading, isError } = useTeamMembers(teamId, page);
  const members = (teamMembers?.employee_list ?? [])
    .filter(member => cleanText(member.email) || cleanText(member.name))
    .sort((a, b) => firstNonEmpty(a.name, a.email).localeCompare(firstNonEmpty(b.name, b.email)));
  const memberPage = teamMembers?.pagination;
  const pagination = responsePagination({
    page: memberPage?.page ?? page,
    totalPages: memberPage?.totalPages ?? 0,
    total: memberPage?.total ?? 0,
    limit: memberPage?.limit ?? SECTION_PAGE_SIZE,
    items: members,
  });

  return (
    <Zone tone='info'>
      <SectionHeading
        icon={UsersIcon}
        title='Know your team'
        question='Who is doing what?'
        tone='info'
      />
      {isLoading ? (
        <div className='flex items-center gap-3 rounded-lg border border-border/70 bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm'>
          <Loader2Icon className='size-4 animate-spin' />
          Loading team members from Mettle...
        </div>
      ) : isError ? (
        <EmptyState
          title='Could not load team members'
          text='The Mettle team member API did not return a roster for this team.'
        />
      ) : members.length === 0 ? (
        <EmptyState
          title='No team members found'
          text='Mettle did not return employees for this team.'
        />
      ) : (
        <div className='overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm'>
          <div className='grid gap-px bg-border/60 sm:grid-cols-2 xl:grid-cols-3'>
            {members.map((member, index) => {
              const name = firstNonEmpty(member.name, member.email, 'Unknown member');
              const email = cleanText(member.email);
              const role = firstNonEmpty(
                member.designation,
                member.role,
                member.category,
                member.employment_type,
              );
              const status = cleanText(member.employee_status);
              const key = firstNonEmpty(
                email,
                member.id,
                member.assigned_emp_id,
                `${name}-${(page - 1) * SECTION_PAGE_SIZE + index}`,
              );
              const content = (
                <div className='group/member min-h-[116px] bg-card px-4 py-3 transition-colors hover:bg-muted/20'>
                  <div className='flex items-start justify-between gap-3'>
                    <div className='min-w-0'>
                      <p className='truncate text-sm font-medium text-foreground/90 group-hover/member:whitespace-normal group-hover/member:break-words'>
                        {name}
                      </p>
                      {email ? (
                        <p className='mt-1 truncate text-xs text-muted-foreground group-hover/member:whitespace-normal group-hover/member:break-all'>
                          {email}
                        </p>
                      ) : null}
                    </div>
                    {email ? (
                      <ArrowUpRightIcon className='size-4 shrink-0 text-muted-foreground' />
                    ) : null}
                  </div>
                  <div className='mt-3 flex flex-wrap items-center gap-2'>
                    {role ? <Pill tone='neutral'>{role}</Pill> : null}
                    {status ? (
                      <Pill tone={status.toUpperCase() === 'ACTIVE' ? 'good' : 'neutral'}>
                        {formatLabel(status)}
                      </Pill>
                    ) : null}
                  </div>
                </div>
              );
              return email ? (
                <Link
                  key={key}
                  to={`/team-intelligence/member/${encodeURIComponent(email)}`}
                  data-track-category='team-intelligence'
                  data-track-name='open-mettle-team-member'
                  data-track-metadata={JSON.stringify({ email })}
                  className='block focus:outline-none focus-visible:ring-2 focus-visible:ring-action-accent'
                >
                  {content}
                </Link>
              ) : (
                <div key={key}>{content}</div>
              );
            })}
          </div>
          <PaginationControls
            pagination={pagination}
            setPage={nextPage => setPage(nextPage + 1)}
            trackName='mettle-team-member'
          />
        </div>
      )}
    </Zone>
  );
};

/* ── Zone: Bullet brief (key takeaways, click-to-expand) ── */
export const BulletBrief = ({ request }: { request: SectionRequest }): ReactElement | null => {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [request.from, request.to, request.teamId, request.userEmail]);
  const { data, isLoading, isError } = useLeadershipSection<LeadershipBullet | string>({
    ...request,
    section: 'bullets',
    page,
    limit: SECTION_PAGE_SIZE,
  });
  if (isLoading && !data) return <LoadingState label='Loading summary bullets...' />;
  if (isError || !data) return null;
  const bullets = data.items.map(
    (bullet, index): LeadershipBullet =>
      typeof bullet === 'string'
        ? {
            id: `${data.snapshotId}-bullet-${(data.page - 1) * data.limit + index}`,
            title: `Manager note ${(data.page - 1) * data.limit + index + 1}`,
            text: bullet,
          }
        : bullet,
  );
  const pagination = responsePagination(data);
  const toggleBullet = (id: string): void => {
    setExpandedKeys(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  return (
    <div className='border-t border-border/70'>
      <div className='divide-y divide-border/60'>
        {bullets.map(bullet => {
          const isExpanded = expandedKeys.has(bullet.id);
          return (
            <article key={bullet.id}>
              <button
                type='button'
                onClick={() => toggleBullet(bullet.id)}
                aria-expanded={isExpanded}
                data-track-category='team-intelligence'
                data-track-name='toggle-leadership-summary-bullet'
                data-track-metadata={JSON.stringify({
                  bulletId: bullet.id,
                  isExpanded: !isExpanded,
                })}
                className='group flex w-full items-start gap-3 px-5 py-3 text-left transition-colors hover:bg-muted/30 sm:px-6'
              >
                <ChevronDownIcon
                  className={cn(
                    'mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform',
                    isExpanded ? 'rotate-180 text-action-accent' : 'rotate-0',
                  )}
                />
                <div className='min-w-0 flex-1'>
                  <div className='flex items-center justify-between gap-3'>
                    <h4 className='min-w-0 flex-1 text-sm font-medium leading-snug text-foreground/90 sm:text-[15px]'>
                      {bullet.title}
                    </h4>
                    {bullet.category ? (
                      <div className='ml-auto shrink-0'>
                        <Pill tone={bulletCategoryTone(bullet.category)}>
                          {formatLabel(bullet.category)}
                        </Pill>
                      </div>
                    ) : null}
                  </div>
                  {isExpanded ? (
                    <p className='mt-2 max-w-3xl text-sm leading-6 text-muted-foreground'>
                      {bullet.text}
                    </p>
                  ) : null}
                </div>
              </button>
            </article>
          );
        })}
      </div>
      <PaginationControls
        pagination={pagination}
        setPage={nextPage => setPage(nextPage + 1)}
        trackName='leadership-bullet'
        className='px-5 sm:px-6'
      />
    </div>
  );
};

/* ── Hero shell (title + pills + narrative + bullets) ── */
export const SnapshotShell = ({
  scope,
  title,
  eyebrow,
  reportDate,
  confidence,
  momentum,
  narrative,
  sectionRequest,
  children,
}: SnapshotShellProps): ReactElement => {
  const scopeLabel =
    scope === 'org' ? 'Founder Brief' : scope === 'team' ? 'Manager Brief' : 'Member Brief';
  const displayNarrative = cleanText(narrative);
  return (
    <div className='flex-1 w-full max-w-7xl mx-auto px-4 py-5 sm:px-6 lg:px-8 space-y-7'>
      <section className='overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm'>
        <div className='bg-muted/20 px-5 py-6 sm:px-7'>
          <div className='flex flex-wrap items-center gap-2'>
            <Pill tone='accent'>{scopeLabel}</Pill>
            {reportDate ? <Pill tone='info'>{formatReportDate(reportDate)}</Pill> : null}
            {confidence ? (
              <Pill tone={confidenceTone(confidence)}>{formatLabel(confidence)} Confidence</Pill>
            ) : null}
            {momentum ? <Pill tone={momentumTone(momentum)}>{formatLabel(momentum)}</Pill> : null}
          </div>
          <div className='mt-5 w-full'>
            <p className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>
              {eyebrow}
            </p>
            <h1 className='mt-2 text-3xl font-bold leading-[1.12] tracking-tight text-foreground sm:text-4xl'>
              {title}
            </h1>
            {displayNarrative ? (
              <p className='mt-4 w-full text-[15px] leading-7 text-muted-foreground sm:text-base sm:leading-8'>
                {displayNarrative}
              </p>
            ) : null}
          </div>
        </div>
        <BulletBrief request={sectionRequest} />
      </section>
      {children}
    </div>
  );
};
