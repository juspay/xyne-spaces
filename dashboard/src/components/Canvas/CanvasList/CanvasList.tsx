import React, { useState, useMemo, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import {
  FileText,
  Trash2,
  Copy,
  Search,
  MoreVertical,
  Share2,
  Globe,
  Lock,
  Star,
  Users,
  Hash,
} from 'lucide-react';
import { CanvasListProps, Canvas, CanvasParticipant } from '../Canvas.types';
import { CanvasRole, CanvasVisibility } from '@xyne/shared';
import Avatar from '../../ui/Avatar/Avatar';
import { AvatarStackItem } from '../../ui/Avatar/AvatarGroup';
import Input from '../../ui/Input';
import { Tooltip } from '../../ui/Tooltip/Tooltip';
import { Dialog } from '../../ui/Dialog';
import { useUser } from '../../../hooks/useUsers';
import { useUserGroups } from '../../../hooks/useUserGroup';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import { CanvasDeleteModal } from '../CanvasDeleteModal';
import { CanvasShareModal } from '../CanvasShareModal';
import { usePlatform } from '../../../hooks/usePlatform';
import { queries } from '../../../zero/queries';
import { CanvasParticipantsTray, type ParticipantItem } from '../CanvasParticipantsTray';
import { useNavigate } from 'react-router-dom';
import { useCanvasPrefetch } from '../../../hooks/useCanvasPrefetch';
import { useCachedQuery, useAllVisibleChannels } from '@xyne/shared/hooks';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { useShortcut } from '../../../shortcuts';
import { toast } from 'sonner';
import {
  filterExcludedCallGeneratedCanvases,
  filterStarredCanvases,
  withStarredCanvasState,
} from '../canvasFilters';

type FilterTab = 'all' | 'created_by_me';
type CanvasCursor = { id: string; updatedAt: number };

type RowAccessEntry =
  | { kind: 'user'; key: string; userId: string }
  | { kind: 'group'; key: string; name: string }
  | { kind: 'channel'; key: string; name: string };

const AccessAvatars: React.FC<{ entries: RowAccessEntry[]; max: number }> = ({ entries, max }) => {
  const shown = entries.slice(0, max);
  const remaining = entries.length - shown.length;
  return (
    <div data-slot='avatar-group' className='flex items-center'>
      {shown.map(entry => (
        <AvatarStackItem key={entry.key} size={20}>
          {entry.kind === 'user' ? (
            <Avatar userId={entry.userId} size='sm' showActiveStatus={false} />
          ) : (
            <div className='flex size-full items-center justify-center rounded-full bg-muted text-muted-foreground'>
              {entry.kind === 'group' ? (
                <Users className='h-3 w-3' />
              ) : (
                <Hash className='h-3 w-3' />
              )}
            </div>
          )}
        </AvatarStackItem>
      ))}
      {remaining > 0 && (
        <AvatarStackItem size={20}>
          <div className='flex size-full items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground'>
            {remaining}
          </div>
        </AvatarStackItem>
      )}
    </div>
  );
};

const CANVAS_PAGE_SIZE = 25;

const getCanvasCursorKey = (cursor: CanvasCursor): string => `${cursor.updatedAt}:${cursor.id}`;

const getNullableCanvasCursorKey = (cursor: CanvasCursor | null): string =>
  cursor ? getCanvasCursorKey(cursor) : 'first-page';

const sortCanvasItems = (items: Canvas[]): Canvas[] =>
  [...items].sort((a, b) => b.updatedAt - a.updatedAt || b.id.localeCompare(a.id));

const updateOptimisticStarState = (
  canvas: Canvas,
  canvasId: string,
  userId: string | undefined,
  isStarred: boolean,
): Canvas => {
  if (canvas.id !== canvasId) {
    return canvas;
  }

  if (!userId) {
    return {
      ...canvas,
      isStarred,
    };
  }

  const now = Date.now();
  const userStatuses = canvas.userStatuses ?? [];
  const existingStatus = userStatuses.find(status => status.userId === userId);
  const nextUserStatuses = existingStatus
    ? userStatuses.map(status =>
        status.userId === userId
          ? {
              ...status,
              isStarred,
              updatedAt: now,
            }
          : status,
      )
    : [
        ...userStatuses,
        {
          id: `optimistic-${canvasId}-${userId}`,
          canvasId,
          userId,
          isStarred,
          createdAt: now,
          updatedAt: now,
        },
      ];

  return {
    ...canvas,
    isStarred,
    userStatuses: nextUserStatuses,
  };
};

const CreatorName: React.FC<{ userId: string; isCurrentUser: boolean }> = ({
  userId,
  isCurrentUser,
}) => {
  const user = useUser(userId);
  const displayName = user?.name || user?.email || 'Unknown';
  if (isCurrentUser) {
    return <span>{displayName} (You)</span>;
  }
  return <span>{displayName}</span>;
};

const ParticipantsTray: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  canvas: Canvas;
}> = ({ isOpen, onClose, canvas }) => {
  const participants = (
    canvas as Canvas & {
      participants?: {
        id: string;
        userId?: string | null;
        userGroupId?: string | null;
        channelId?: string | null;
        role: CanvasRole;
      }[];
    }
  ).participants;
  const allUserGroups = useUserGroups();
  const allVisibleChannels = useAllVisibleChannels();
  const groupNameById = useMemo(
    () => new Map(allUserGroups.map(g => [g.id, g.name])),
    [allUserGroups],
  );
  const channelNameById = useMemo(
    () => new Map(allVisibleChannels.map(c => [c.id, c.name])),
    [allVisibleChannels],
  );

  const formattedParticipants: ParticipantItem[] = useMemo(() => {
    const rows = participants ?? [];
    const entries: ParticipantItem[] = [];
    const seenUserIds = new Set<string>();
    if (canvas.createdBy) {
      entries.push({
        id: `creator:${canvas.createdBy}`,
        kind: 'user',
        userId: canvas.createdBy,
        role: CanvasRole.OWNER,
      });
      seenUserIds.add(canvas.createdBy);
    }
    for (const p of rows) {
      if (p.userId) {
        if (seenUserIds.has(p.userId)) continue;
        seenUserIds.add(p.userId);
        entries.push({ id: p.id, kind: 'user', userId: p.userId, role: p.role });
      } else if (p.userGroupId) {
        entries.push({
          id: p.id,
          kind: 'group',
          name: groupNameById.get(p.userGroupId) ?? 'Group',
          role: p.role,
        });
      } else if (p.channelId) {
        entries.push({
          id: p.id,
          kind: 'channel',
          name: channelNameById.get(p.channelId) ?? 'Private channel',
          role: p.role,
        });
      }
    }
    return entries;
  }, [participants, canvas.createdBy, groupNameById, channelNameById]);

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()} title='Participants'>
      <CanvasParticipantsTray
        onClose={onClose}
        participants={formattedParticipants}
        showRole={true}
        showColor={false}
      />
    </Dialog>
  );
};

