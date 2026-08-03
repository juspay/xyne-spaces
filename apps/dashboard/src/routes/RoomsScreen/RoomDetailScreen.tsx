import { ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'sonner';
import * as Tabs from '@radix-ui/react-tabs';
import {
  ArrowLeft,
  BookOpen,
  FolderKanban,
  Link2,
  ListChecks,
  Lock,
  Settings,
  Sparkles,
  Ticket,
  Users,
} from 'lucide-react';
import {
  RoomMemberStatus,
  RoomRecapStatus,
  RoomRecapType,
  type RoomMember,
  type RoomRecap,
  type RoomSource,
} from '@xyne/shared';
import { xyneAIActor } from '../../machines/xyneAIMachine';
import { setPendingContextSeed } from '../../components/Chat/XyneAISidebar/utils/pendingContextSeed';
import { useZero } from '../../hooks/useZero';
import { queries } from '../../zero/queries';
import { mutators } from '../../zero/mutators';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { useSelf, useUser } from '../../hooks/useUsers';
import { useVisibleProjects } from '../../hooks/useChannels';
import { getUserDisplayName } from '../../utils/userDisplayName';
import { Button } from '../../components/ui/Button';
import {
  CADENCE_OPTIONS,
  RoomChecklistTab,
  RoomMembersTab,
  RoomSettingsDialog,
  RoomSourcesTab,
  RoomSummaryTab,
  RoomUpdatesTab,
  formatUpdatedAt,
  getRoomOwnerId,
  isRoomOwner,
} from '../../components/Rooms';
import { useClawAgents } from '../../hooks/useClawAgents';
import { cn } from '../../utils/classNames';

type TabValue = 'summary' | 'checklist' | 'sources' | 'updates' | 'members';

const RECAP_PAGE_SIZE = 10;

interface RecapCursor {
  createdAt: number;
  id: string;
}

const getRecapCursorKey = (cursor: RecapCursor | null): string =>
  cursor ? `${cursor.createdAt}:${cursor.id}` : 'first-page';

const sortRecaps = (recaps: RoomRecap[]): RoomRecap[] =>
  [...recaps].sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));

