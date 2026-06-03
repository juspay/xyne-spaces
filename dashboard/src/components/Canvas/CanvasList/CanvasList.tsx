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
  BookMarked,
  ExternalLink,
  Check,
} from 'lucide-react';
import { CanvasListProps, Canvas, CanvasParticipant } from '../Canvas.types';
import { CanvasRole, CanvasVisibility, DocType } from '@xyne/shared';
import Avatar from '../../ui/Avatar/Avatar';
import AvatarGroup from '../../ui/Avatar/AvatarGroup';
import Input from '../../ui/Input';
import { Dialog } from '../../ui/Dialog';
import { UserHoverWrapper } from '../../ui/UserMentionPopover/UserMentionPopover';
import { useUser } from '../../../hooks/useUsers';
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
import { useShareableOrigin } from '../../../hooks/useShareableOrigin';
import { useCanvasPrefetch } from '../../../hooks/useCanvasPrefetch';
import { useCachedQuery } from '@xyne/shared/hooks';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { useShortcut } from '../../../shortcuts';
import { openQuartoDoc } from '../openQuartoDoc';
import { filterExcludedCallGeneratedCanvases } from '../canvasFilters';

type FilterTab = 'all' | 'created_by_me' | 'quarto_docs';
type CanvasCursor = { id: string; updatedAt: number };

const CANVAS_PAGE_SIZE = 25;

const getCanvasCursorKey = (cursor: CanvasCursor): string => `${cursor.updatedAt}:${cursor.id}`;

const getNullableCanvasCursorKey = (cursor: CanvasCursor | null): string =>
  cursor ? getCanvasCursorKey(cursor) : 'first-page';

