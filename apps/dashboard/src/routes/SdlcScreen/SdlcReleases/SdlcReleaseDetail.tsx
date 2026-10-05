import { useCallback, useDeferredValue, useMemo, useState, type ReactElement } from 'react';
import { ArrowLeft, Clock, ListChecks, SearchX, Sparkles } from 'lucide-react';
import {
  BoardType,
  ReleaseTrackingMode,
  TicketPriority,
  resolveTicketDescription,
} from '@xyne/shared';
import { Button } from '../../../components/ui/Button';
import { Tooltip } from '../../../components/ui/Tooltip';
import { ThreadMessages } from '../../../components/Chat/ThreadPannel';
import { ReleaseStagePicker } from '../../../components/Release/ReleaseStagePicker';
import { ReleaseTimeline } from '../../../components/Release/ReleaseTimeline';
import { buildStagesByBoard } from '../../../components/Release/releaseChanges.utils';
import type { TicketFilters } from '../../../components/Tickets/TicketFilters/types';
import { TicketFilterChips } from '../../../components/Tickets/TicketsHeader/TicketFilterChips';
import { TicketSearchInput } from '../../../components/Tickets/TicketsHeader/TicketSearchInput';
import { hasAnyFilterChip } from '../../../components/Tickets/TicketsHeader/filterChips';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useAllChannels } from '../../../hooks/useChannels';
import { useCanManageRelease } from '../../../hooks/usePermissions';
import { useScrollFade } from '../../../hooks/useScrollFade';
import { useUserGroups } from '../../../hooks/useUserGroup';
import { useUsersById } from '../../../hooks/useUsers';
import { useVespaTagSearch } from '../../../hooks/useVespaTagSearch';
import { queries } from '../../../zero/queries';
import { cn } from '../../../utils/classNames';
import {
  hasExactSearchQuotes,
  unwrapExactSearchQuery,
  wrapExactSearchQuery,
} from '../../../utils/exactSearch';
import { htmlToPlainText } from '../../../utils/sanitizer';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { TableGroupSection } from '../../KanbanBoardScreen/TableGroupSection';
import { DEFAULT_VISIBLE_COLUMNS } from '../../KanbanBoardScreen/KanbanBoardScreen.utils';
import type {
  ReleaseRepositoryRow,
  SdlcReleaseBreadcrumbProps,
  SdlcReleaseDetailProps,
  SdlcReleaseRepo,
  SdlcReleaseThreadProps,
} from './SdlcReleases.types';
import { TRACK_CATEGORY, formatReleaseDate, releaseTitle, repoPath } from './SdlcReleases.utils';
import { useReleaseRepositories, useRerunReleaseAnalysis } from './useSdlcReleases';
import { InfoCard, RepoPill } from './SdlcReleasePrimitives';
import { SdlcReleaseChanges } from './SdlcReleaseChanges';

type DetailTab = 'tickets' | 'changes' | 'timeline';

const TICKET_PAGE_SIZE = 50;
const TAG_PAGE_SIZE = 50;
const TICKETS_FADE_PX = 48;
const PRIORITIES = Object.values(TicketPriority);
const TICKET_COLUMNS = new Set([...DEFAULT_VISIBLE_COLUMNS, 'stage']);