interface RecapPages {
  recaps: RoomRecap[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
}

function useRoomRecapPages(roomId: string, type: RoomRecapType): RecapPages {
  const [cursor, setCursor] = useState<RecapCursor | null>(null);
  const [recaps, setRecaps] = useState<RoomRecap[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const pageIdsRef = useRef<Set<string>>(new Set());
  const pageKeyRef = useRef<string>('');

  const query = useMemo(
    () => queries.roomRecapsPaginated({ roomId, type, limit: RECAP_PAGE_SIZE, start: cursor }),
    [roomId, type, cursor],
  );
  const [page, pageDetails] = useCachedQuery(query as never, {
    cursorEnabled: true,
    enabled: !!roomId,
  });
  const isComplete = pageDetails.type === 'complete';

  useEffect(() => {
    if (!isComplete) return;
    const rows = (page as unknown as RoomRecap[]) ?? [];
    const pageKey = `${roomId}:${getRecapCursorKey(cursor)}`;
    const previousIds = pageKeyRef.current === pageKey ? pageIdsRef.current : new Set<string>();
    const nextIds = new Set(rows.map(recap => recap.id));

    setRecaps(previous => {
      const byId = new Map(previous.map(recap => [recap.id, recap]));
      previousIds.forEach(recapId => {
        if (!nextIds.has(recapId)) byId.delete(recapId);
      });
      rows.forEach(recap => byId.set(recap.id, recap));
      return sortRecaps(Array.from(byId.values()));
    });

    pageIdsRef.current = nextIds;
    pageKeyRef.current = pageKey;
    setHasMore(rows.length === RECAP_PAGE_SIZE);
  }, [cursor, isComplete, page, roomId]);

  const loadMore = useCallback((): void => {
    if (!hasMore || !isComplete) return;
    const last = recaps[recaps.length - 1];
    if (!last) return;
    setCursor(current =>
      current?.id === last.id ? current : { createdAt: last.createdAt, id: last.id },
    );
  }, [hasMore, isComplete, recaps]);

  return {
    recaps,
    isLoading: !isComplete && recaps.length === 0,
    isLoadingMore: !isComplete && recaps.length > 0,
    hasMore,
    loadMore,
  };
}

const TabTrigger = ({
  value,
  icon: Icon,
  label,
  count = 0,
}: {
  value: TabValue;
  icon: React.ElementType;
  label: string;
  count?: number;
}): ReactElement => (
  <Tabs.Trigger
    value={value}
    className={cn(
      'flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px',
      'text-muted-foreground border-transparent hover:text-foreground hover:border-muted',
      'data-[state=active]:text-primary data-[state=active]:border-primary',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    )}
  >
    <Icon size={16} />
    {label}
    {count > 0 && (
      <span
        data-testid={`tab-pending-count-${value}`}
        title={`${count} awaiting approval`}
        className='inline-flex min-w-[1.125rem] items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold leading-none text-primary-foreground tabular-nums'
      >
        {count}
      </span>
    )}
  </Tabs.Trigger>
);

const RoomDetailScreen = (): ReactElement => {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const zero = useZero();
  const self = useSelf();
  const [activeTab, setActiveTab] = useState<TabValue>('summary');
  const [showSettings, setShowSettings] = useState(false);

  const [room, roomStatus] = useCachedQuery(queries.roomDetail({ roomId: roomId || '' }), {
    enabled: !!roomId,
  });
  const summaryPages = useRoomRecapPages(roomId || '', RoomRecapType.SUMMARY);
  const checklistPages = useRoomRecapPages(roomId || '', RoomRecapType.CHECKLIST);

  const members = useMemo((): readonly RoomMember[] => room?.members ?? [], [room]);
  const sources = useMemo((): readonly RoomSource[] => room?.sources ?? [], [room]);

  const ownerId = getRoomOwnerId(members);
  const owner = useUser(ownerId ?? '');
  const projects = useVisibleProjects();
  const projectName = projects.find(project => project.id === room?.projectId)?.name;

  const myMembership = useMemo(
    () => members.find(member => member.userId === self?.id),
    [members, self?.id],
  );
  const isOwner = isRoomOwner(members, self?.id);
  const isApprovedMember = myMembership?.status === RoomMemberStatus.APPROVED;
  const canViewContents = isOwner || isApprovedMember;
  const membershipResolved = roomStatus.type === 'complete';

  const pendingSummaryCount = isOwner
    ? summaryPages.recaps.filter(
        recap => recap.status === RoomRecapStatus.PENDING && !recap.deletedAt,
      ).length
    : 0;
  const pendingChecklistCount = isOwner
    ? checklistPages.recaps.filter(
        recap => recap.status === RoomRecapStatus.PENDING && !recap.deletedAt,
      ).length
    : 0;

  const { agents } = useClawAgents();
  const cadenceLabel =
    CADENCE_OPTIONS.find(option => option.value === room?.curationCadence)?.label ?? 'Manual';
  const curationAgentLabel = room?.clawAgentId
    ? (agents.find(agent => agent.slug === room.clawAgentId)?.name ?? room.clawAgentId)
    : (agents.find(agent => agent.slug === 'ask-ai')?.name ?? 'Ask AI');

  const handleBack = (): void => {
    void navigate('/rooms');
  };

  const handleArchived = (): void => {
    void navigate('/rooms?view=archived');
  };

  const handleOpenSettings = (): void => {
    setShowSettings(true);
  };

  const handleTabChange = (value: string): void => {
    setActiveTab(value as TabValue);
  };

  const handleAskAI = (): void => {
    setPendingContextSeed({
      channels: sources
        .slice(0, 5)
        .map(source => ({ id: source.sourceId, name: source.label, isPrivate: false })),
      tickets: [],
      canvases: [],
      transcripts: [],
      recordings: [],
    });
    xyneAIActor.send({ type: 'OPEN', startFreshChat: true });
  };

  const handleRequestAccess = async (): Promise<void> => {
    if (!roomId) return;
    const result = zero.mutate(
      mutators.room.requestAccess({ roomId, memberId: uuidv4(), timestamp: Date.now() }),
    );
    const res = await result.server;
    if (res.type === 'error') {
      toast.error('Could not request access', { description: res.error.message });
    } else {
      toast.success('Access request sent to the room owner');
    }
  };

  if (!room) {
    if (roomStatus.type !== 'complete') {
      return (
        <div className='h-full bg-muted flex items-center justify-center'>
          <p className='text-muted-foreground'>Loading...</p>
        </div>
      );
    }
    return (
      <div className='h-full bg-muted flex flex-col items-center justify-center gap-3'>
        <p className='text-sm text-muted-foreground'>This room does not exist.</p>
        <Button variant='secondary' onClick={handleBack}>
          Back to Rooms
        </Button>
      </div>
    );
  }

  return (
    <div className='h-full bg-muted flex flex-col' data-testid='room-detail'>
      <div className='flex-1 overflow-auto p-8'>
        <div className='max-w-6xl mx-auto'>
          <button
            onClick={handleBack}
            className='flex items-center gap-2 text-muted-foreground hover:text-foreground mb-6 transition-colors'
            data-track-category='Rooms'
            data-track-name='BackToRooms'
          >
            <ArrowLeft size={20} />
            <span>Back to Rooms</span>
          </button>

          <div className='mb-8 rounded-2xl border border-border bg-background p-6 shadow-sm'>
            <div className='flex items-start justify-between gap-4'>
              <div className='min-w-0'>
                <div className='mb-2 flex items-center gap-3'>
                  <h1 className='truncate text-3xl font-bold text-foreground [text-wrap:balance]'>
                    {room.name}
                  </h1>
                  <span className='inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground'>
                    <Lock size={11} />
                    Private
                  </span>
                  {projectName && (
                    <span className='inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'>
                      <FolderKanban size={11} />
                      {projectName}
                    </span>
                  )}
                </div>
                <p className='text-muted-foreground [text-wrap:pretty]'>{room.description}</p>
                <p className='mt-3 text-sm text-muted-foreground'>
                  {ownerId && (
                    <>
                      Created by{' '}
                      <span className='font-medium text-foreground'>
                        {owner ? getUserDisplayName(owner) : '…'}
                      </span>{' '}
                      ·{' '}
                    </>
                  )}
                  <span className='tabular-nums'>Updated {formatUpdatedAt(room.updatedAt)}</span>
                  {canViewContents && (
                    <>
                      {' '}
                      · {cadenceLabel} curation by {curationAgentLabel}
                    </>
                  )}
                </p>
              </div>
              <div className='flex shrink-0 items-center gap-2'>
                {canViewContents && (
                  <Button
                    onClick={handleAskAI}
                    data-track-category='Rooms'
                    data-track-name='RoomAskAI'
                    data-testid='room-ask-ai'
                  >
                    <Sparkles size={15} />
                    Ask AI
                  </Button>
                )}
                {isOwner && (
                  <Button
                    variant='outline'
                    size='icon'
                    aria-label='Room settings'
                    onClick={handleOpenSettings}
                    data-track-category='Rooms'
                    data-track-name='OpenRoomSettings'
                    data-testid='open-room-settings'
                  >
                    <Settings size={16} />
                  </Button>
                )}
                {membershipResolved && !canViewContents && myMembership === undefined && (
                  <Button
                    onClick={() => void handleRequestAccess()}
                    data-testid='request-room-access'
                  >
                    Request access
                  </Button>
                )}
                {membershipResolved && !canViewContents && myMembership !== undefined && (
                  <span className='whitespace-nowrap rounded-full border border-border px-2 py-1 text-xs font-medium text-muted-foreground'>
                    Access requested
                  </span>
                )}
              </div>
            </div>
          </div>

          {canViewContents ? (
            <>
              <div className='border-b border-border bg-background rounded-t-lg'>
                <Tabs.Root value={activeTab} onValueChange={handleTabChange}>
                  <Tabs.List className='flex gap-0 px-6'>
                    <TabTrigger
                      value='summary'
                      icon={BookOpen}
                      label='Summary'
                      count={pendingSummaryCount}
                    />
                    <TabTrigger
                      value='checklist'
                      icon={ListChecks}
                      label='Checklist'
                      count={pendingChecklistCount}
                    />
                    <TabTrigger value='sources' icon={Link2} label='Sources' />
                    <TabTrigger value='updates' icon={Ticket} label='Updates' />
                    <TabTrigger value='members' icon={Users} label='Members' />
                  </Tabs.List>
                </Tabs.Root>
              </div>
              <div className='bg-background rounded-b-lg shadow-sm border border-t-0 border-border p-6'>
                <Tabs.Root value={activeTab} onValueChange={handleTabChange}>
                  <Tabs.Content value='summary' className='outline-none'>
                    <RoomSummaryTab
                      room={room}
                      recaps={summaryPages.recaps}
                      recapsLoading={summaryPages.isLoading}
                      hasMoreRecaps={summaryPages.hasMore}
                      isLoadingMoreRecaps={summaryPages.isLoadingMore}
                      onLoadMoreRecaps={summaryPages.loadMore}
                      sources={sources}
                      isOwner={isOwner}
                    />
                  </Tabs.Content>
                  <Tabs.Content value='checklist' className='outline-none'>
                    <RoomChecklistTab
                      recaps={checklistPages.recaps}
                      recapsLoading={checklistPages.isLoading}
                      hasMoreRecaps={checklistPages.hasMore}
                      isLoadingMoreRecaps={checklistPages.isLoadingMore}
                      onLoadMoreRecaps={checklistPages.loadMore}
                      isOwner={isOwner}
                      hasChecklistTemplate={!!room.checklistTemplate?.trim()}
                    />
                  </Tabs.Content>
                  <Tabs.Content value='sources' className='outline-none'>
                    <RoomSourcesTab roomId={room.id} sources={sources} canManage={isOwner} />
                  </Tabs.Content>
                  <Tabs.Content value='updates' className='outline-none'>
                    <RoomUpdatesTab
                      recaps={summaryPages.recaps}
                      sources={sources}
                      members={members}
                    />
                  </Tabs.Content>
                  <Tabs.Content value='members' className='outline-none'>
                    <RoomMembersTab
                      roomId={room.id}
                      members={members}
                      selfUserId={self?.id}
                      canManage={isOwner}
                    />
                  </Tabs.Content>
                </Tabs.Root>
              </div>
            </>
          ) : !membershipResolved ? (
            <div className='bg-background rounded-lg shadow-sm border border-border p-10 text-center'>
              <p className='text-sm text-muted-foreground'>Loading...</p>
            </div>
          ) : (
            <div className='bg-background rounded-lg shadow-sm border border-border p-10 text-center'>
              <Lock size={22} className='text-muted-foreground mx-auto mb-3' />
              <h2 className='text-base font-semibold text-foreground'>This room is private</h2>
              <p className='text-sm text-muted-foreground mt-1'>
                Sources, members, and summaries are visible to approved members only.
              </p>
            </div>
          )}
        </div>
      </div>

      {isOwner && (
        <RoomSettingsDialog
          room={room}
          open={showSettings}
          onOpenChange={setShowSettings}
          onArchived={handleArchived}
        />
      )}
    </div>
  );
};

RoomDetailScreen.displayName = 'RoomDetailScreen';

export default RoomDetailScreen;