const sortCanvasItems = (items: Canvas[]): Canvas[] =>
  [...items].sort((a, b) => b.updatedAt - a.updatedAt || b.id.localeCompare(a.id));

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
  canvasId: string;
}> = ({ isOpen, onClose, canvasId }) => {
  const [participants] = useCachedQuery(queries.canvasParticipants({ canvasId }));

  const formattedParticipants: ParticipantItem[] = useMemo(() => {
    if (!participants) return [];

    return participants.reduce<ParticipantItem[]>((acc, p) => {
      if (!p.userId) return acc;
      acc.push({
        id: p.id,
        userId: p.userId,
        role: p.role,
      });
      return acc;
    }, []);
  }, [participants]);

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
  activeFilter: FilterTab;
  channelId?: string | undefined;
  onPageComplete: (page: Canvas[], previousPageIds: Set<string>) => void;
  onLoadingChange: (isLoading: boolean) => void;
}> = ({ cursor, activeFilter, channelId, onPageComplete, onLoadingChange }) => {
  const previousPageIdsRef = useRef<Set<string>>(new Set());

  const query = useMemo(() => {
    if (activeFilter === 'quarto_docs') {
      if (channelId) {
        return queries.channelQuartoDocsPaginated({
          channelId,
          limit: CANVAS_PAGE_SIZE,
          start: cursor,
        });
      }

      return queries.userQuartoDocsPaginated({
        limit: CANVAS_PAGE_SIZE,
        start: cursor,
      });
    }

    if (channelId) {
      return queries.channelCanvasesPaginated({
        channelId,
        limit: CANVAS_PAGE_SIZE,
        start: cursor,
      });
    }

    return queries.userCanvasesPaginated({
      includeQuartoDocs: false,
      limit: CANVAS_PAGE_SIZE,
      start: cursor,
    });
  }, [activeFilter, channelId, cursor]);

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
  showQuartoDocsFilter = false,
  activeFilter: externalActiveFilter,
  onFilterChange,
  selectedCanvasId,
  paginated = false,
  channelId,
  excludeCallGeneratedCanvases = true,
}) => {
  const navigate = useNavigate();
  const shareableOrigin = useShareableOrigin();
  const { isMobile } = usePlatform();
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
  const isQuartoDocs = activeFilter === 'quarto_docs';

  const rawItems = canvasItems;
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
    if (rawItems.length > 0 && activeFilter !== 'quarto_docs') {
      const collaborativeCanvases = rawItems.filter(c => c.isCollaborative !== false);
      void prefetchTopCanvases(
        collaborativeCanvases.map(c => ({
          id: c.id,
          ...(c.channelId ? { channelId: c.channelId } : {}),
          ...(c.viewAccessId ? { viewAccessId: c.viewAccessId } : {}),
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
    // If showing Quarto docs filter, return Quarto docs when that filter is active
    if (isQuartoDocs) {
      let filtered = rawItems;
      if (searchQuery) {
        filtered = filtered.filter(
          canvas =>
            canvas.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (canvas.userRepo?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false),
        );
      }
      return filtered;
    }

    let filtered = filterExcludedCallGeneratedCanvases(rawItems, excludeCallGeneratedCanvases);

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
    isQuartoDocs,
    rawItems,
    searchQuery,
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
    if (!paginated || !excludeCallGeneratedCanvases || isQuartoDocs || isLoadingNext || !hasMore) {
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
    isQuartoDocs,
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

  const handleQuartoDocClick = (e: React.MouseEvent | KeyboardEvent, canvas: Canvas): void => {
    openQuartoDoc(e, canvas, navigate, isMobile);
  };

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
      participants?: { userId: string; role: CanvasRole }[];
    };

    const participantUserIds = [
      canvas.createdBy,
      ...(canvasWithParticipants.participants
        ?.map(p => p.userId)
        .filter(id => id !== canvas.createdBy) || []),
    ];

    const isQuartoDoc = canvas.docType === DocType.Quarto;

    const isSelected = selectedCanvasId === canvas.id;

    return (
      <div
        role='button'
        tabIndex={0}
        className={`group flex items-center px-6 py-4 transition-colors cursor-pointer border-b border-border ${
          isSelected ? 'bg-accent' : 'hover:bg-accent'
        }`}
        onClick={e => (isQuartoDoc ? handleQuartoDocClick(e, canvas) : onSelect(e, canvas))}
        data-track-category='CANVAS'
        data-track-name={isQuartoDoc ? 'Open_Quarto_Doc' : 'Open_Canvas'}
        data-track-metadata={JSON.stringify({
          canvasId: canvas.id,
          title: canvas.title,
          isQuartoDoc,
        })}
        data-testid={`canvas-item-${canvas.id}`}
        onMouseEnter={() => {
          if (!isQuartoDoc && canvas.isCollaborative !== false) {
            handleMouseEnter({
              id: canvas.id,
              ...(canvas.channelId ? { channelId: canvas.channelId } : {}),
              ...(canvas.viewAccessId ? { viewAccessId: canvas.viewAccessId } : {}),
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
            if (isQuartoDoc) {
              handleQuartoDocClick(e as unknown as KeyboardEvent, canvas);
            } else {
              onSelect(e as unknown as KeyboardEvent, canvas);
            }
          }
        }}
      >
        <div className='flex-shrink-0 mr-4'>
          <div
            className={`w-8 h-8 flex items-center justify-center rounded ${
              isQuartoDoc ? 'bg-blue-50' : 'bg-muted'
            }`}
          >
            {isQuartoDoc ? (
              <BookMarked className='w-4 h-4 text-blue-500' strokeWidth={2.5} />
            ) : (
              <FileText className='w-4 h-4 text-muted-foreground' strokeWidth={2.5} />
            )}
          </div>
        </div>

        <div className='flex-1 min-w-0'>
          <div className='flex items-center gap-2 mb-1'>
            <h3 className='font-medium text-foreground truncate' title={canvas.title}>
              {canvas.title}
            </h3>
            {isQuartoDoc && canvas.quartoDocumentType && canvas.quartoDocumentType !== 'docs' && (
              <span className='px-2 py-0.5 text-xs font-medium rounded-full bg-muted text-muted-foreground'>
                {canvas.quartoDocumentType}
              </span>
            )}
          </div>

          <div className='flex flex-wrap items-center gap-3 text-sm text-muted-foreground'>
            <UserHoverWrapper userId={canvas.createdBy}>
              <span className='flex items-center gap-1.5 cursor-pointer'>
                <Avatar userId={canvas.createdBy} size='sm' />
                <span className='hidden md:inline'>
                  <CreatorName
                    userId={canvas.createdBy}
                    isCurrentUser={canvas.createdBy === currentUserId}
                  />
                </span>
              </span>
            </UserHoverWrapper>

            <span className='text-muted-foreground'>|</span>

            {isQuartoDoc && canvas.userRepo ? (
              <span
                className='flex items-center gap-1 text-xs truncate max-w-[200px]'
                title={canvas.userRepo}
              >
                <ExternalLink className='w-3 h-3' />
                {canvas.userRepo}
              </span>
            ) : (
              <span
                className='flex items-center'
                aria-label={
                  canvas.visibility === CanvasVisibility.PUBLIC ? 'Public canvas' : 'Private canvas'
                }
                title={canvas.visibility === CanvasVisibility.PUBLIC ? 'Public' : 'Private'}
              >
                {canvas.visibility === CanvasVisibility.PUBLIC ? (
                  <Globe className='w-3.5 h-3.5 text-green-500' strokeWidth={2.5} />
                ) : (
                  <Lock className='w-3.5 h-3.5 text-muted-foreground' strokeWidth={2.5} />
                )}
              </span>
            )}
          </div>
        </div>

        <div className='flex items-center gap-3 ml-4'>
          {isSelected && (
            <div className='flex-shrink-0 w-5 h-5 rounded-full bg-primary flex items-center justify-center'>
              <Check className='w-3 h-3 text-primary-foreground' strokeWidth={3} />
            </div>
          )}
          {!isQuartoDoc && (
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
                <AvatarGroup userIds={participantUserIds} size='sm' count={2} />
              </div>
              <div className='hidden md:block'>
                <AvatarGroup userIds={participantUserIds} size='sm' count={3} />
              </div>
            </button>
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
              {!isQuartoDoc && onDuplicate && (
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
                    if (isQuartoDoc && canvas.userRepo) {
                      // For Quarto docs, copy the docs link directly
                      const docsLink = `${shareableOrigin}/docs/${canvas.userRepo}`;
                      void navigator.clipboard.writeText(docsLink);
                    } else {
                      setShareCanvas(canvas);
                    }
                  }}
                  className='flex items-center gap-2 cursor-pointer'
                  data-track-category='CANVAS'
                  data-track-name={isQuartoDoc ? 'Copy_Quarto_Doc_Link' : 'Share_Canvas'}
                  data-track-metadata={JSON.stringify({
                    canvasId: canvas.id,
                    title: canvas.title,
                    isQuartoDoc,
                  })}
                >
                  <Share2 className='w-4 h-4' />
                  {isQuartoDoc ? 'Copy Link' : 'Share'}
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
          activeFilter={activeFilter}
          channelId={channelId}
          onPageComplete={handlePageComplete}
          onLoadingChange={handlePageLoadingChange}
        />
      )}

      <div className='px-4 md:px-6 py-4 border-b border-border'>
        <div className='flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0'>
          <div className='flex items-center gap-2'>
            <button
              onClick={() => setActiveFilter('all')}
              className={`px-3 md:px-4 py-1.5 md:py-2 text-sm font-medium rounded-full transition-all ${
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
              className={`px-3 md:px-4 py-1.5 md:py-2 text-sm font-medium rounded-full transition-all ${
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
            {showQuartoDocsFilter && (
              <button
                onClick={() => setActiveFilter('quarto_docs')}
                className={`px-3 md:px-4 py-1.5 md:py-2 text-sm font-medium rounded-full transition-all flex items-center gap-1.5 ${
                  activeFilter === 'quarto_docs'
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-muted-foreground hover:bg-accent'
                }`}
                data-testid='canvas-filter-quarto-docs'
                data-track-category='CANVAS'
                data-track-name='FILTER_QUARTO_DOCS'
                data-track-metadata={JSON.stringify({
                  filter: 'quarto_docs',
                  quartoCount: isQuartoDocs ? rawItems.length : 0,
                })}
              >
                <BookMarked className='w-3.5 h-3.5' />
                Docs
              </button>
            )}
          </div>

          <div className='relative w-full sm:w-auto'>
            <Search className='absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground' />
            <Input
              ref={searchInputRef}
              type='text'
              value={searchQuery}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
              placeholder='Search Document'
              className='pl-9 w-full sm:w-48 md:w-64'
            />
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
              {searchQuery ? 'No canvases found' : 'No docs yet'}
            </h3>
            <p className='text-muted-foreground text-sm'>
              {searchQuery
                ? 'Try adjusting your search'
                : 'Publish your first doc from the Xyne Code extension'}
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
          canvasId={participantsTrayCanvas.id}
        />
      )}
    </div>
  );
};