const CanvasPageSubscription: React.FC<{
  cursor: CanvasCursor | null;
  channelId?: string | undefined;
  onPageComplete: (page: Canvas[], previousPageIds: Set<string>) => void;
  onLoadingChange: (isLoading: boolean) => void;
}> = ({ cursor, channelId, onPageComplete, onLoadingChange }) => {
  const previousPageIdsRef = useRef<Set<string>>(new Set());

  const query = useMemo(() => {
    if (channelId) {
      return queries.channelCanvasesPaginated({
        channelId,
        limit: CANVAS_PAGE_SIZE,
        start: cursor,
      });
    }

    return queries.userCanvasesPaginated({
      limit: CANVAS_PAGE_SIZE,
      start: cursor,
    });
  }, [channelId, cursor]);

  const [page, pageDetails] = useCachedQuery(query as never, { cursorEnabled: true });
  const isLoading = pageDetails.type !== 'complete';

  useEffect(() => {
    onLoadingChange(isLoading);
  }, [isLoading, onLoadingChange]);

  useEffect(() => {
    if (pageDetails.type !== 'complete') return;

    const completedPage = ((page as unknown as Canvas[]) || []).slice();
    onPageComplete(completedPage, previousPageIdsRef.current);
    previousPageIdsRef.current = new Set(completedPage.map(canvas => canvas.id));
  }, [cursor, onPageComplete, page, pageDetails.type]);

  return null;
};