export function SdlcReleaseDetail({
  releaseId,
  repos,
  onOpenTicket,
  onOpenCanvas,
}: SdlcReleaseDetailProps): ReactElement {
  const [tab, setTab] = useState<DetailTab>('tickets');
  const [release, releaseStatus] = useCachedQuery(queries.ticketRowById({ ticketId: releaseId }));
  const usersById = useUsersById();
  const repo = repos.find(item => item.config?.mainBoardId === release?.boardId);
  const releaseRepositories = useReleaseRepositories(releaseId);
  const [stageRows] = useCachedQuery(
    queries.stagesByBoards({ projectId: repo?.projectId ?? '', boardType: BoardType.RELEASE }),
    { enabled: !!repo?.projectId },
  );
  const [devTicketLinks, devTicketLinksStatus] = useCachedQuery(
    queries.releaseDevTicketLinksByReleaseId({ releaseId }),
  );
  const devTicketIds = useMemo(
    () => [...new Set((devTicketLinks ?? []).map(link => link.ticketId))].sort(),
    [devTicketLinks],
  );
  const [devTickets, devTicketsStatus] = useCachedQuery(
    queries.ticketsByIds({ ticketIds: devTicketIds }),
    { enabled: devTicketIds.length > 0 },
  );
  const [changes] = useCachedQuery(queries.releaseChangesByReleaseId({ releaseId }));
  const [timelineEvents] = useCachedQuery(
    queries.releaseEventsByReleaseId({ releaseId, limit: 100 }),
    { enabled: tab === 'timeline' },
  );

  const stages = useMemo(
    () => (release ? (buildStagesByBoard(stageRows).get(release.boardId) ?? []) : []),
    [stageRows, release],
  );
  const activeDevTickets = useMemo(
    () => (devTickets ?? []).filter(ticket => !ticket.isArchived),
    [devTickets],
  );
  const changedFileCount = useMemo(
    () => new Set((changes ?? []).map(change => `${change.changeType}|${change.filePath}`)).size,
    [changes],
  );

  if (!release) {
    if (releaseStatus.type !== 'complete') return <div className='flex-1' />;
    return (
      <div className='px-8 pt-7'>
        <div className='mx-auto w-full max-w-[1074px]'>
          <InfoCard
            icon={<SearchX size={17} />}
            title='Release not found'
            description="It may have been deleted, or you don't have access to it."
          />
        </div>
      </div>
    );
  }

  const creator = usersById.get(release.createdBy);
  const summary = htmlToPlainText(resolveTicketDescription(release));
  const linksLoaded = devTicketLinksStatus.type === 'complete';
  const noTickets = linksLoaded && devTicketIds.length === 0;
  const ticketsLoaded = devTicketsStatus.type === 'complete';
  const releaseRange =
    releaseRepositories.repos.find(item => item.mainReleaseBoardId === release.boardId) ??
    releaseRepositories.repos[0];

  return (
    <div className='flex min-h-0 flex-1 flex-col overflow-hidden px-8 pt-7'>
      <div className='mx-auto flex min-h-0 w-full max-w-[1074px] flex-1 flex-col'>
        <div className='flex flex-wrap items-center gap-2.5'>
          <ReleaseStagePicker
            ticketId={release.id}
            stageName={release.stageName}
            statusV2={release.statusV2}
            stages={stages}
            boardId={release.boardId}
            triggerClassName='h-7 gap-[7px] rounded-[7px] border border-border bg-background py-0 pl-[9px] pr-2 text-[13px] font-medium text-foreground'
          />
          <span className='text-[13px] text-muted-foreground'>
            {formatReleaseDate(release.createdAt)} ·{' '}
            {creator ? getUserDisplayName(creator) : 'Unknown'}
          </span>
          {repos.length > 1 && repo && <RepoPill name={repo.name} />}
        </div>
        <h1 className='mb-2 mt-3 text-[30px] font-bold tracking-[-0.02em] text-foreground'>
          {releaseTitle(release)}
        </h1>
        {summary && <p className='text-[15px] leading-normal text-muted-foreground'>{summary}</p>}

        <DetailTabs
          active={tab}
          onSelect={setTab}
          tabs={[
            {
              id: 'tickets',
              label: "What's in it",
              count: ticketsLoaded ? activeDevTickets.length : devTicketIds.length,
            },
            { id: 'changes', label: 'Env, migrations & notes', count: changedFileCount },
            { id: 'timeline', label: 'Timeline', count: 0 },
          ]}
        />
        {tab === 'tickets' &&
          (noTickets ? (
            <NoTicketsCard releaseId={release.id} repo={repo} range={releaseRange} />
          ) : (
            (ticketsLoaded || activeDevTickets.length > 0) && (
              <TicketsTab
                releaseId={release.id}
                canRerun={repo?.config?.mode !== ReleaseTrackingMode.VERSION}
                tickets={activeDevTickets}
                projectId={release.projectId}
                onOpenTicket={onOpenTicket}
              />
            )
          ))}
        {tab !== 'tickets' && (
          <div className='-mx-0.5 mt-5 min-h-0 flex-1 overflow-y-auto px-0.5 pb-14'>
            {tab === 'changes' && (
              <SdlcReleaseChanges
                release={release}
                changes={changes ?? []}
                devTickets={devTickets ?? []}
                analysisCanvasId={releaseRepositories.analysisCanvasId}
                repoName={repo?.name ?? null}
                onOpenCanvas={onOpenCanvas}
              />
            )}
            {tab === 'timeline' &&
              (timelineEvents?.length === 0 ? (
                <InfoCard
                  icon={<Clock size={17} />}
                  title='No activity yet'
                  description='Analysis runs, prepared applications and deploy events will be logged here as they happen.'
                />
              ) : (
                <ReleaseTimeline events={timelineEvents} />
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function SdlcReleaseBreadcrumb({
  releaseId,
  canvasId,
  onBack,
  onOpenRelease,
}: SdlcReleaseBreadcrumbProps): ReactElement {
  const [release] = useCachedQuery(queries.ticketRowById({ ticketId: releaseId }));
  const [canvas] = useCachedQuery(queries.getCanvas({ canvasId: canvasId ?? '' }), {
    enabled: !!canvasId,
  });
  const title = release ? releaseTitle(release) : '';
  const canvasTitle = (canvas as { title?: string } | undefined)?.title;
  const backLabel = canvasId ? 'Back to release' : 'Back to releases';

  return (
    <div className='flex min-w-0 items-center gap-2'>
      <Tooltip content={backLabel}>
        <Button
          variant='ghost'
          size='iconSm'
          aria-label={backLabel}
          onClick={canvasId ? onOpenRelease : onBack}
          className='-ml-1.5 text-muted-foreground'
          data-track-category={TRACK_CATEGORY}
          data-track-name='ReleaseDetailBack'
        >
          <ArrowLeft />
        </Button>
      </Tooltip>
      <div className='flex min-w-0 items-center gap-1.5 text-sm'>
        <button
          type='button'
          onClick={onBack}
          className='shrink-0 text-muted-foreground transition-colors hover:text-foreground'
          data-track-category={TRACK_CATEGORY}
          data-track-name='ReleaseDetailBreadcrumb'
        >
          Releases
        </button>
        <span className='text-muted-foreground/60'>/</span>
        {canvasId ? (
          <>
            <button
              type='button'
              onClick={onOpenRelease}
              className='min-w-0 truncate text-muted-foreground transition-colors hover:text-foreground'
              data-track-category={TRACK_CATEGORY}
              data-track-name='ReleaseCanvasBreadcrumb'
            >
              {title}
            </button>
            <span className='text-muted-foreground/60'>/</span>
            <span className='truncate font-semibold text-foreground'>
              {canvasTitle || 'Canvas'}
            </span>
          </>
        ) : (
          <span className='truncate font-semibold text-foreground'>{title}</span>
        )}
      </div>
    </div>
  );
}

const noopUserClick = (): void => {};

export function SdlcReleaseThread({
  releaseId,
  onClose,
}: SdlcReleaseThreadProps): ReactElement | null {
  const [release] = useCachedQuery(queries.ticketRowById({ ticketId: releaseId }));
  if (!release) return null;

  return (
    <div className='flex h-full min-h-0 min-w-0 flex-col bg-background [&_.relative.min-h-0.max-h-full]:flex-1'>
      <ThreadMessages
        key={release.id}
        channelId={release.channelId}
        conversationId={release.conversationId}
        ticketId={release.id}
        defaultTab='thread'
        onClose={onClose}
        onUserClick={noopUserClick}
        skipInputAutoFocus
      />
    </div>
  );
}

function DetailTabs({
  tabs,
  active,
  onSelect,
}: {
  tabs: { id: DetailTab; label: string; count: number }[];
  active: DetailTab;
  onSelect: (tab: DetailTab) => void;
}): ReactElement {
  return (
    <div role='tablist' className='mt-6 flex shrink-0 flex-wrap gap-6 border-b border-border'>
      {tabs.map(item => {
        const selected = item.id === active;
        return (
          <button
            key={item.id}
            type='button'
            role='tab'
            aria-selected={selected}
            onClick={() => onSelect(item.id)}
            className={cn(
              '-mb-px flex items-center gap-2 border-b-2 pb-2.5 text-[14.5px] transition-colors',
              selected
                ? 'border-primary font-semibold text-foreground'
                : 'border-transparent font-medium text-muted-foreground hover:text-foreground',
            )}
            data-track-category={TRACK_CATEGORY}
            data-track-name='ReleaseDetailTabOpened'
            data-track-label={item.id}
          >
            {item.label}
            {item.count > 0 && (
              <span className='rounded bg-muted px-1.5 text-[11.5px] font-medium text-muted-foreground'>
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function TicketsTab({
  releaseId,
  canRerun,
  tickets,
  projectId,
  onOpenTicket,
}: {
  releaseId: string;
  canRerun: boolean;
  tickets: readonly { id: string; xyneId: string; title: string }[];
  projectId: string;
  onOpenTicket: (ticketId: string) => void;
}): ReactElement {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const fade = useScrollFade<HTMLDivElement>('y', TICKETS_FADE_PX);
  const fadeRef = fade.ref;
  const scrollerRef = useCallback(
    (element: HTMLDivElement | null): void => {
      setScroller(element);
      fadeRef(element);
    },
    [fadeRef],
  );
  const [searchValue, setSearchValue] = useState('');
  const [filters, setFilters] = useState<TicketFilters>({});
  const [showOverdueOnly, setShowOverdueOnly] = useState(false);
  const [tagQuery, setTagQuery] = useState('');
  const deferredFilters = useDeferredValue(filters);
  const canManage = useCanManageRelease();
  const usersById = useUsersById();
  const userGroups = useUserGroups();
  const channels = useAllChannels();
  const [projectTags] = useCachedQuery(
    queries.projectTagsByProjectId({ projectId, limit: TAG_PAGE_SIZE, start: null }),
    { enabled: !!projectId && !tagQuery.trim() },
  );
  const { tags: searchedTags } = useVespaTagSearch({
    projectId,
    searchQuery: tagQuery,
    enabled: !!projectId && !!tagQuery.trim(),
    limit: 20,
  });

  const names = useMemo(
    () => ({
      userNamesById: new Map([...usersById].map(([id, user]) => [id, getUserDisplayName(user)])),
      userGroupNamesById: new Map(userGroups.map(group => [group.id, group.name])),
      channelNamesById: new Map(channels.map(channel => [channel.id, channel.name])),
    }),
    [usersById, userGroups, channels],
  );
  const availableTags = useMemo(
    () =>
      tagQuery.trim()
        ? searchedTags
        : [...new Set((projectTags ?? []).map(tag => tag.name))].sort(),
    [tagQuery, searchedTags, projectTags],
  );
  const pickerContext = useMemo(
    () => ({
      projectId,
      availablePriorities: PRIORITIES,
      availableTags,
      onSearchTags: setTagQuery,
    }),
    [projectId, availableTags],
  );

  const isExactSearch = hasExactSearchQuotes(searchValue);
  const needle = unwrapExactSearchQuery(searchValue).trim();
  const scopedTicketIds = useMemo(() => {
    const matches = (text: string): boolean =>
      isExactSearch ? text.includes(needle) : text.toLowerCase().includes(needle.toLowerCase());
    return tickets
      .filter(ticket => !needle || matches(ticket.xyneId) || matches(ticket.title))
      .map(ticket => ticket.id);
  }, [tickets, needle, isExactSearch]);
  const isFiltered = hasAnyFilterChip(filters, showOverdueOnly);

  return (
    <div className='mt-5 flex min-h-0 flex-1 flex-col gap-3 pb-6'>
      <div className='flex min-h-[30px] shrink-0 flex-wrap items-center gap-x-2 gap-y-[7px]'>
        <TicketSearchInput
          value={searchValue}
          onChange={setSearchValue}
          isExactSearch={isExactSearch}
          onExactSearchChange={exact =>
            setSearchValue(
              exact
                ? wrapExactSearchQuery(searchValue) || '""'
                : unwrapExactSearchQuery(searchValue),
            )
          }
          className='w-[260px] max-w-full'
        />
        <TicketFilterChips
          filters={filters}
          onFiltersChange={setFilters}
          pickerContext={pickerContext}
          names={names}
          hideAssigneeFilter={false}
          showFlagFilters={false}
          showOverdueOnly={showOverdueOnly}
          onOverdueChange={setShowOverdueOnly}
          onClearFilters={() => {
            setFilters({});
            setShowOverdueOnly(false);
          }}
        />
        {canManage && canRerun && <RerunAnalysisButton releaseId={releaseId} className='ml-auto' />}
      </div>
      <div className='flex min-h-0 flex-col overflow-hidden rounded-[10px] border border-border bg-background'>
        <div
          ref={scrollerRef}
          onScroll={fade.onScroll}
          style={fade.style}
          className='no-scrollbar min-h-0 overflow-y-auto'
        >
          <div className='-mb-px'>
            <TableGroupSection
              args={{
                viewMode: 'project',
                scopeTicketIds: scopedTicketIds,
                filters: deferredFilters,
                showOverdueOnly,
              }}
              enabled={tickets.length > 0}
              pageSize={TICKET_PAGE_SIZE}
              {...(isFiltered ? {} : { totalCount: scopedTicketIds.length })}
              onTicketOpen={ticket => onOpenTicket(ticket.id)}
              scrollElement={scroller}
              visibleColumns={TICKET_COLUMNS}
              isComfortView={false}
              availableTags={availableTags}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function NoTicketsCard({
  releaseId,
  repo,
  range,
}: {
  releaseId: string;
  repo: SdlcReleaseRepo | undefined;
  range: ReleaseRepositoryRow | undefined;
}): ReactElement {
  const canManage = useCanManageRelease();
  const isVersionRelease = repo?.config?.mode === ReleaseTrackingMode.VERSION;

  const facts: { label: string; value: string; mono?: boolean }[] = isVersionRelease
    ? [{ label: 'Repository', value: repoPath(repo?.repoUrl) }]
    : [
        { label: 'Repository', value: repoPath(repo?.repoUrl) },
        { label: 'Branch', value: range?.branch || '—', mono: true },
        {
          label: 'Commit range',
          value: range
            ? `${range.deployedCommit.slice(0, 8)} → ${range.newCommit.slice(0, 8)}`
            : '—',
          mono: true,
        },
      ];

  return (
    <div className='mt-5 shrink-0 overflow-hidden rounded-xl border border-border bg-background'>
      <div className='flex flex-wrap items-start gap-4 p-5'>
        <span className='flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground'>
          <ListChecks size={17} />
        </span>
        <div className='flex min-w-[260px] flex-1 flex-col gap-1'>
          <span className='text-[15px] font-semibold text-foreground'>
            {isVersionRelease
              ? 'No tickets tagged with this version'
              : 'No tickets linked to this release'}
          </span>
          <span className='text-[13.5px] leading-normal text-muted-foreground'>
            {isVersionRelease
              ? "Dev tickets tagged with this release's version are added here automatically."
              : "None of the commits in this range reference a ticket. Link commits to tickets, then re-run analysis to build what's in it, env and migration changes, and release notes."}
          </span>
        </div>
        {canManage && !isVersionRelease && <RerunAnalysisButton releaseId={releaseId} />}
      </div>
      <div className='grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-x-6 gap-y-3.5 border-t border-border/70 bg-muted/30 px-5 py-3.5'>
        {facts.map(fact => (
          <div key={fact.label} className='flex min-w-0 flex-col gap-1'>
            <span className='text-xs text-muted-foreground'>{fact.label}</span>
            <span
              className={cn(
                'truncate text-foreground',
                fact.mono ? 'font-code text-[12.5px]' : 'text-[13.5px]',
              )}
            >
              {fact.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RerunAnalysisButton({
  releaseId,
  className,
}: {
  releaseId: string;
  className?: string;
}): ReactElement {
  const { rerunning, rerun } = useRerunReleaseAnalysis(releaseId);
  return (
    <Button
      variant='outline'
      size='sm'
      onClick={() => void rerun()}
      disabled={rerunning}
      className={cn('h-[30px] gap-1.5', className)}
      data-track-category={TRACK_CATEGORY}
      data-track-name='ReleaseReRunAnalysis'
    >
      <Sparkles className={cn('size-3.5 text-status-paused', rerunning && 'animate-pulse')} />
      {rerunning ? 'Re-running…' : 'Re-run analysis'}
    </Button>
  );
}
