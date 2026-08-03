import {
  ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'sonner';
import { Archive, Loader2, Lock, Plus } from 'lucide-react';
import { RoomStatus, type RoomWithMembers, type RoomWithMembership } from '@xyne/shared';
import { useZero } from '../../hooks/useZero';
import { queries } from '../../zero/queries';
import { mutators } from '../../zero/mutators';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { useSelf } from '../../hooks/useUsers';
import { useVisibleProjects } from '../../hooks/useChannels';
import { Button } from '../../components/ui/Button';
import { cn } from '../../utils/classNames';
import { RoomCard, partitionRooms } from '../../components/Rooms';

type DirectoryView = 'active' | 'archived';

const ROOM_PAGE_SIZE = 24;

interface RoomCursor {
  createdAt: number;
  id: string;
}

const getRoomCursorKey = (cursor: RoomCursor | null): string =>
  cursor ? `${cursor.createdAt}:${cursor.id}` : 'first-page';

const sortRooms = (rooms: RoomWithMembers[]): RoomWithMembers[] =>
  [...rooms].sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));

interface RoomPages {
  rooms: RoomWithMembers[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
}

function useRoomPages(status: RoomStatus): RoomPages {
  const [cursor, setCursor] = useState<RoomCursor | null>(null);
  const [rooms, setRooms] = useState<RoomWithMembers[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const pageIdsRef = useRef<Set<string>>(new Set());
  const pageKeyRef = useRef<string>('');

  useLayoutEffect(() => {
    setCursor(null);
    setRooms([]);
    setHasMore(true);
    pageIdsRef.current = new Set();
    pageKeyRef.current = '';
  }, [status]);

  const query = useMemo(
    () => queries.roomsPaginated({ status, limit: ROOM_PAGE_SIZE, start: cursor }),
    [status, cursor],
  );
  const [page, pageDetails] = useCachedQuery(query as never, { cursorEnabled: true });
  const isComplete = pageDetails.type === 'complete';

  useEffect(() => {
    if (!isComplete) return;
    const rows = (page as unknown as RoomWithMembers[]) ?? [];
    const pageKey = `${status}:${getRoomCursorKey(cursor)}`;
    const previousIds = pageKeyRef.current === pageKey ? pageIdsRef.current : new Set<string>();
    const nextIds = new Set(rows.map(room => room.id));

    setRooms(previous => {
      const byId = new Map(previous.map(room => [room.id, room]));
      previousIds.forEach(roomId => {
        if (!nextIds.has(roomId)) byId.delete(roomId);
      });
      rows.forEach(room => byId.set(room.id, room));
      return sortRooms(Array.from(byId.values()));
    });

    pageIdsRef.current = nextIds;
    pageKeyRef.current = pageKey;
    setHasMore(rows.length === ROOM_PAGE_SIZE);
  }, [cursor, isComplete, page, status]);

  const loadMore = useCallback((): void => {
    if (!hasMore || !isComplete) return;
    const last = rooms[rooms.length - 1];
    if (!last) return;
    setCursor(current =>
      current?.id === last.id ? current : { createdAt: last.createdAt, id: last.id },
    );
  }, [hasMore, isComplete, rooms]);

  return {
    rooms,
    isLoading: !isComplete && rooms.length === 0,
    isLoadingMore: !isComplete && rooms.length > 0,
    hasMore,
    loadMore,
  };
}

const RoomsDirectoryScreen = (): ReactElement => {
  const navigate = useNavigate();
  const zero = useZero();
  const self = useSelf();
  const [searchParams] = useSearchParams();
  const view: DirectoryView = searchParams.get('view') === 'archived' ? 'archived' : 'active';
  const status = view === 'archived' ? RoomStatus.ARCHIVED : RoomStatus.ACTIVE;

  const { rooms, isLoading, isLoadingMore, hasMore, loadMore } = useRoomPages(status);
  const projects = useVisibleProjects();

  const projectNameById = useMemo(
    () => new Map(projects.map(project => [project.id, project.name])),
    [projects],
  );

  const { joined, suggested } = useMemo(() => partitionRooms(rooms, self?.id), [rooms, self?.id]);

  const handleOpenCreateWizard = (): void => {
    void navigate('/rooms/new');
  };

  const handleOpenRoom = (roomId: string): void => {
    void navigate(`/rooms/${roomId}`);
  };

  const setView = (next: DirectoryView): void => {
    void navigate(next === 'archived' ? '/rooms?view=archived' : '/rooms');
  };

  const requestAccess = async (roomId: string): Promise<void> => {
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

  const handleRequestAccess = (roomId: string): void => {
    void requestAccess(roomId);
  };

  const renderGrid = (entries: RoomWithMembership[], testId: string): ReactElement => (
    <div className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3' data-testid={testId}>
      {entries.map((entry, index) => (
        <RoomCard
          key={entry.room.id}
          entry={entry}
          projectName={projectNameById.get(entry.room.projectId)}
          onOpen={handleOpenRoom}
          onRequestAccess={handleRequestAccess}
          className='motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-300 motion-safe:fill-mode-backwards'
          style={{ animationDelay: `${Math.min(index, 5) * 45}ms` }}
        />
      ))}
    </div>
  );

  const loadMoreButton = (): ReactElement | null =>
    hasMore ? (
      <div className='mt-6 flex justify-center'>
        <Button
          variant='outline'
          onClick={loadMore}
          disabled={isLoadingMore}
          data-track-category='Rooms'
          data-track-name='LoadMoreRooms'
          data-testid='load-more-rooms'
        >
          {isLoadingMore && <Loader2 size={14} className='animate-spin' />}
          {isLoadingMore ? 'Loading…' : 'Load more'}
        </Button>
      </div>
    ) : null;

  const loadingGrid = (
    <div
      className='grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3'
      data-testid='rooms-directory-loading'
    >
      {[0, 1, 2].map(index => (
        <div key={index} className='h-[148px] animate-pulse rounded-2xl bg-muted' />
      ))}
    </div>
  );

  const tab = (value: DirectoryView, label: string): ReactElement => (
    <button
      type='button'
      onClick={() => setView(value)}
      aria-pressed={view === value}
      data-track-category='Rooms'
      data-track-name='SwitchDirectoryView'
      data-track-metadata={JSON.stringify({ view: value })}
      data-testid={`rooms-view-${value}`}
      className={cn(
        'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
        view === value
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  );

  return (
    <div
      data-testid='rooms-directory'
      className='h-full bg-background flex flex-col md:rounded-2xl overflow-hidden shadow-md'
    >
      <div className='flex-1 overflow-y-auto p-8'>
        <div className='max-w-6xl mx-auto'>
          <div className='mb-6 flex items-start justify-between gap-4'>
            <div>
              <h1 className='text-2xl font-bold text-foreground [text-wrap:balance]'>Rooms</h1>
              <p className='mt-1 text-sm text-muted-foreground [text-wrap:pretty]'>
                Private rooms for catching up across channels.
              </p>
            </div>
            <Button
              className='shrink-0'
              onClick={handleOpenCreateWizard}
              data-track-category='Rooms'
              data-track-name='OpenCreateRoom'
              data-testid='create-room-open'
            >
              <Plus size={16} />
              Create room
            </Button>
          </div>

          <div className='mb-8 inline-flex rounded-lg border border-border bg-muted p-0.5'>
            {tab('active', 'Active')}
            {tab('archived', 'Archived')}
          </div>

          {isLoading ? (
            loadingGrid
          ) : view === 'active' ? (
            <>
              <section className='mb-10'>
                <h2 className='mb-3 text-sm font-semibold text-foreground'>Your rooms</h2>
                {joined.length > 0 ? (
                  renderGrid(joined, 'joined-rooms')
                ) : (
                  <div className='rounded-2xl border border-dashed border-border p-10 text-center'>
                    <Lock size={20} className='mx-auto mb-2 text-muted-foreground' />
                    <p className='text-sm font-medium text-foreground'>No rooms yet</p>
                    <p className='mt-1 text-xs text-muted-foreground [text-wrap:pretty]'>
                      Create a private room to start tracking something across your workspace.
                    </p>
                    <Button
                      className='mt-4'
                      onClick={handleOpenCreateWizard}
                      data-track-category='Rooms'
                      data-track-name='OpenCreateRoomEmptyState'
                    >
                      <Plus size={16} />
                      Create your first room
                    </Button>
                  </div>
                )}
              </section>

              {suggested.length > 0 && (
                <section>
                  <div className='mb-3 flex items-center justify-between'>
                    <h2 className='text-sm font-semibold text-foreground'>Other rooms</h2>
                    <span className='inline-flex items-center gap-1 text-xs text-muted-foreground'>
                      <Lock size={12} />
                      Approval required
                    </span>
                  </div>
                  {renderGrid(suggested, 'suggested-rooms')}
                </section>
              )}

              {loadMoreButton()}
            </>
          ) : (
            <section>
              <h2 className='mb-3 text-sm font-semibold text-foreground'>Archived rooms</h2>
              {joined.length > 0 ? (
                renderGrid(joined, 'archived-rooms')
              ) : (
                <div className='rounded-2xl border border-dashed border-border p-10 text-center'>
                  <Archive size={20} className='mx-auto mb-2 text-muted-foreground' />
                  <p className='text-sm font-medium text-foreground'>No archived rooms</p>
                  <p className='mt-1 text-xs text-muted-foreground [text-wrap:pretty]'>
                    Rooms you archive show up here — their history stays readable.
                  </p>
                </div>
              )}
              {loadMoreButton()}
            </section>
          )}
        </div>
      </div>
    </div>
  );
};

RoomsDirectoryScreen.displayName = 'RoomsDirectoryScreen';

export default RoomsDirectoryScreen;