export const CanvasList: React.FC<CanvasListProps> = ({
  onSelect,
  onDelete,
  onDuplicate,
  currentUserId,
  activeFilter: externalActiveFilter,
  onFilterChange,
  selectedCanvasId,
  paginated = false,
  channelId,
  excludeCallGeneratedCanvases = true,
  showStarredOnly = false,
  onToggleStar,
}) => {
  const navigate = useNavigate();
  const { isMobile } = usePlatform();
  const allUserGroups = useUserGroups();
  const allVisibleChannels = useAllVisibleChannels();
  const groupNameById = useMemo(
    () => new Map(allUserGroups.map(g => [g.id, g.name])),
    [allUserGroups],
  );
  const channelNameById = useMemo(
    () => new Map(allVisibleChannels.map(c => [c.id, c.name])),
    [allVisibleChannels],
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingCanvasId, setDeletingCanvasId] = useState<string | null>(null);
  const [internalActiveFilter, setInternalActiveFilter] = useState<FilterTab>('all');
  const [shareCanvas, setShareCanvas] = useState<Canvas | null>(null);
  const [participantsTrayCanvas, setParticipantsTrayCanvas] = useState<Canvas | null>(null);
  const [canvasItems, setCanvasItems] = useState<Canvas[]>([]);
  const [pageCursor, setPageCursor] = useState<CanvasCursor | null>(null);
  const [isNextPageLoading, setIsNextPageLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const canvasVirtuosoRef = useRef<VirtuosoHandle>(null);

  const { prefetchTopCanvases, handleMouseEnter, handleMouseLeave } = useCanvasPrefetch();

  // Use external filter if provided, otherwise use internal state
  const activeFilter = externalActiveFilter ?? internalActiveFilter;

  const rawItems = canvasItems;
  const itemsWithStarState = useMemo(() => withStarredCanvasState(rawItems), [rawItems]);
  const nextCursor = useMemo(() => {
    const lastItem = rawItems[rawItems.length - 1];
    return lastItem ? { id: lastItem.id, updatedAt: lastItem.updatedAt } : null;
  }, [rawItems]);
  const isLoadingNext = isNextPageLoading;
  const isInitialLoading = paginated && rawItems.length === 0 && isLoadingNext;

  useLayoutEffect(() => {
    setCanvasItems([]);
    setPageCursor(null);
    setIsNextPageLoading(false);
    setHasMore(true);
  }, [activeFilter, channelId, paginated]);

  const applyPageToFlatList = useCallback((page: Canvas[], previousPageIds: Set<string>): void => {
    const nextPageIds = new Set(page.map(canvas => canvas.id));

    setCanvasItems(previousItems => {
      const byId = new Map(previousItems.map(canvas => [canvas.id, canvas]));

      previousPageIds.forEach(canvasId => {
        if (nextPageIds.has(canvasId)) return;
        byId.delete(canvasId);
      });

      page.forEach(canvas => {
        const existing = byId.get(canvas.id);
        if (!existing || canvas.updatedAt >= existing.updatedAt) {
          byId.set(canvas.id, canvas);
        }
      });

      return sortCanvasItems(Array.from(byId.values()));
    });
  }, []);

  const handlePageComplete = useCallback(
    (page: Canvas[], previousPageIds: Set<string>): void => {
      applyPageToFlatList(page, previousPageIds);
      setHasMore(page.length === CANVAS_PAGE_SIZE);
    },
    [applyPageToFlatList],
  );

  const handlePageLoadingChange = useCallback((isLoading: boolean): void => {
    setIsNextPageLoading(isLoading);
  }, []);

  const setActiveFilter = (filter: FilterTab): void => {
    if (onFilterChange) {
      onFilterChange(filter);
    } else {
      setInternalActiveFilter(filter);
    }
  };

  useEffect(() => {
    if (rawItems.length > 0) {
      const collaborativeCanvases = rawItems.filter(c => c.isCollaborative !== false);
      void prefetchTopCanvases(
        collaborativeCanvases.map(c => ({
          id: c.id,
          ...(c.channelId ? { channelId: c.channelId } : {}),
          ...(c.isCollaborative !== undefined ? { isCollaborative: c.isCollaborative } : {}),
          title: c.title,
        })),
        3,
      );
    }
  }, [rawItems, activeFilter, prefetchTopCanvases]);

  useEffect(() => {
    if (isMobile) return;
    const rafId = requestAnimationFrame(() => {
      searchInputRef.current?.focus({ preventScroll: true });
    });
    return (): void => cancelAnimationFrame(rafId);
  }, [activeFilter, isMobile]);

  const filteredCanvases = useMemo(() => {
    let filtered = filterExcludedCallGeneratedCanvases(
      itemsWithStarState,
      excludeCallGeneratedCanvases,
    );
    filtered = filterStarredCanvases(filtered, showStarredOnly);

    if (activeFilter === 'created_by_me' && currentUserId) {
      filtered = filtered.filter(canvas => canvas.createdBy === currentUserId);
    }

    if (searchQuery) {
      filtered = filtered.filter(canvas =>
        canvas.title.toLowerCase().includes(searchQuery.toLowerCase()),
      );
    }

    return filtered;
  }, [
    activeFilter,
    currentUserId,
    excludeCallGeneratedCanvases,
    itemsWithStarState,
    searchQuery,
    showStarredOnly,
  ]);

  // j/k keyboard navigation through canvas list
  const canvasSelectedIdx = useRef(-1);

  const navigateCanvas = useCallback(
    (delta: number) => {
      if (filteredCanvases.length === 0) return;
      const nextIdx =
        canvasSelectedIdx.current < 0
          ? delta > 0
            ? 0
            : filteredCanvases.length - 1
          : Math.max(0, Math.min(filteredCanvases.length - 1, canvasSelectedIdx.current + delta));
      canvasSelectedIdx.current = nextIdx;
      const targetId = filteredCanvases[nextIdx]?.id;
      if (!targetId) return;
      canvasVirtuosoRef.current?.scrollToIndex({ index: nextIdx, align: 'center' });
      // Navigate directly with nofocus instead of clicking (avoids auto-focus in canvas editor)
      void navigate(`/chat/canvas/${targetId}?nofocus=1`);
    },
    [filteredCanvases],
  );

  useShortcut('j', () => navigateCanvas(1), {
    scope: 'global',
    description: 'Next canvas',
    category: 'Canvas',
    enabled: !isMobile && filteredCanvases.length > 0,
  });
  useShortcut('k', () => navigateCanvas(-1), {
    scope: 'global',
    description: 'Previous canvas',
    category: 'Canvas',
    enabled: !isMobile && filteredCanvases.length > 0,
  });

  const requestNextPage = useCallback((): void => {
    if (!paginated || !hasMore || isLoadingNext || !nextCursor) {
      return;
    }

    if (getNullableCanvasCursorKey(pageCursor) === getCanvasCursorKey(nextCursor)) {
      return;
    }

    setPageCursor(nextCursor);
  }, [hasMore, isLoadingNext, nextCursor, pageCursor, paginated]);

  useEffect(() => {
    if (!paginated || !excludeCallGeneratedCanvases || isLoadingNext || !hasMore) {
      return;
    }

    if (filteredCanvases.length > 0 || rawItems.length === 0) {
      return;
    }

    requestNextPage();
  }, [
    excludeCallGeneratedCanvases,
    filteredCanvases.length,
    hasMore,
    isLoadingNext,
    paginated,
    rawItems.length,
    requestNextPage,
  ]);

  const handleVisibleRangeChanged = useCallback(
    (range: { startIndex: number; endIndex: number }): void => {
      if (!paginated || isLoadingNext || filteredCanvases.length === 0) return;

      const pageStartIndex =
        Math.floor(Math.max(0, range.endIndex) / CANVAS_PAGE_SIZE) * CANVAS_PAGE_SIZE;
      const cursorItem = filteredCanvases[pageStartIndex - 1];
      const visiblePageCursor =
        pageStartIndex === 0
          ? null
          : cursorItem
            ? {
                id: cursorItem.id,
                updatedAt: cursorItem.updatedAt,
              }
            : pageCursor;

      if (
        getNullableCanvasCursorKey(pageCursor) === getNullableCanvasCursorKey(visiblePageCursor)
      ) {
        return;
      }

      setPageCursor(visiblePageCursor);
    },
    [filteredCanvases, isLoadingNext, pageCursor, paginated],
  );

  const getUserRole = (canvas: Canvas): CanvasRole | null => {
    if (canvas.createdBy === currentUserId) {
      return CanvasRole.OWNER;
    }
    if (canvas.accessLevel) {
      return canvas.accessLevel;
    }
    const canvasWithParticipants = canvas as Canvas & {
      participants?: { userId: string; role: CanvasRole }[];
    };
    const participant = canvasWithParticipants.participants?.find(p => p.userId === currentUserId);
    return participant?.role || null;
  };

  const canPerformAction = (canvas: Canvas, action: 'delete' | 'share' | 'manage'): boolean => {
    if (action === 'delete') {
      return canvas.createdBy === currentUserId;
    }

    if (action === 'share') {
      return true;
    }

    const role = getUserRole(canvas);
    if (!role) return false;

    switch (action) {
      case 'manage':
        return role === CanvasRole.OWNER;
      default:
        return false;
    }
  };

  const renderCanvasItem = (canvas: Canvas): React.ReactNode => {
    const canvasWithParticipants = canvas as Canvas & {
      participants?: {
        id: string;
        userId?: string | null;
        userGroupId?: string | null;
        channelId?: string | null;
        role: CanvasRole;
      }[];
    };

    const accessEntries: RowAccessEntry[] = [
      { kind: 'user', key: `user:${canvas.createdBy}`, userId: canvas.createdBy },
      ...(canvasWithParticipants.participants ?? []).flatMap<RowAccessEntry>(p => {
        if (p.userId) {
          return p.userId === canvas.createdBy
            ? []
            : [{ kind: 'user', key: `user:${p.userId}`, userId: p.userId }];
        }
        if (p.userGroupId) {
          return [
            {
              kind: 'group',
              key: `group:${p.userGroupId}`,
              name: groupNameById.get(p.userGroupId) ?? 'Group',
            },
          ];
        }
        if (p.channelId) {
          return [
            {
              kind: 'channel',
              key: `channel:${p.channelId}`,
              name: channelNameById.get(p.channelId) ?? 'Private channel',
            },
          ];
        }
        return [];
      }),
    ];

    const isSelected = selectedCanvasId === canvas.id;
    const canToggleStar = !!onToggleStar;

    return (
      <div
        role='button'
        tabIndex={0}
        className={`group flex items-center px-6 py-4 transition-colors cursor-pointer border-b border-border border-l-4 ${
          isSelected ? 'border-l-foreground bg-muted' : 'border-l-transparent hover:bg-accent'
        }`}
        onClick={e => onSelect(e, canvas)}
        data-track-category='CANVAS'
        data-track-name='Open_Canvas'
        data-track-metadata={JSON.stringify({
          canvasId: canvas.id,
          title: canvas.title,
        })}
        data-testid={`canvas-item-${canvas.id}`}
        onMouseEnter={() => {
          if (canvas.isCollaborative !== false) {
            handleMouseEnter({
              id: canvas.id,
              ...(canvas.channelId ? { channelId: canvas.channelId } : {}),
              ...(canvas.isCollaborative !== undefined
                ? { isCollaborative: canvas.isCollaborative }
                : {}),
              title: canvas.title,
            });
          }
        }}
        onMouseLeave={handleMouseLeave}
        onKeyDown={(e: React.KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(e as unknown as KeyboardEvent, canvas);
          }
        }}
      >
        <div className='flex-shrink-0 mr-4'>
          <Tooltip
            content={
              canvas.visibility === CanvasVisibility.PUBLIC
                ? 'Anyone with the link can view'
                : 'Private'
            }
            side='top'
            align='start'
          >
            <div className='w-8 h-8 flex items-center justify-center rounded-full bg-muted'>
              {canvas.visibility === CanvasVisibility.PUBLIC ? (
                <Globe className='w-4 h-4 text-muted-foreground' strokeWidth={2.2} />
              ) : (
                <Lock className='w-4 h-4 text-muted-foreground' strokeWidth={2.2} />
              )}
            </div>
          </Tooltip>
        </div>

        <div className='flex-1 min-w-0'>
          <div className='flex items-center gap-2 mb-1'>
            <Tooltip
              content={canvas.title}
              side='top'
              align='start'
              delayDuration={400}
              className='max-w-xs break-words'
            >
              <h3 className='font-medium text-foreground truncate'>{canvas.title}</h3>
            </Tooltip>
          </div>

          <div className='flex items-center gap-2 text-sm text-muted-foreground min-w-0'>
            <span className='flex items-center gap-1.5 min-w-0'>
              <Avatar userId={canvas.createdBy} size='sm' />
              <span className='hidden md:inline truncate'>
                <CreatorName
                  userId={canvas.createdBy}
                  isCurrentUser={canvas.createdBy === currentUserId}
                />
              </span>
            </span>
          </div>
        </div>

        <div className='flex items-center gap-3 ml-4'>
          <Tooltip
            content={
              accessEntries.length > 0
                ? `${accessEntries.length} ${accessEntries.length === 1 ? 'participant' : 'participants'}`
                : 'View participants'
            }
            side='top'
          >
            <button
              onClick={e => {
                e.stopPropagation();
                setParticipantsTrayCanvas(canvas);
              }}
              className='cursor-pointer'
              data-track-category='CANVAS'
              data-track-name='Open_Participants_Tray'
              data-track-metadata={JSON.stringify({ canvasId: canvas.id })}
            >
              <div className='md:hidden'>
                <AccessAvatars entries={accessEntries} max={2} />
              </div>
              <div className='hidden md:block'>
                <AccessAvatars entries={accessEntries} max={3} />
              </div>
            </button>
          </Tooltip>
          {canToggleStar && (
            <Tooltip content={canvas.isStarred ? 'Unstar canvas' : 'Star canvas'} side='top'>
              <button
                onClick={e => {
                  e.stopPropagation();
                  const nextIsStarred = !canvas.isStarred;
                  setCanvasItems(items =>
                    items.map(item =>
                      updateOptimisticStarState(item, canvas.id, currentUserId, nextIsStarred),
                    ),
                  );
                  toast.success(nextIsStarred ? 'Added to starred' : 'Removed from starred');
                  onToggleStar?.(canvas);
                }}
                className='p-1.5 rounded hover:bg-accent'
                data-track-category='CANVAS'
                data-track-name='TOGGLE_CANVAS_STAR'
                data-track-metadata={JSON.stringify({
                  canvasId: canvas.id,
                  isStarred: canvas.isStarred,
                })}
              >
                <Star
                  className={`w-4 h-4 ${
                    canvas.isStarred ? 'fill-yellow-400 text-yellow-500' : 'text-muted-foreground'
                  }`}
                  strokeWidth={2.2}
                />
              </button>
            </Tooltip>
          )}

          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                onClick={e => e.stopPropagation()}
                className='p-1.5 rounded hover:bg-accent'
                data-track-category='CANVAS'
                data-track-name='Open_Canvas_Menu'
                data-track-metadata={JSON.stringify({ canvasId: canvas.id })}
              >
                <MoreVertical className='w-4 h-4 text-muted-foreground' strokeWidth={2.5} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-48'>
              {onDuplicate && (
                <DropdownMenuItem
                  onClick={e => {
                    e.stopPropagation();
                    onDuplicate(canvas.id, canvas);
                  }}
                  className='flex items-center gap-2 cursor-pointer'
                  data-track-category='CANVAS'
                  data-track-name='Duplicate_Canvas'
                  data-track-metadata={JSON.stringify({
                    canvasId: canvas.id,
                    title: canvas.title,
                  })}
                >
                  <Copy className='w-4 h-4' />
                  Duplicate
                </DropdownMenuItem>
              )}

              {canPerformAction(canvas, 'share') && (
                <DropdownMenuItem
                  onClick={e => {
                    e.stopPropagation();
                    setShareCanvas(canvas);
                  }}
                  className='flex items-center gap-2 cursor-pointer'
                  data-track-category='CANVAS'
                  data-track-name='Share_Canvas'
                  data-track-metadata={JSON.stringify({
                    canvasId: canvas.id,
                    title: canvas.title,
                  })}
                >
                  <Share2 className='w-4 h-4' />
                  Share
                </DropdownMenuItem>
              )}

              {onDelete && canPerformAction(canvas, 'delete') && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={e => {
                      e.stopPropagation();
                      setDeletingCanvasId(canvas.id);
                    }}
                    className='flex items-center gap-2 cursor-pointer text-red-600 focus:text-red-600 focus:bg-red-50'
                    data-testid='canvas-delete-button'
                    data-track-category='CANVAS'
                    data-track-name='DELETE_CANVAS'
                    data-track-metadata={JSON.stringify({ canvasId: canvas.id })}
                  >
                    <Trash2 className='w-4 h-4' />
                    Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    );
  };

  return (
    <div className='flex flex-col h-full bg-background' data-testid='canvas-list'>
      {paginated && (
        <CanvasPageSubscription
          key={`${channelId ?? 'user'}:${activeFilter}:${
            pageCursor ? getCanvasCursorKey(pageCursor) : 'first-page'
          }`}
          cursor={pageCursor}
          channelId={channelId}
          onPageComplete={handlePageComplete}
          onLoadingChange={handlePageLoadingChange}
        />
      )}

      <div className='px-4 md:px-6 py-4 border-b border-border'>
        <div className='flex flex-col gap-3'>
          <div className='relative w-full'>
            <Search className='absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground' />
            <Input
              ref={searchInputRef}
              type='text'
              value={searchQuery}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
              placeholder='Search Document'
              className='pl-9 w-full'
            />
          </div>

          <div className='flex items-center gap-2'>
            <button
              onClick={() => setActiveFilter('all')}
              className={`px-3 md:px-4 py-1.5 md:py-2 text-sm font-medium rounded-full transition-all whitespace-nowrap ${
                activeFilter === 'all'
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-accent'
              }`}
              data-testid='canvas-filter-all'
              data-track-category='CANVAS'
              data-track-name='FILTER_ALL'
              data-track-metadata={JSON.stringify({ filter: 'all', canvasCount: rawItems.length })}
            >
              All
            </button>
            <button
              onClick={() => setActiveFilter('created_by_me')}
              className={`px-3 md:px-4 py-1.5 md:py-2 text-sm font-medium rounded-full transition-all whitespace-nowrap ${
                activeFilter === 'created_by_me'
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-accent'
              }`}
              data-testid='canvas-filter-created-by-me'
              data-track-category='CANVAS'
              data-track-name='FILTER_CREATED_BY_ME'
              data-track-metadata={JSON.stringify({ filter: 'created_by_me' })}
            >
              Created by me
            </button>
          </div>
        </div>
      </div>

      <div className='flex-1 min-h-0'>
        {isInitialLoading ? (
          <div className='flex items-center justify-center h-64'>
            <div className='animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600'></div>
          </div>
        ) : filteredCanvases.length === 0 ? (
          <div className='flex flex-col items-center justify-center h-full text-center py-16'>
            <FileText className='w-16 h-16 text-muted-foreground mb-4' />
            <h3 className='text-lg font-medium text-foreground mb-2'>
              {searchQuery
                ? 'No canvases found'
                : showStarredOnly
                  ? 'No starred canvases yet'
                  : 'No canvases yet'}
            </h3>
            <p className='text-muted-foreground text-sm'>
              {searchQuery
                ? 'Try adjusting your search'
                : showStarredOnly
                  ? 'Star a canvas to see it here.'
                  : 'Create your first canvas to get started'}
            </p>
          </div>
        ) : (
          <Virtuoso
            ref={canvasVirtuosoRef}
            key={`${channelId ?? 'user'}:${activeFilter}`}
            className='h-full'
            data={filteredCanvases}
            computeItemKey={(_index, canvas) => canvas.id}
            endReached={requestNextPage}
            rangeChanged={handleVisibleRangeChanged}
            itemContent={(_index, canvas) => renderCanvasItem(canvas)}
            components={{
              Footer: () =>
                isLoadingNext ? (
                  <div className='flex items-center justify-center py-4'>
                    <div className='animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600' />
                  </div>
                ) : null,
            }}
          />
        )}
      </div>

      <Dialog
        open={!!deletingCanvasId}
        onOpenChange={open => !open && setDeletingCanvasId(null)}
        title='Delete Canvas'
      >
        <CanvasDeleteModal
          onClose={() => setDeletingCanvasId(null)}
          onConfirm={() => {
            if (deletingCanvasId && onDelete) {
              onDelete(deletingCanvasId);
              setDeletingCanvasId(null);
            }
          }}
          canvasTitle={rawItems.find(c => c.id === deletingCanvasId)?.title}
        />
      </Dialog>

      {shareCanvas && (
        <Dialog
          open={!!shareCanvas}
          onOpenChange={open => !open && setShareCanvas(null)}
          title='Share Canvas'
        >
          <CanvasShareModal
            key={shareCanvas.id}
            onClose={() => setShareCanvas(null)}
            canvas={shareCanvas}
            isOwner={shareCanvas.createdBy === currentUserId}
            isEditor={shareCanvas.accessLevel === CanvasRole.EDITOR}
            participants={
              (shareCanvas as Canvas & { participants?: CanvasParticipant[] }).participants
            }
            {...(shareCanvas.channelId && { channelId: shareCanvas.channelId })}
          />
        </Dialog>
      )}

      {participantsTrayCanvas && (
        <ParticipantsTray
          isOpen={!!participantsTrayCanvas}
          onClose={() => setParticipantsTrayCanvas(null)}
          canvas={participantsTrayCanvas}
        />
      )}
    </div>
  );
};
