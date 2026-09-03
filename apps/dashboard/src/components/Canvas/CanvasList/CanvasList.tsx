import React, { useState, useMemo, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import { differenceInCalendarDays } from 'date-fns';
import {
  FileText,
  Trash2,
  Copy,
  Search,
  MoreVertical,
  Archive,
  ArchiveRestore,
  Globe,
  Lock,
  Star,
  Tag,
  X,
  ChevronDown,
  ExternalLink,
  ChevronRight,
  AtSign,
  Check,
  Hash,
  ChevronLeft,
  Folder,
  Layers,
  Bot,
} from 'lucide-react';
import {
  CanvasListProps,
  Canvas,
  type CanvasFolder,
  type CanvasParticipant,
} from '../Canvas.types';
import { CanvasVisibility, ChannelScopeType, type User } from '@xyne/shared';
import Input from '../../ui/Input';
import { Tooltip } from '../../ui/Tooltip/Tooltip';
import { Dialog } from '../../ui/Dialog';
import { searchUsers, useActiveUsers, useUsers } from '../../../hooks/useUsers';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import { CanvasDeleteModal } from '../CanvasDeleteModal';
import { usePlatform } from '../../../hooks/usePlatform';
import { useAllVisibleChannels } from '../../../hooks/useChannels';
import { queries } from '../../../zero/queries';
import { useNavigate } from 'react-router-dom';
import { useCanvasPrefetch } from '../../../hooks/useCanvasPrefetch';
import { useCachedQuery } from '@xyne/shared/hooks';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { useShortcut } from '../../../shortcuts';
import { toast } from 'sonner';
import {
  filterArchivedCanvases,
  filterExcludedCallGeneratedCanvases,
  filterExcludedRecordingGeneratedCanvases,
  filterStarredCanvases,
  isAnyCallGeneratedCanvas,
  isExcludedRecordingGeneratedCanvas,
  withStarredCanvasState,
} from '../canvasFilters';
import { cn } from '../../../utils/classNames';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { getAvatarColorClassNames } from '../../ui/Avatar/Avatar';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { canvasMatchesSharedByFilter } from '../canvasListFilters';

type FilterTab = 'all' | 'created_by_me' | 'shared';
type CanvasCursor = { id: string; updatedAt: number };
type CanvasMetadataLabel = { name: string; color?: string };
type CanvasSearchScope = 'direct' | 'via_channel' | 'all';
type CanvasSearchScopeMenuView = 'main' | 'channels';
type CanvasFolderGroup = { folder: CanvasFolder };
type CanvasEmptyStateCopy = {
  title: string;
  description: string;
};
type ChannelSourcePaginationState = {
  cursor: CanvasCursor | null;
  nextCursor: CanvasCursor | null;
  hasMore: boolean;
  isLoading: boolean;
};

type CanvasCardMenuItem = {
  key: string;
  label: string;
  icon: React.ReactNode;
  onSelect?: () => void;
  variant?: 'default' | 'destructive';
  disabled?: boolean;
  separatorBefore?: boolean;
  submenu?: CanvasCardMenuItem[];
  testId?: string;
  trackName?: string;
  trackMetadata?: Record<string, unknown>;
};

const CANVAS_PAGE_SIZE = 25;
const CANVAS_FILTERED_PAGE_SIZE = 200;
const CANVAS_FILTERED_AUTO_PAGINATION_THRESHOLD = 8;
const CANVAS_LABEL_COLORS = [
  'bg-emerald-500',
  'bg-sky-500',
  'bg-violet-500',
  'bg-amber-600',
  'bg-rose-500',
  'bg-indigo-500',
];
const DEFAULT_CANVAS_LABEL_COLOR = 'bg-emerald-500';
const MONTH_SECTION_FORMATTER = new Intl.DateTimeFormat(undefined, { month: 'long' });
const WEEKDAY_FORMATTER = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const LONG_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const getCanvasActivityTime = (canvas: Canvas): number =>
  canvas.lastEditedAt ?? canvas.updatedAt ?? canvas.createdAt;

const getCanvasDateSection = (canvas: Canvas): string => {
  const activityTime = getCanvasActivityTime(canvas);
  const activityDate = new Date(activityTime);
  const diffDays = differenceInCalendarDays(new Date(), activityDate);

  if (diffDays <= 0) return 'Today';
  if (diffDays <= 7) return 'Previous 7 days';
  if (diffDays <= 30) return 'Previous 30 days';
  return MONTH_SECTION_FORMATTER.format(activityDate);
};

const getDayDifference = (timestamp: number): number => {
  return differenceInCalendarDays(new Date(), new Date(timestamp));
};

const formatCanvasEditedTime = (timestamp: number): string => {
  const now = Date.now();
  const diffMs = Math.max(0, now - timestamp);
  const diffMinutes = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = getDayDifference(timestamp);

  if (diffMinutes < 1) return 'just now';
  if (diffHours < 1) return `${diffMinutes}m ago`;
  if (diffDays <= 0) return `${diffHours}h ago`;
  if (diffDays <= 7) return WEEKDAY_FORMATTER.format(new Date(timestamp));

  const date = new Date(timestamp);
  return date.getFullYear() === new Date().getFullYear()
    ? SHORT_DATE_FORMATTER.format(date)
    : LONG_DATE_FORMATTER.format(date);
};

const getInitials = (name: string | undefined): string => {
  const normalized = name?.trim();
  if (!normalized) return '?';
  const parts = normalized.split(/\s+/).filter(Boolean);
  const initials =
    parts.length > 1 ? `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}` : parts[0]?.[0];
  return (initials || '?').toUpperCase();
};

const normalizeLabelName = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const getCanvasLabels = (canvas: Canvas): CanvasMetadataLabel[] => {
  const metadata = canvas.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return [];

  const labelsValue = (metadata as Record<string, unknown>)['labels'];
  const tagsValue = (metadata as Record<string, unknown>)['tags'];
  const rawLabels = Array.isArray(labelsValue)
    ? labelsValue
    : Array.isArray(tagsValue)
      ? tagsValue
      : [];

  return rawLabels
    .map((label): CanvasMetadataLabel | null => {
      const name =
        normalizeLabelName(label) ??
        (label && typeof label === 'object' && !Array.isArray(label)
          ? normalizeLabelName((label as Record<string, unknown>)['name'])
          : null);
      if (!name) return null;

      const color =
        label && typeof label === 'object' && !Array.isArray(label)
          ? normalizeLabelName((label as Record<string, unknown>)['color'])
          : null;
      return color ? { name, color } : { name };
    })
    .filter((label): label is CanvasMetadataLabel => Boolean(label))
    .slice(0, 3);
};

const getLabelDotClassName = (label: CanvasMetadataLabel, index: number): string => {
  if (label.color?.startsWith('bg-')) return label.color;
  return CANVAS_LABEL_COLORS[index % CANVAS_LABEL_COLORS.length] ?? DEFAULT_CANVAS_LABEL_COLOR;
};

const getUserBadgeClassName = (userId: string): string => {
  const colorClass = getAvatarColorClassNames(userId);
  return `${colorClass.bg} ${colorClass.text}`;
};

const getCanvasEmptyStateCopy = ({
  searchQuery,
  showStarredOnly,
  activeFilter,
  selectedLabel,
  selectedSearchScope,
  selectedScopeChannelId,
  selectedScopeChannelLabel,
  selectedSharedByUserName,
}: {
  searchQuery: string;
  showStarredOnly: boolean;
  activeFilter: FilterTab;
  selectedLabel: string | null;
  selectedSearchScope: CanvasSearchScope;
  selectedScopeChannelId: string | null;
  selectedScopeChannelLabel: string;
  selectedSharedByUserName?: string | undefined;
}): CanvasEmptyStateCopy => {
  if (searchQuery.trim()) {
    return {
      title: 'No canvases found',
      description: 'Try adjusting your search',
    };
  }

  if (showStarredOnly) {
    return {
      title: 'No starred canvases yet',
      description: 'Star a canvas to see it here.',
    };
  }

  if (selectedLabel) {
    return {
      title: `No canvases tagged ${selectedLabel}`,
      description: 'Try a different label or clear the label filter.',
    };
  }

  if (activeFilter === 'created_by_me') {
    return {
      title: "You haven't created any canvases yet",
      description: 'Create your first canvas to get started.',
    };
  }

  if (activeFilter === 'shared' && selectedSharedByUserName) {
    return {
      title: `No canvases shared by ${selectedSharedByUserName}`,
      description: 'Try another person or clear the shared-by filter.',
    };
  }

  if (selectedSearchScope === 'direct') {
    return {
      title: 'No canvases shared directly with you yet',
      description: 'Directly shared canvases will appear here.',
    };
  }

  if (selectedSearchScope === 'via_channel') {
    if (!selectedScopeChannelId) {
      return {
        title: 'No canvases shared via channels yet',
        description: 'Canvases shared through channels will appear here.',
      };
    }

    return {
      title: `No canvases shared via #${selectedScopeChannelLabel}`,
      description: 'Canvases shared through that channel will appear here.',
    };
  }

  return {
    title: 'No canvases found',
    description: 'Try changing the current filters.',
  };
};

const canvasMatchesChannelScope = (canvas: Canvas, channelId?: string | null): boolean => {
  const canvasWithParticipants = canvas as Canvas & {
    participants?: Pick<CanvasParticipant, 'channelId'>[];
  };
  const participantChannelIds =
    canvasWithParticipants.participants
      ?.map(participant => participant.channelId)
      .filter((id): id is string => Boolean(id)) ?? [];

  if (channelId) {
    return canvas.channelId === channelId || participantChannelIds.includes(channelId);
  }

  return Boolean(canvas.channelId) || participantChannelIds.length > 0;
};

const canvasMatchesDirectScope = (canvas: Canvas, currentUserId?: string): boolean => {
  if (!currentUserId || canvasMatchesChannelScope(canvas)) return false;
  if (canvas.createdBy === currentUserId) return false;

  const canvasWithParticipants = canvas as Canvas & {
    participants?: Pick<CanvasParticipant, 'userId' | 'userGroupId'>[];
  };

  const hasDirectParticipant =
    canvasWithParticipants.participants?.some(
      participant => participant.userId === currentUserId || Boolean(participant.userGroupId),
    ) ?? false;

  if (hasDirectParticipant || Boolean(canvas.accessLevel)) return true;

  return canvas.visibility !== CanvasVisibility.PUBLIC;
};

const canvasMatchesOwnedDirectScope = (canvas: Canvas, currentUserId?: string): boolean =>
  Boolean(currentUserId) &&
  canvas.createdBy === currentUserId &&
  canvas.visibility !== CanvasVisibility.PUBLIC &&
  !canvasMatchesChannelScope(canvas);

const canvasMatchesTabAndScope = ({
  canvas,
  activeFilter,
  currentUserId,
  searchScope,
  selectedScopeChannelId,
  selectedSharedByUserId,
}: {
  canvas: Canvas;
  activeFilter: FilterTab;
  currentUserId: string | undefined;
  searchScope: CanvasSearchScope;
  selectedScopeChannelId: string | null;
  selectedSharedByUserId: string | null;
}): boolean => {
  const isMine = Boolean(currentUserId) && canvas.createdBy === currentUserId;
  const isOwnedDirect = canvasMatchesOwnedDirectScope(canvas, currentUserId);
  const isSharedBySelection = canvasMatchesSharedByFilter({
    canvas,
    currentUserId,
    selectedSharedByUserId,
  });

  if (searchScope === 'direct') {
    const matchesDirect = canvasMatchesDirectScope(canvas, currentUserId);
    if (activeFilter === 'created_by_me') return isOwnedDirect;
    if (activeFilter === 'shared') return matchesDirect && isSharedBySelection;
    return isOwnedDirect || matchesDirect;
  }

  if (searchScope === 'via_channel') {
    const matchesChannel = canvasMatchesChannelScope(canvas, selectedScopeChannelId);
    if (!matchesChannel) return false;
    if (activeFilter === 'created_by_me') return isMine;
    if (activeFilter === 'shared') return isSharedBySelection;
    return true;
  }

  if (activeFilter === 'created_by_me') return isMine;
  if (activeFilter === 'shared') return isSharedBySelection;
  return true;
};

const getCanvasCardMenuItemClassName = (
  variant: CanvasCardMenuItem['variant'] = 'default',
): string =>
  cn(
    'h-8 cursor-pointer gap-2.5 rounded-md px-2.5 text-[13px] font-normal leading-none focus:bg-sidebar-accent',
    variant === 'destructive' && 'text-red-600 focus:bg-red-50 focus:text-red-600',
  );

const renderCanvasCardMenuItem = (item: CanvasCardMenuItem): React.ReactNode => {
  const trackAttributes = item.trackName
    ? {
        'data-track-category': 'CANVAS',
        'data-track-name': item.trackName,
        ...(item.testId ? { 'data-testid': item.testId } : {}),
        ...(item.trackMetadata
          ? { 'data-track-metadata': JSON.stringify(item.trackMetadata) }
          : {}),
      }
    : item.testId
      ? { 'data-testid': item.testId }
      : {};

  const content = (
    <>
      <span className='flex size-3.5 shrink-0 items-center justify-center'>{item.icon}</span>
      <span className='min-w-0 flex-1 truncate'>{item.label}</span>
    </>
  );

  const menuRow = item.submenu?.length ? (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger
        disabled={item.disabled === true}
        className={getCanvasCardMenuItemClassName(item.variant)}
        {...trackAttributes}
      >
        {content}
        <ChevronRight className='size-3.5 shrink-0 text-muted-foreground' strokeWidth={2.2} />
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className='w-[168px] rounded-lg border-sidebar-border bg-popover p-1 shadow-xl'>
        {item.submenu.map(renderCanvasCardMenuItem)}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  ) : (
    <DropdownMenuItem
      disabled={item.disabled === true}
      onSelect={() => item.onSelect?.()}
      className={getCanvasCardMenuItemClassName(item.variant)}
      {...trackAttributes}
    >
      {content}
    </DropdownMenuItem>
  );

  return (
    <React.Fragment key={item.key}>
      {item.separatorBefore ? <DropdownMenuSeparator className='mx-2 my-1' /> : null}
      {menuRow}
    </React.Fragment>
  );
};

const getCanvasCursorKey = (cursor: CanvasCursor): string => `${cursor.updatedAt}:${cursor.id}`;

const getNullableCanvasCursorKey = (cursor: CanvasCursor | null): string =>
  cursor ? getCanvasCursorKey(cursor) : 'first-page';

const getCanvasCursorFromLastItem = (items: Canvas[]): CanvasCursor | null => {
  const lastItem = items[items.length - 1];
  return lastItem ? { id: lastItem.id, updatedAt: lastItem.updatedAt } : null;
};

const getDefaultChannelSourceState = (): ChannelSourcePaginationState => ({
  cursor: null,
  nextCursor: null,
  hasMore: true,
  isLoading: false,
});

const sortCanvasItems = (items: Canvas[]): Canvas[] =>
  [...items].sort((a, b) => b.updatedAt - a.updatedAt || b.id.localeCompare(a.id));

const mergeCanvasItems = (...groups: Canvas[][]): Canvas[] => {
  const byId = new Map<string, Canvas>();
  groups.flat().forEach(canvas => {
    const existing = byId.get(canvas.id);
    if (!existing || canvas.updatedAt >= existing.updatedAt) {
      byId.set(canvas.id, canvas);
    }
  });
  return sortCanvasItems(Array.from(byId.values()));
};

const areCanvasItemListsEqual = (left: Canvas[], right: Canvas[]): boolean =>
  left.length === right.length &&
  left.every((canvas, index) => {
    const nextCanvas = right[index];
    return (
      nextCanvas?.id === canvas.id &&
      nextCanvas.updatedAt === canvas.updatedAt &&
      nextCanvas.isStarred === canvas.isStarred
    );
  });

const toCanvasArray = <T,>(value: unknown): T[] => (value as T[] | undefined) ?? [];

const getFilteredCanvasItems = ({
  canvases,
  onlyCallGeneratedCanvases,
  excludeCallGeneratedCanvases,
  excludeRecordingGeneratedCanvases,
  onlyRecordingGeneratedCanvases,
  showStarredOnly,
  activeFilter,
  currentUserId,
  searchScope,
  selectedScopeChannelId,
  selectedSharedByUserId,
  selectedLabel,
  searchQuery,
  filterSearchQuery = true,
}: {
  canvases: Canvas[];
  onlyCallGeneratedCanvases: boolean;
  excludeCallGeneratedCanvases: boolean;
  excludeRecordingGeneratedCanvases: boolean;
  onlyRecordingGeneratedCanvases: boolean;
  showStarredOnly: boolean;
  activeFilter: FilterTab;
  currentUserId?: string | undefined;
  searchScope: CanvasSearchScope;
  selectedScopeChannelId: string | null;
  selectedSharedByUserId: string | null;
  selectedLabel: string | null;
  searchQuery: string;
  filterSearchQuery?: boolean;
}): Canvas[] => {
  let filtered = onlyCallGeneratedCanvases
    ? canvases.filter(isAnyCallGeneratedCanvas)
    : onlyRecordingGeneratedCanvases
      ? canvases.filter(isExcludedRecordingGeneratedCanvas)
      : filterExcludedRecordingGeneratedCanvases(
          filterExcludedCallGeneratedCanvases(canvases, excludeCallGeneratedCanvases),
          excludeRecordingGeneratedCanvases,
        );
  filtered = filterStarredCanvases(filtered, showStarredOnly);

  filtered = filtered.filter(canvas =>
    canvasMatchesTabAndScope({
      canvas,
      activeFilter,
      currentUserId,
      searchScope,
      selectedScopeChannelId,
      selectedSharedByUserId,
    }),
  );

  if (selectedLabel) {
    filtered = filtered.filter(canvas =>
      getCanvasLabels(canvas).some(label => label.name === selectedLabel),
    );
  }

  const trimmedSearchQuery = searchQuery.trim().toLowerCase();
  if (filterSearchQuery && trimmedSearchQuery) {
    filtered = filtered.filter(canvas => canvas.title.toLowerCase().includes(trimmedSearchQuery));
  }

  return filtered;
};

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

const CanvasPageSubscription: React.FC<{
  cursor: CanvasCursor | null;
  pageSize: number;
  channelId?: string | undefined;
  searchQuery?: string | undefined;
  includeArchived: boolean;
  onlyArchived: boolean;
  onPageComplete: (page: Canvas[], previousPageIds: Set<string>, pageSize: number) => void;
  onLoadingChange: (isLoading: boolean) => void;
}> = ({
  cursor,
  pageSize,
  channelId,
  searchQuery,
  includeArchived,
  onlyArchived,
  onPageComplete,
  onLoadingChange,
}) => {
  const previousPageIdsRef = useRef<Set<string>>(new Set());

  const query = useMemo(() => {
    const trimmedSearchQuery = searchQuery?.trim();
    if (channelId) {
      return queries.channelCanvasesPaginated({
        channelId,
        limit: pageSize,
        start: cursor,
        includeArchived,
        onlyArchived,
        ...(trimmedSearchQuery ? { searchQuery: trimmedSearchQuery } : {}),
      });
    }

    return queries.userCanvasesPaginated({
      limit: pageSize,
      start: cursor,
      includeArchived,
      onlyArchived,
      ...(trimmedSearchQuery ? { searchQuery: trimmedSearchQuery } : {}),
    });
  }, [channelId, cursor, includeArchived, onlyArchived, pageSize, searchQuery]);

  const [page, pageDetails] = useCachedQuery(query as never, { cursorEnabled: true });
  const isLoading = pageDetails.type !== 'complete';

  useEffect(() => {
    onLoadingChange(isLoading);
  }, [isLoading, onLoadingChange]);

  useEffect(() => {
    if (pageDetails.type !== 'complete') return;

    const completedPage = ((page as unknown as Canvas[]) || []).slice();
    onPageComplete(completedPage, previousPageIdsRef.current, pageSize);
    previousPageIdsRef.current = new Set(completedPage.map(canvas => canvas.id));
  }, [cursor, onPageComplete, page, pageDetails.type, pageSize]);

  return null;
};

const ChannelScopeFolderGroupSection: React.FC<{
  folder: CanvasFolder;
  isCollapsed: boolean;
  activeFilter: FilterTab;
  currentUserId?: string | undefined;
  searchScope: CanvasSearchScope;
  selectedScopeChannelId: string | null;
  selectedSharedByUserId: string | null;
  selectedLabel: string | null;
  searchQuery: string;
  onlyCallGeneratedCanvases: boolean;
  excludeCallGeneratedCanvases: boolean;
  excludeRecordingGeneratedCanvases: boolean;
  onlyRecordingGeneratedCanvases: boolean;
  showStarredOnly: boolean;
  includeArchived: boolean;
  onlyArchived: boolean;
  onToggleFolder: (folderId: string) => void;
  onVisibleCanvasCountChange: (folderId: string, count: number | null) => void;
  renderCanvasItem: (canvas: Canvas) => React.ReactNode;
}> = ({
  folder,
  isCollapsed,
  activeFilter,
  currentUserId,
  searchScope,
  selectedScopeChannelId,
  selectedSharedByUserId,
  selectedLabel,
  searchQuery,
  onlyCallGeneratedCanvases,
  excludeCallGeneratedCanvases,
  excludeRecordingGeneratedCanvases,
  onlyRecordingGeneratedCanvases,
  showStarredOnly,
  includeArchived,
  onlyArchived,
  onToggleFolder,
  onVisibleCanvasCountChange,
  renderCanvasItem,
}) => {
  const [folderCanvasesResult, folderCanvasesDetails] = useCachedQuery(
    queries.hierarchyCanvases({
      scope: 'folder',
      folderId: folder.id,
      includeArchived,
      onlyArchived,
    }),
    { enabled: true },
  );
  const folderCanvases = useMemo(
    () => withStarredCanvasState(toCanvasArray<Canvas>(folderCanvasesResult)),
    [folderCanvasesResult],
  );
  const archiveFilteredFolderCanvases = useMemo(
    () => filterArchivedCanvases(folderCanvases, { includeArchived, onlyArchived }),
    [folderCanvases, includeArchived, onlyArchived],
  );
  const folderFilteredCanvases = useMemo(
    () =>
      getFilteredCanvasItems({
        canvases: archiveFilteredFolderCanvases,
        onlyCallGeneratedCanvases,
        excludeCallGeneratedCanvases,
        excludeRecordingGeneratedCanvases,
        onlyRecordingGeneratedCanvases,
        showStarredOnly,
        activeFilter,
        currentUserId,
        searchScope,
        selectedScopeChannelId,
        selectedSharedByUserId,
        selectedLabel,
        searchQuery,
        filterSearchQuery: false,
      }),
    [
      activeFilter,
      archiveFilteredFolderCanvases,
      currentUserId,
      excludeCallGeneratedCanvases,
      excludeRecordingGeneratedCanvases,
      onlyCallGeneratedCanvases,
      onlyRecordingGeneratedCanvases,
      searchQuery,
      searchScope,
      selectedLabel,
      selectedScopeChannelId,
      selectedSharedByUserId,
      showStarredOnly,
    ],
  );
  const folderNameMatches = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return query.length > 0 && folder.name.toLowerCase().includes(query);
  }, [folder.name, searchQuery]);
  const visibleFolderCanvases = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query || folderNameMatches) return folderFilteredCanvases;
    return folderFilteredCanvases.filter(canvas => canvas.title.toLowerCase().includes(query));
  }, [folderFilteredCanvases, folderNameMatches, searchQuery]);
  const isFolderLoading = folderCanvasesDetails.type !== 'complete';
  const hasContentFilter =
    activeFilter !== 'all' ||
    showStarredOnly ||
    Boolean(selectedLabel) ||
    searchQuery.trim().length > 0;

  useEffect(() => {
    onVisibleCanvasCountChange(folder.id, isFolderLoading ? null : visibleFolderCanvases.length);
  }, [folder.id, isFolderLoading, onVisibleCanvasCountChange, visibleFolderCanvases.length]);

  if (
    hasContentFilter &&
    !isFolderLoading &&
    !folderNameMatches &&
    visibleFolderCanvases.length === 0
  ) {
    return null;
  }

  return (
    <section>
      <button
        type='button'
        className='flex w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sidebar-foreground/85 transition-colors hover:bg-sidebar-accent'
        onClick={() => onToggleFolder(folder.id)}
        data-track-category='CANVAS'
        data-track-name='Toggle_Channel_Folder_Filter_Group'
        data-track-metadata={JSON.stringify({
          folderId: folder.id,
          channelId: selectedScopeChannelId,
        })}
      >
        {isCollapsed ? (
          <ChevronRight className='size-3.5 shrink-0 text-sidebar-foreground/55' />
        ) : (
          <ChevronDown className='size-3.5 shrink-0 text-sidebar-foreground/55' />
        )}
        <Folder className='size-3.5 shrink-0 text-sidebar-foreground/55' />
        <span className='min-w-0 flex-1 truncate text-[13px] font-semibold'>{folder.name}</span>
        <span className='text-[12px] text-sidebar-foreground/45'>
          {isFolderLoading ? '...' : visibleFolderCanvases.length}
        </span>
      </button>
      {!isCollapsed && (
        <div className='space-y-0.5 pl-5'>
          {visibleFolderCanvases.map(canvas => (
            <div key={canvas.id}>{renderCanvasItem(canvas)}</div>
          ))}
        </div>
      )}
    </section>
  );
};

export const CanvasList: React.FC<CanvasListProps> = ({
  onSelect,
  onDelete,
  onDuplicate,
  onArchiveToggle,
  currentUserId,
  activeFilter: externalActiveFilter,
  onFilterChange,
  selectedCanvasId,
  paginated = false,
  channelId,
  excludeCallGeneratedCanvases = true,
  excludeRecordingGeneratedCanvases = true,
  onlyCallGeneratedCanvases = false,
  onlyRecordingGeneratedCanvases = false,
  showStarredOnly = false,
  includeArchived = false,
  onlyArchived = false,
  onToggleStar,
}) => {
  const navigate = useNavigate();
  const { isMobile } = usePlatform();
  const allUsers = useUsers();
  const activeUsers = useActiveUsers();
  const allVisibleChannels = useAllVisibleChannels();
  const userNameById = useMemo(
    () => new Map(allUsers.map(user => [user.id, getUserDisplayName(user)])),
    [allUsers],
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [sharedBySearchQuery, setSharedBySearchQuery] = useState('');
  const [selectedSharedByUserId, setSelectedSharedByUserId] = useState<string | null>(null);
  const [isSharedByDropdownOpen, setIsSharedByDropdownOpen] = useState(false);
  const [searchScope, setSearchScope] = useState<CanvasSearchScope>('direct');
  const [scopeMenuOpen, setScopeMenuOpen] = useState(false);
  const [scopeMenuView, setScopeMenuView] = useState<CanvasSearchScopeMenuView>('main');
  const [scopeChannelSearchQuery, setScopeChannelSearchQuery] = useState('');
  const [selectedScopeChannelId, setSelectedScopeChannelId] = useState<string | null>(null);
  const [openCanvasMenuId, setOpenCanvasMenuId] = useState<string | null>(null);
  const [deletingCanvasId, setDeletingCanvasId] = useState<string | null>(null);
  const [internalActiveFilter, setInternalActiveFilter] = useState<FilterTab>('all');
  const [collapsedChannelFolderIds, setCollapsedChannelFolderIds] = useState<Set<string>>(
    new Set(),
  );
  const [canvasItems, setCanvasItems] = useState<Canvas[]>([]);
  const [channelCanvasItems, setChannelCanvasItems] = useState<Canvas[]>([]);
  const [channelSourcePagination, setChannelSourcePagination] = useState<
    Record<string, ChannelSourcePaginationState>
  >({});
  const [channelFolderVisibleCanvasCounts, setChannelFolderVisibleCanvasCounts] = useState<
    Record<string, number | null>
  >({});
  const [pageCursor, setPageCursor] = useState<CanvasCursor | null>(null);
  const [isNextPageLoading, setIsNextPageLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const canvasVirtuosoRef = useRef<VirtuosoHandle>(null);

  const { prefetchTopCanvases, handleMouseEnter, handleMouseLeave } = useCanvasPrefetch();

  // Use external filter if provided, otherwise use internal state
  const activeFilter = externalActiveFilter ?? internalActiveFilter;
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 300);
  const trimmedSearchQuery = debouncedSearchQuery.trim();
  const sharedByUsers = useMemo(() => {
    const addableUsers = activeUsers.filter(user => user.id !== currentUserId);
    return searchUsers(addableUsers, sharedBySearchQuery, 25);
  }, [activeUsers, currentUserId, sharedBySearchQuery]);
  const selectedSharedByUser = useMemo(
    () => activeUsers.find(user => user.id === selectedSharedByUserId) ?? null,
    [activeUsers, selectedSharedByUserId],
  );
  const selectableScopeChannels = useMemo(
    () =>
      allVisibleChannels
        .filter(channel => channel.scopeType === ChannelScopeType.DEFAULT)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [allVisibleChannels],
  );
  const filteredScopeChannels = useMemo(() => {
    const query = scopeChannelSearchQuery.trim().toLowerCase();
    if (!query) return selectableScopeChannels;
    return selectableScopeChannels.filter(channel => channel.name.toLowerCase().includes(query));
  }, [scopeChannelSearchQuery, selectableScopeChannels]);
  const selectedScopeChannel = useMemo(() => {
    const selectedChannelId = channelId ?? selectedScopeChannelId;
    if (!selectedChannelId) return null;
    return allVisibleChannels.find(channel => channel.id === selectedChannelId) ?? null;
  }, [allVisibleChannels, channelId, selectedScopeChannelId]);
  const selectedScopeChannelLabel = selectedScopeChannel?.name ?? 'All channels';
  const isGlobalCanvasSearchActive = trimmedSearchQuery.length > 0;
  const selectedSearchScope: CanvasSearchScope = channelId ? 'via_channel' : searchScope;
  const SearchScopeIcon =
    selectedSearchScope === 'direct'
      ? AtSign
      : selectedSearchScope === 'via_channel'
        ? Hash
        : Layers;
  const selectedSearchScopeChannelId = channelId ?? selectedScopeChannelId;
  const effectiveSearchScope: CanvasSearchScope = isGlobalCanvasSearchActive
    ? 'all'
    : selectedSearchScope;
  const effectiveSelectedScopeChannelId = isGlobalCanvasSearchActive
    ? null
    : selectedSearchScopeChannelId;
  const isSpecificChannelScope =
    effectiveSearchScope === 'via_channel' && Boolean(effectiveSelectedScopeChannelId);
  const [selectedChannelFoldersResult, selectedChannelFoldersDetails] = useCachedQuery(
    queries.channelCanvasFolders({ channelId: effectiveSelectedScopeChannelId ?? '' }),
    { enabled: isSpecificChannelScope },
  );
  const selectedChannelFolders = useMemo(
    () => (selectedChannelFoldersResult as CanvasFolder[] | undefined) ?? [],
    [selectedChannelFoldersResult],
  );
  const [selectedChannelRootCanvasesResult, selectedChannelRootCanvasesDetails] = useCachedQuery(
    effectiveSelectedScopeChannelId
      ? queries.hierarchyCanvases({
          scope: 'channel_root',
          channelId: effectiveSelectedScopeChannelId,
          includeArchived,
          onlyArchived,
        })
      : queries.hierarchyCanvases({
          scope: 'personal_root',
          includeArchived,
          onlyArchived,
        }),
    { enabled: isSpecificChannelScope },
  );

  const extraChannelSourceIds = useMemo(() => {
    if (channelId || !paginated) return [];
    if (isGlobalCanvasSearchActive) {
      return selectableScopeChannels.map(channel => channel.id);
    }
    if (searchScope === 'via_channel' && selectedScopeChannelId) return [selectedScopeChannelId];
    if (searchScope === 'all' || searchScope === 'via_channel') {
      return selectableScopeChannels.map(channel => channel.id);
    }
    return [];
  }, [
    channelId,
    isGlobalCanvasSearchActive,
    paginated,
    searchScope,
    selectableScopeChannels,
    selectedScopeChannelId,
  ]);

  const rawItems = useMemo(
    () => mergeCanvasItems(canvasItems, channelCanvasItems),
    [canvasItems, channelCanvasItems],
  );
  const archiveFilteredRawItems = useMemo(
    () => filterArchivedCanvases(rawItems, { includeArchived, onlyArchived }),
    [includeArchived, onlyArchived, rawItems],
  );
  const itemsWithStarState = useMemo(
    () => withStarredCanvasState(archiveFilteredRawItems),
    [archiveFilteredRawItems],
  );
  const nextCursor = useMemo(() => getCanvasCursorFromLastItem(canvasItems), [canvasItems]);
  const isChannelSourceLoading = useMemo(
    () =>
      extraChannelSourceIds.some(
        sourceChannelId => channelSourcePagination[sourceChannelId]?.isLoading === true,
      ),
    [channelSourcePagination, extraChannelSourceIds],
  );
  const hasMoreChannelSources = useMemo(
    () =>
      extraChannelSourceIds.some(
        sourceChannelId => channelSourcePagination[sourceChannelId]?.hasMore !== false,
      ),
    [channelSourcePagination, extraChannelSourceIds],
  );
  const isLoadingNext = isNextPageLoading || isChannelSourceLoading;
  const isInitialLoading =
    paginated && rawItems.length === 0 && isLoadingNext && !isSpecificChannelScope;

  useLayoutEffect(() => {
    setCanvasItems([]);
    setChannelCanvasItems([]);
    setChannelSourcePagination({});
    setPageCursor(null);
    setIsNextPageLoading(false);
    setHasMore(true);
  }, [
    activeFilter,
    channelId,
    excludeCallGeneratedCanvases,
    excludeRecordingGeneratedCanvases,
    includeArchived,
    onlyArchived,
    onlyCallGeneratedCanvases,
    onlyRecordingGeneratedCanvases,
    paginated,
    debouncedSearchQuery,
    searchScope,
    selectedScopeChannelId,
    selectedSharedByUserId,
    showStarredOnly,
  ]);

  useEffect(() => {
    if (activeFilter !== 'shared') {
      setSelectedSharedByUserId(null);
      setSharedBySearchQuery('');
    }
  }, [activeFilter]);

  useEffect(() => {
    if (selectedSharedByUserId && !selectedSharedByUser) {
      setSelectedSharedByUserId(null);
    }
  }, [selectedSharedByUser, selectedSharedByUserId]);

  useEffect(() => {
    if (!scopeMenuOpen) {
      setScopeMenuView('main');
      setScopeChannelSearchQuery('');
    }
  }, [scopeMenuOpen]);

  useEffect(() => {
    if (
      selectedScopeChannelId &&
      !selectableScopeChannels.some(channel => channel.id === selectedScopeChannelId)
    ) {
      setSelectedScopeChannelId(null);
    }
  }, [selectableScopeChannels, selectedScopeChannelId]);

  useEffect(() => {
    setCollapsedChannelFolderIds(new Set());
  }, [selectedScopeChannelId]);

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

      const mergedItems = sortCanvasItems(Array.from(byId.values()));
      return areCanvasItemListsEqual(previousItems, mergedItems) ? previousItems : mergedItems;
    });
  }, []);

  const handlePageComplete = useCallback(
    (page: Canvas[], previousPageIds: Set<string>, pageSize: number): void => {
      applyPageToFlatList(page, previousPageIds);
      setHasMore(page.length === pageSize);
    },
    [applyPageToFlatList],
  );

  const handleChannelPageComplete = useCallback(
    (
      sourceChannelId: string,
      page: Canvas[],
      _previousPageIds: Set<string>,
      pageSize: number,
    ): void => {
      setChannelCanvasItems(previousItems => {
        const mergedItems = mergeCanvasItems(previousItems, page);
        return areCanvasItemListsEqual(previousItems, mergedItems) ? previousItems : mergedItems;
      });
      setChannelSourcePagination(previous => {
        const current = previous[sourceChannelId] ?? getDefaultChannelSourceState();
        const nextHasMore = page.length === pageSize;
        const nextCursor = getCanvasCursorFromLastItem(page);
        if (
          current.hasMore === nextHasMore &&
          current.isLoading === false &&
          getNullableCanvasCursorKey(current.nextCursor) === getNullableCanvasCursorKey(nextCursor)
        ) {
          return previous;
        }
        return {
          ...previous,
          [sourceChannelId]: {
            ...current,
            nextCursor,
            hasMore: nextHasMore,
            isLoading: false,
          },
        };
      });
    },
    [],
  );

  const handlePageLoadingChange = useCallback((isLoading: boolean): void => {
    setIsNextPageLoading(isLoading);
  }, []);

  const handleChannelLoadingChange = useCallback(
    (sourceChannelId: string, isLoading: boolean): void => {
      setChannelSourcePagination(previous => {
        const current = previous[sourceChannelId] ?? getDefaultChannelSourceState();
        if (current.isLoading === isLoading) return previous;
        return {
          ...previous,
          [sourceChannelId]: {
            ...current,
            isLoading,
          },
        };
      });
    },
    [],
  );

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

  const STARRED_SECTION_PAGE_SIZE = 3;
  const [isStarredSectionExpanded, setIsStarredSectionExpanded] = useState(false);

  const starredCanvases = useMemo(
    () => itemsWithStarState.filter(canvas => canvas.isStarred),
    [itemsWithStarState],
  );

  const visibleStarredCanvases = isStarredSectionExpanded
    ? starredCanvases
    : starredCanvases.slice(0, STARRED_SECTION_PAGE_SIZE);
  const hiddenStarredCount = starredCanvases.length - visibleStarredCanvases.length;

  // The pinned Starred section (below) is its own render of these canvases. Once it's
  // showing, the chronological list must not also render the same canvas.id a second
  // time -- two DOM copies sharing one canvas.id would both react to the single
  // `openCanvasMenuId` state, so opening the "..." menu on either copy marks both as
  // open and Radix's outside-click handling on the other duplicate closes it back out.
  const isStarredSectionVisible =
    starredCanvases.length > 0 &&
    !showStarredOnly &&
    !isSpecificChannelScope &&
    !debouncedSearchQuery.trim();
  const itemsForMainList = useMemo(() => {
    if (!isStarredSectionVisible) return itemsWithStarState;
    const starredIds = new Set(starredCanvases.map(canvas => canvas.id));
    return itemsWithStarState.filter(canvas => !starredIds.has(canvas.id));
  }, [isStarredSectionVisible, itemsWithStarState, starredCanvases]);

  const filteredCanvases = useMemo(
    () =>
      getFilteredCanvasItems({
        canvases: itemsForMainList,
        onlyCallGeneratedCanvases,
        excludeCallGeneratedCanvases,
        excludeRecordingGeneratedCanvases,
        onlyRecordingGeneratedCanvases,
        showStarredOnly,
        activeFilter,
        currentUserId,
        searchScope: effectiveSearchScope,
        selectedScopeChannelId: effectiveSelectedScopeChannelId,
        selectedSharedByUserId,
        selectedLabel,
        searchQuery: debouncedSearchQuery,
      }),
    [
      activeFilter,
      currentUserId,
      effectiveSearchScope,
      effectiveSelectedScopeChannelId,
      excludeCallGeneratedCanvases,
      excludeRecordingGeneratedCanvases,
      itemsForMainList,
      onlyCallGeneratedCanvases,
      onlyRecordingGeneratedCanvases,
      debouncedSearchQuery,
      selectedLabel,
      selectedSharedByUserId,
      showStarredOnly,
    ],
  );

  const hasPrimaryCanvasFilters =
    onlyCallGeneratedCanvases ||
    onlyRecordingGeneratedCanvases ||
    onlyArchived ||
    showStarredOnly ||
    activeFilter !== 'all' ||
    effectiveSearchScope !== 'all' ||
    Boolean(effectiveSelectedScopeChannelId) ||
    Boolean(selectedLabel) ||
    trimmedSearchQuery.length > 0;
  const canvasPageSize = hasPrimaryCanvasFilters ? CANVAS_FILTERED_PAGE_SIZE : CANVAS_PAGE_SIZE;
  const canvasListResetKey = `${channelId ?? 'user'}:${activeFilter}:${searchScope}:${
    selectedSharedByUserId ?? 'anyone'
  }:${selectedScopeChannelId ?? 'all-channels'}:${canvasPageSize}:${selectedLabel ?? 'no-label'}:${
    trimmedSearchQuery || 'no-search'
  }:${onlyCallGeneratedCanvases ? 'only-call' : 'mixed-call'}:${
    excludeCallGeneratedCanvases ? 'exclude-call' : 'include-call'
  }:${excludeRecordingGeneratedCanvases ? 'exclude-recording' : 'include-recording'}:${
    onlyRecordingGeneratedCanvases ? 'only-recording' : 'mixed-recording'
  }:${onlyArchived ? 'only-archived' : includeArchived ? 'with-archived' : 'without-archived'}:${
    showStarredOnly ? 'starred' : 'all-stars'
  }`;
  const shouldAutoPaginate =
    !hasPrimaryCanvasFilters ||
    filteredCanvases.length >= CANVAS_FILTERED_AUTO_PAGINATION_THRESHOLD;
  const shouldRenderChannelFolderGroups = isSpecificChannelScope;

  const shouldShowStarredSection = isStarredSectionVisible;
  const hasClientSideResultFilters =
    effectiveSearchScope === 'direct' ||
    activeFilter !== 'all' ||
    Boolean(selectedLabel) ||
    trimmedSearchQuery.length > 0 ||
    showStarredOnly ||
    onlyCallGeneratedCanvases ||
    onlyRecordingGeneratedCanvases;
  const shouldScanFilteredUserPages =
    hasClientSideResultFilters &&
    effectiveSearchScope !== 'via_channel' &&
    hasMore &&
    Boolean(nextCursor);
  const shouldScanFilteredChannelSources =
    hasClientSideResultFilters && extraChannelSourceIds.length > 0 && hasMoreChannelSources;
  const isFilteredScanIncomplete =
    !shouldRenderChannelFolderGroups &&
    (shouldScanFilteredUserPages || shouldScanFilteredChannelSources);
  const shouldLoadMoreOnListEnd =
    shouldAutoPaginate || extraChannelSourceIds.length > 0 || isFilteredScanIncomplete;
  const channelFolderGroups = useMemo(() => {
    if (!shouldRenderChannelFolderGroups) {
      return [] as CanvasFolderGroup[];
    }

    return selectedChannelFolders
      .map(folder => ({ folder }))
      .sort((a, b) => a.folder.name.localeCompare(b.folder.name));
  }, [selectedChannelFolders, shouldRenderChannelFolderGroups]);
  const channelFolderGroupKey = useMemo(
    () => channelFolderGroups.map(group => group.folder.id).join(':'),
    [channelFolderGroups],
  );

  const selectedChannelRootCanvases = useMemo(
    () =>
      getFilteredCanvasItems({
        canvases: withStarredCanvasState(
          filterArchivedCanvases(toCanvasArray<Canvas>(selectedChannelRootCanvasesResult), {
            includeArchived,
            onlyArchived,
          }),
        ),
        onlyCallGeneratedCanvases,
        excludeCallGeneratedCanvases,
        excludeRecordingGeneratedCanvases,
        onlyRecordingGeneratedCanvases,
        showStarredOnly,
        activeFilter,
        currentUserId,
        searchScope: effectiveSearchScope,
        selectedScopeChannelId: effectiveSelectedScopeChannelId,
        selectedSharedByUserId,
        selectedLabel,
        searchQuery: debouncedSearchQuery,
      }),
    [
      activeFilter,
      currentUserId,
      effectiveSearchScope,
      effectiveSelectedScopeChannelId,
      excludeCallGeneratedCanvases,
      excludeRecordingGeneratedCanvases,
      includeArchived,
      onlyArchived,
      onlyCallGeneratedCanvases,
      onlyRecordingGeneratedCanvases,
      debouncedSearchQuery,
      selectedChannelRootCanvasesResult,
      selectedLabel,
      selectedSharedByUserId,
      showStarredOnly,
    ],
  );
  useEffect(() => {
    setChannelFolderVisibleCanvasCounts({});
  }, [
    activeFilter,
    channelFolderGroupKey,
    currentUserId,
    effectiveSearchScope,
    effectiveSelectedScopeChannelId,
    excludeCallGeneratedCanvases,
    excludeRecordingGeneratedCanvases,
    includeArchived,
    onlyArchived,
    onlyCallGeneratedCanvases,
    onlyRecordingGeneratedCanvases,
    debouncedSearchQuery,
    selectedLabel,
    selectedSharedByUserId,
    showStarredOnly,
  ]);
  const handleChannelFolderVisibleCanvasCountChange = useCallback(
    (folderId: string, count: number | null): void => {
      setChannelFolderVisibleCanvasCounts(previous => {
        if (previous[folderId] === count) return previous;
        return { ...previous, [folderId]: count };
      });
    },
    [],
  );
  const hasPendingChannelFolderCounts = channelFolderGroups.some(
    group =>
      channelFolderVisibleCanvasCounts[group.folder.id] === undefined ||
      channelFolderVisibleCanvasCounts[group.folder.id] === null,
  );
  const hasVisibleChannelFolderCanvases = channelFolderGroups.some(
    group => (channelFolderVisibleCanvasCounts[group.folder.id] ?? 0) > 0,
  );
  const hasChannelFolderGroupedResults =
    selectedChannelRootCanvases.length > 0 ||
    hasVisibleChannelFolderCanvases ||
    (channelFolderGroups.length > 0 && hasPendingChannelFolderCounts);
  const canvasEmptyStateCopy = useMemo(
    () =>
      getCanvasEmptyStateCopy({
        searchQuery: debouncedSearchQuery,
        showStarredOnly,
        activeFilter,
        selectedLabel,
        selectedSearchScope,
        selectedScopeChannelId: selectedSearchScopeChannelId,
        selectedScopeChannelLabel,
        selectedSharedByUserName: selectedSharedByUser
          ? getUserDisplayName(selectedSharedByUser)
          : undefined,
      }),
    [
      activeFilter,
      debouncedSearchQuery,
      selectedLabel,
      selectedSearchScope,
      selectedSearchScopeChannelId,
      selectedScopeChannelLabel,
      selectedSharedByUser,
      showStarredOnly,
    ],
  );
  const isChannelFolderViewInitialLoading =
    shouldRenderChannelFolderGroups &&
    channelFolderGroups.length === 0 &&
    selectedChannelRootCanvases.length === 0 &&
    (selectedChannelFoldersDetails.type !== 'complete' ||
      selectedChannelRootCanvasesDetails.type !== 'complete');

  const availableLabels = useMemo(() => {
    const labelCounts = new Map<string, { label: CanvasMetadataLabel; count: number }>();
    for (const canvas of itemsWithStarState) {
      for (const label of getCanvasLabels(canvas)) {
        const existing = labelCounts.get(label.name);
        if (existing) {
          existing.count += 1;
        } else {
          labelCounts.set(label.name, { label, count: 1 });
        }
      }
    }
    return Array.from(labelCounts.values()).sort((a, b) =>
      a.label.name.localeCompare(b.label.name),
    );
  }, [itemsWithStarState]);

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
    if (!paginated || !hasMore || isNextPageLoading || !nextCursor) {
      return;
    }

    if (getNullableCanvasCursorKey(pageCursor) === getCanvasCursorKey(nextCursor)) {
      return;
    }

    setPageCursor(nextCursor);
  }, [hasMore, isNextPageLoading, nextCursor, pageCursor, paginated]);

  const requestNextChannelSourcePages = useCallback((): void => {
    if (!paginated || extraChannelSourceIds.length === 0) return;

    setChannelSourcePagination(previous => {
      const next = { ...previous };
      let didChange = false;

      for (const sourceChannelId of extraChannelSourceIds) {
        const current = next[sourceChannelId] ?? getDefaultChannelSourceState();
        if (current.isLoading || !current.hasMore) continue;

        const nextCursorForSource = current.nextCursor;
        if (!nextCursorForSource) continue;
        if (
          getNullableCanvasCursorKey(current.cursor) === getCanvasCursorKey(nextCursorForSource)
        ) {
          continue;
        }

        next[sourceChannelId] = {
          ...current,
          cursor: nextCursorForSource,
          isLoading: true,
        };
        didChange = true;
      }

      return didChange ? next : previous;
    });
  }, [extraChannelSourceIds, paginated]);

  const requestNextResults = useCallback((): void => {
    requestNextPage();
    requestNextChannelSourcePages();
  }, [requestNextChannelSourcePages, requestNextPage]);

  useEffect(() => {
    if (
      !paginated ||
      shouldRenderChannelFolderGroups ||
      !hasClientSideResultFilters ||
      isLoadingNext
    ) {
      return;
    }

    if (!shouldScanFilteredUserPages && !shouldScanFilteredChannelSources) return;

    requestNextResults();
  }, [
    hasClientSideResultFilters,
    isLoadingNext,
    paginated,
    requestNextResults,
    shouldScanFilteredChannelSources,
    shouldScanFilteredUserPages,
    shouldRenderChannelFolderGroups,
  ]);

  const handleVisibleRangeChanged = useCallback(
    (range: { startIndex: number; endIndex: number }): void => {
      if (
        !paginated ||
        hasPrimaryCanvasFilters ||
        extraChannelSourceIds.length > 0 ||
        isLoadingNext ||
        filteredCanvases.length === 0
      ) {
        return;
      }

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
    [
      extraChannelSourceIds.length,
      filteredCanvases,
      hasPrimaryCanvasFilters,
      isLoadingNext,
      pageCursor,
      paginated,
    ],
  );

  const toggleChannelFolder = useCallback((folderId: string): void => {
    setCollapsedChannelFolderIds(previous => {
      const next = new Set(previous);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }, []);

  const handleToggleCanvasStar = useCallback(
    (canvas: Canvas): void => {
      if (!onToggleStar) return;
      const nextIsStarred = !canvas.isStarred;
      setCanvasItems(items =>
        items.map(item => updateOptimisticStarState(item, canvas.id, currentUserId, nextIsStarred)),
      );
      toast.success(nextIsStarred ? 'Added to starred' : 'Removed from starred');
      onToggleStar(canvas);
    },
    [currentUserId, onToggleStar],
  );

  const handleOpenCanvasInNewTab = useCallback((canvas: Canvas): void => {
    window.open(`/chat/canvas/${canvas.id}`, '_blank');
  }, []);

  const renderCanvasItem = (canvas: Canvas): React.ReactNode => {
    const isSelected = selectedCanvasId === canvas.id;
    const isMenuOpen = openCanvasMenuId === canvas.id;
    const activityTime = getCanvasActivityTime(canvas);
    const ownerName = userNameById.get(canvas.createdBy) || 'Unknown';
    const ownerInitials = getInitials(ownerName);
    const ownerBadgeClassName = getUserBadgeClassName(canvas.createdBy);
    const editorUserId = canvas.lastEditedBy || canvas.createdBy;
    const editorName =
      editorUserId === currentUserId
        ? 'you'
        : userNameById.get(editorUserId) || (editorUserId ? 'Unknown' : 'someone');
    const labels = getCanvasLabels(canvas);
    const isBotGeneratedCanvas = isAnyCallGeneratedCanvas(canvas);
    const isCanvasCreator = canvas.createdBy === currentUserId;
    const menuItems: CanvasCardMenuItem[] = [
      ...(onToggleStar
        ? [
            {
              key: 'star',
              label: canvas.isStarred ? 'Unstar' : 'Star',
              icon: (
                <Star
                  className={cn('size-3.5', canvas.isStarred && 'fill-current')}
                  strokeWidth={2.2}
                />
              ),
              onSelect: () => handleToggleCanvasStar(canvas),
              trackName: 'TOGGLE_CANVAS_STAR',
              trackMetadata: {
                canvasId: canvas.id,
                isStarred: canvas.isStarred,
                source: 'card_context_menu',
              },
            },
          ]
        : []),
      ...(onDuplicate
        ? [
            {
              key: 'duplicate',
              label: 'Duplicate',
              icon: <Copy className='size-3.5' strokeWidth={2.1} />,
              onSelect: () => onDuplicate(canvas.id, canvas),
              trackName: 'Duplicate_Canvas',
              trackMetadata: {
                canvasId: canvas.id,
                title: canvas.title,
                source: 'card_context_menu',
              },
            },
          ]
        : []),
      {
        key: 'open-new-tab',
        label: 'Open in new tab',
        icon: <ExternalLink className='size-3.5' strokeWidth={2.2} />,
        onSelect: () => handleOpenCanvasInNewTab(canvas),
        trackName: 'OPEN_CANVAS_IN_NEW_TAB',
        trackMetadata: {
          canvasId: canvas.id,
          source: 'card_context_menu',
        },
      },
      ...(onArchiveToggle && isCanvasCreator
        ? [
            {
              key: canvas.isArchived ? 'unarchive' : 'archive',
              label: canvas.isArchived ? 'Unarchive' : 'Archive',
              icon: canvas.isArchived ? (
                <ArchiveRestore className='size-3.5' strokeWidth={2.1} />
              ) : (
                <Archive className='size-3.5' strokeWidth={2.1} />
              ),
              onSelect: () => onArchiveToggle(canvas),
              separatorBefore: true,
              trackName: canvas.isArchived ? 'UNARCHIVE_CANVAS' : 'ARCHIVE_CANVAS',
              trackMetadata: {
                canvasId: canvas.id,
                source: 'card_context_menu',
              },
            },
          ]
        : []),
      ...(onDelete && isCanvasCreator
        ? [
            {
              key: 'delete',
              label: 'Delete',
              icon: <Trash2 className='size-3.5' strokeWidth={2.1} />,
              onSelect: () => setDeletingCanvasId(canvas.id),
              variant: 'destructive' as const,
              separatorBefore: !onArchiveToggle,
              testId: 'canvas-delete-button',
              trackName: 'DELETE_CANVAS',
              trackMetadata: {
                canvasId: canvas.id,
                source: 'card_context_menu',
              },
            },
          ]
        : []),
    ];

    return (
      <div
        role='button'
        tabIndex={0}
        className={cn(
          'group relative flex min-h-[50px] cursor-pointer items-start gap-2 rounded-md px-1.5 py-1.5 transition-colors hover:bg-background hover:text-sidebar-accent-foreground hover:shadow-sm',
          isMenuOpen || isSelected
            ? 'bg-background text-sidebar-accent-foreground shadow-sm'
            : 'text-sidebar-foreground',
        )}
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
        <div className='relative mt-1 flex size-6 shrink-0 items-start justify-center'>
          <Tooltip
            content={
              isBotGeneratedCanvas
                ? 'Bot-generated canvas'
                : canvas.visibility === CanvasVisibility.PUBLIC
                  ? 'Anyone with the link can view'
                  : 'Private'
            }
            side='top'
            align='start'
          >
            <div className='flex size-5 items-center justify-center text-sidebar-foreground/70'>
              {isBotGeneratedCanvas ? (
                <Bot className='size-4' strokeWidth={2.1} />
              ) : canvas.visibility === CanvasVisibility.PUBLIC ? (
                <Globe className='size-4' strokeWidth={2.1} />
              ) : (
                <FileText className='size-4' strokeWidth={2.1} />
              )}
            </div>
          </Tooltip>
          <Tooltip content={ownerName} side='top' delayDuration={400}>
            <span
              className={cn(
                'absolute -bottom-1 -right-0.5 flex size-3.5 items-center justify-center rounded-full border border-sidebar text-[8px] font-bold leading-none',
                ownerBadgeClassName,
              )}
            >
              {ownerInitials.slice(0, 1)}
            </span>
          </Tooltip>
        </div>

        <div className='min-w-0 flex-1 pr-10'>
          <div className='flex min-w-0 items-center gap-1 pt-0.5'>
            <Tooltip
              content={canvas.title || 'Untitled Canvas'}
              side='top'
              align='start'
              delayDuration={400}
              className='max-w-xs break-words'
            >
              <h3
                className={cn(
                  'truncate text-[13px] font-semibold leading-4',
                  isSelected
                    ? 'text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground/80 group-hover:text-sidebar-accent-foreground',
                )}
              >
                {canvas.title || 'Untitled Canvas'}
              </h3>
            </Tooltip>
            {canvas.visibility !== CanvasVisibility.PUBLIC && (
              <Lock className='size-3 shrink-0 text-sidebar-foreground/40' strokeWidth={2.1} />
            )}
            {canvas.isArchived && (
              <span className='inline-flex h-4 shrink-0 items-center rounded border border-amber-200 bg-amber-50 px-1 text-[10px] font-medium leading-none text-amber-700'>
                Archived
              </span>
            )}
          </div>

          <div className='truncate text-[12px] leading-4 text-sidebar-foreground/60'>
            Edited {formatCanvasEditedTime(activityTime)} by {editorName}
          </div>

          {labels.length > 0 && (
            <div className='mt-1 flex min-w-0 flex-wrap items-center gap-1'>
              {labels.map((label, index) => (
                <span
                  key={`${label.name}:${index}`}
                  className='inline-flex h-5 max-w-full items-center gap-1 rounded-md border border-sidebar-border-muted bg-sidebar px-1.5 text-[11px] leading-none text-sidebar-foreground/75'
                >
                  <span
                    className={`size-1.5 shrink-0 rounded-full ${getLabelDotClassName(
                      label,
                      index,
                    )}`}
                  />
                  <span className='truncate'>{label.name}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        <div
          className={cn(
            'absolute right-1 top-1.5 flex items-center gap-0.5 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100',
            isMenuOpen ? 'opacity-100' : 'opacity-0',
          )}
        >
          <DropdownMenu
            modal={false}
            open={isMenuOpen}
            onOpenChange={open => setOpenCanvasMenuId(open ? canvas.id : null)}
          >
            <DropdownMenuTrigger asChild>
              <button
                onClick={e => e.stopPropagation()}
                className='flex size-6 items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar hover:text-sidebar-accent-foreground'
                data-track-category='CANVAS'
                data-track-name='Open_Canvas_Menu'
                data-track-metadata={JSON.stringify({ canvasId: canvas.id })}
                aria-label='Canvas actions'
              >
                <MoreVertical className='size-3.5' strokeWidth={2.5} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align='end'
              sideOffset={6}
              className='w-[168px] max-w-[calc(100vw-2rem)] rounded-lg border-sidebar-border bg-popover p-1 shadow-xl'
            >
              {menuItems.map(renderCanvasCardMenuItem)}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    );
  };

  const renderListItem = (index: number, canvas: Canvas): React.ReactNode => {
    const section = getCanvasDateSection(canvas);
    const previousCanvas = index > 0 ? filteredCanvases[index - 1] : null;
    const shouldShowSection = !previousCanvas || getCanvasDateSection(previousCanvas) !== section;

    return (
      <div className='pb-1'>
        {shouldShowSection && (
          <div
            className={`px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-sidebar-foreground/50 ${
              index === 0 ? 'pt-1' : 'pt-5'
            }`}
          >
            {section}
          </div>
        )}
        {renderCanvasItem(canvas)}
      </div>
    );
  };

  const renderCanvasEmptyState = (): React.ReactNode => (
    <div className='flex h-full flex-col items-center justify-center px-4 py-16 text-center'>
      <FileText className='mb-4 size-16 shrink-0 text-muted-foreground' />
      <h3 className='mb-2 max-w-[240px] break-words text-lg font-medium leading-6 text-foreground'>
        {canvasEmptyStateCopy.title}
      </h3>
      <p className='max-w-[240px] text-sm text-muted-foreground'>
        {canvasEmptyStateCopy.description}
      </p>
    </div>
  );

  const renderChannelFolderGroupedList = (): React.ReactNode => (
    <div className='h-full overflow-auto pb-2'>
      {hasChannelFolderGroupedResults ? (
        <div className='space-y-1'>
          {channelFolderGroups.map(folderGroup => {
            const isCollapsed = collapsedChannelFolderIds.has(folderGroup.folder.id);
            return (
              <ChannelScopeFolderGroupSection
                key={folderGroup.folder.id}
                folder={folderGroup.folder}
                isCollapsed={isCollapsed}
                activeFilter={activeFilter}
                currentUserId={currentUserId}
                searchScope={effectiveSearchScope}
                selectedScopeChannelId={effectiveSelectedScopeChannelId}
                selectedSharedByUserId={selectedSharedByUserId}
                selectedLabel={selectedLabel}
                searchQuery={debouncedSearchQuery}
                onlyCallGeneratedCanvases={onlyCallGeneratedCanvases}
                excludeCallGeneratedCanvases={excludeCallGeneratedCanvases}
                excludeRecordingGeneratedCanvases={excludeRecordingGeneratedCanvases}
                onlyRecordingGeneratedCanvases={onlyRecordingGeneratedCanvases}
                showStarredOnly={showStarredOnly}
                includeArchived={includeArchived}
                onlyArchived={onlyArchived}
                onToggleFolder={toggleChannelFolder}
                onVisibleCanvasCountChange={handleChannelFolderVisibleCanvasCountChange}
                renderCanvasItem={renderCanvasItem}
              />
            );
          })}

          {selectedChannelRootCanvases.map(canvas => (
            <div key={canvas.id}>{renderCanvasItem(canvas)}</div>
          ))}
        </div>
      ) : (
        renderCanvasEmptyState()
      )}
    </div>
  );

  return (
    <div className='flex flex-col h-full' data-testid='canvas-list'>
      {paginated && (
        <CanvasPageSubscription
          key={`${canvasListResetKey}:${
            pageCursor ? getCanvasCursorKey(pageCursor) : 'first-page'
          }`}
          cursor={pageCursor}
          pageSize={canvasPageSize}
          channelId={channelId}
          searchQuery={trimmedSearchQuery}
          includeArchived={includeArchived}
          onlyArchived={onlyArchived}
          onPageComplete={handlePageComplete}
          onLoadingChange={handlePageLoadingChange}
        />
      )}
      {paginated &&
        extraChannelSourceIds.map(sourceChannelId => {
          const sourceState =
            channelSourcePagination[sourceChannelId] ?? getDefaultChannelSourceState();
          return (
            <CanvasPageSubscription
              key={`channel-source:${canvasListResetKey}:${sourceChannelId}:${getNullableCanvasCursorKey(
                sourceState.cursor,
              )}`}
              cursor={sourceState.cursor}
              pageSize={CANVAS_FILTERED_PAGE_SIZE}
              channelId={sourceChannelId}
              searchQuery={trimmedSearchQuery}
              includeArchived={includeArchived}
              onlyArchived={onlyArchived}
              onPageComplete={(page, previousPageIds, pageSize) =>
                handleChannelPageComplete(sourceChannelId, page, previousPageIds, pageSize)
              }
              onLoadingChange={isLoading => handleChannelLoadingChange(sourceChannelId, isLoading)}
            />
          );
        })}

      <div className='px-0 pb-2'>
        <div className='flex flex-col gap-2'>
          <div className='relative w-full'>
            <Search className='absolute left-3 top-1/2 size-4 -translate-y-1/2 text-sidebar-foreground/55' />
            <Input
              ref={searchInputRef}
              type='text'
              value={searchQuery}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
              placeholder='Search canvases'
              className='h-8 w-full rounded-md border-sidebar-border-muted bg-background pl-9 pr-14 text-[13px]'
            />
            <DropdownMenu modal={false} open={scopeMenuOpen} onOpenChange={setScopeMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  type='button'
                  className='absolute right-1 top-1/2 inline-flex h-6 -translate-y-1/2 items-center gap-0.5 rounded-md border-l border-sidebar-border-muted px-1.5 text-sidebar-foreground/65 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                  aria-label='Canvas search scope'
                  data-testid='canvas-search-scope-trigger'
                  data-track-category='CANVAS'
                  data-track-name='OPEN_CANVAS_SEARCH_SCOPE'
                  data-track-metadata={JSON.stringify({
                    scope: searchScope,
                    channelId: selectedScopeChannelId,
                  })}
                >
                  <SearchScopeIcon className='size-3.5' strokeWidth={2.2} />
                  <ChevronDown
                    className={cn('size-3 transition-transform', scopeMenuOpen && 'rotate-180')}
                    strokeWidth={2.4}
                  />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align='end'
                sideOffset={6}
                className='w-[228px] rounded-xl border-sidebar-border-muted bg-background p-1.5 shadow-xl'
              >
                {scopeMenuView === 'channels' ? (
                  <div className='flex max-h-[318px] flex-col'>
                    <div className='mb-1 flex h-8 items-center gap-1 px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/55'>
                      <button
                        type='button'
                        className='flex size-6 items-center justify-center rounded-md text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                        onClick={event => {
                          event.preventDefault();
                          event.stopPropagation();
                          setScopeMenuView('main');
                        }}
                        aria-label='Back to search scopes'
                        data-track-category='CANVAS'
                        data-track-name='BACK_TO_CANVAS_SEARCH_SCOPES'
                      >
                        <ChevronLeft className='size-3.5' strokeWidth={2.2} />
                      </button>
                      Via channel
                    </div>
                    <div className='relative mb-1'>
                      <Search className='absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-sidebar-foreground/45' />
                      <Input
                        autoFocus={!isMobile}
                        type='text'
                        value={scopeChannelSearchQuery}
                        onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                          setScopeChannelSearchQuery(event.target.value)
                        }
                        onClick={event => event.stopPropagation()}
                        onKeyDown={event => event.stopPropagation()}
                        placeholder='Filter channels'
                        className='h-8 w-full rounded-lg border-sidebar-border-muted bg-muted/40 pl-8 text-[13px]'
                        data-testid='canvas-search-scope-channel-filter'
                      />
                    </div>
                    <div className='min-h-0 overflow-y-auto pr-1'>
                      <DropdownMenuItem
                        className={cn(
                          'h-8 gap-2 rounded-md px-2 text-[13px]',
                          searchScope === 'via_channel' &&
                            !selectedScopeChannelId &&
                            'bg-muted text-foreground',
                        )}
                        onSelect={() => {
                          setSearchScope('via_channel');
                          setSelectedScopeChannelId(null);
                          setScopeMenuOpen(false);
                        }}
                        data-testid='canvas-search-scope-all-channels'
                        data-track-category='CANVAS'
                        data-track-name='SET_CANVAS_SEARCH_SCOPE_ALL_CHANNELS'
                      >
                        <Hash className='size-3.5 shrink-0 text-sidebar-foreground/45' />
                        <span className='min-w-0 flex-1 truncate'>All channels</span>
                      </DropdownMenuItem>
                      {filteredScopeChannels.map(channel => (
                        <DropdownMenuItem
                          key={channel.id}
                          className={cn(
                            'h-8 gap-2 rounded-md px-2 text-[13px]',
                            selectedScopeChannelId === channel.id && 'bg-muted text-foreground',
                          )}
                          onSelect={() => {
                            setSearchScope('via_channel');
                            setSelectedScopeChannelId(channel.id);
                            setScopeMenuOpen(false);
                          }}
                          data-track-category='CANVAS'
                          data-track-name='SET_CANVAS_SEARCH_SCOPE_CHANNEL'
                          data-track-metadata={JSON.stringify({ channelId: channel.id })}
                        >
                          <Hash className='size-3.5 shrink-0 text-sidebar-foreground/45' />
                          <span className='min-w-0 flex-1 truncate'>{channel.name}</span>
                        </DropdownMenuItem>
                      ))}
                      {filteredScopeChannels.length === 0 && (
                        <div className='px-2 py-6 text-center text-[13px] text-muted-foreground'>
                          No channels found
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    <DropdownMenuItem
                      className='h-8 gap-2 rounded-md px-2 text-[13px]'
                      onSelect={() => {
                        setSearchScope('direct');
                        setSelectedScopeChannelId(null);
                        setScopeMenuOpen(false);
                      }}
                      data-testid='canvas-search-scope-direct'
                      data-track-category='CANVAS'
                      data-track-name='SET_CANVAS_SEARCH_SCOPE_DIRECT'
                    >
                      <AtSign className='size-3.5 shrink-0 text-sidebar-foreground/45' />
                      <span className='min-w-0 flex-1 truncate'>Shared directly with me</span>
                      {searchScope === 'direct' && (
                        <Check className='size-3.5 shrink-0' strokeWidth={2.3} />
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className={cn(
                        'h-8 gap-2 rounded-md px-2 text-[13px]',
                        searchScope === 'via_channel' && 'bg-muted text-foreground',
                      )}
                      onSelect={event => {
                        event.preventDefault();
                        setScopeMenuView('channels');
                      }}
                      data-testid='canvas-search-scope-via-channel'
                      data-track-category='CANVAS'
                      data-track-name='OPEN_CANVAS_SEARCH_SCOPE_CHANNELS'
                    >
                      <Hash className='size-3.5 shrink-0 text-sidebar-foreground/45' />
                      <span className='max-w-[76px] shrink truncate' title='Shared via channel'>
                        Shared via channel
                      </span>
                      <span
                        className='min-w-0 flex-1 truncate text-sidebar-foreground/55'
                        title={selectedScopeChannelLabel}
                      >
                        {selectedScopeChannelLabel}
                      </span>
                      <ChevronRight
                        className='size-3.5 shrink-0 text-sidebar-foreground/45'
                        strokeWidth={2.2}
                      />
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className='h-8 gap-2 rounded-md px-2 text-[13px]'
                      onSelect={() => {
                        setSearchScope('all');
                        setSelectedScopeChannelId(null);
                        setScopeMenuOpen(false);
                      }}
                      data-testid='canvas-search-scope-all'
                      data-track-category='CANVAS'
                      data-track-name='SET_CANVAS_SEARCH_SCOPE_ALL'
                    >
                      <Layers className='size-3.5 shrink-0 text-sidebar-foreground/45' />
                      <span className='min-w-0 flex-1 truncate'>All canvases</span>
                      {searchScope === 'all' && (
                        <Check className='size-3.5 shrink-0' strokeWidth={2.3} />
                      )}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className='flex min-w-0 items-center gap-1.5'>
            <div className='inline-flex h-7 min-w-0 items-center rounded-lg border border-sidebar-border-muted bg-sidebar p-0.5'>
              <button
                onClick={() => setActiveFilter('all')}
                className={`h-6 rounded-md px-2.5 text-[12px] font-medium leading-none transition-colors ${
                  activeFilter === 'all'
                    ? 'bg-background text-sidebar-accent-foreground shadow-sm'
                    : 'text-sidebar-foreground/55 hover:text-sidebar-accent-foreground'
                }`}
                data-testid='canvas-filter-all'
                data-track-category='CANVAS'
                data-track-name='FILTER_ALL'
                data-track-metadata={JSON.stringify({
                  filter: 'all',
                  canvasCount: rawItems.length,
                })}
              >
                All
              </button>
              <button
                onClick={() => setActiveFilter('created_by_me')}
                className={`h-6 rounded-md px-2.5 text-[12px] font-medium leading-none transition-colors ${
                  activeFilter === 'created_by_me'
                    ? 'bg-background text-sidebar-accent-foreground shadow-sm'
                    : 'text-sidebar-foreground/55 hover:text-sidebar-accent-foreground'
                }`}
                data-testid='canvas-filter-created-by-me'
                data-track-category='CANVAS'
                data-track-name='FILTER_CREATED_BY_ME'
                data-track-metadata={JSON.stringify({ filter: 'created_by_me' })}
              >
                Mine
              </button>
              <DropdownMenu
                modal={false}
                open={isSharedByDropdownOpen}
                onOpenChange={open => {
                  setIsSharedByDropdownOpen(open);
                  if (open) {
                    setActiveFilter('shared');
                  } else {
                    setSharedBySearchQuery('');
                  }
                }}
              >
                <DropdownMenuTrigger asChild>
                  <button
                    type='button'
                    className={`inline-flex h-6 items-center gap-1 rounded-md px-2.5 text-[12px] font-medium leading-none transition-colors ${
                      activeFilter === 'shared'
                        ? 'bg-background text-sidebar-accent-foreground shadow-sm'
                        : 'text-sidebar-foreground/55 hover:text-sidebar-accent-foreground'
                    }`}
                    data-testid='canvas-filter-shared'
                    data-track-category='CANVAS'
                    data-track-name='FILTER_SHARED'
                    data-track-metadata={JSON.stringify({
                      filter: 'shared',
                      sharedBy: selectedSharedByUserId ?? 'anyone',
                    })}
                  >
                    Shared by
                    <ChevronDown
                      className={cn(
                        'size-3 shrink-0 transition-transform',
                        isSharedByDropdownOpen && 'rotate-180',
                      )}
                      strokeWidth={2.4}
                    />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align='start'
                  className='w-[214px] rounded-xl border-sidebar-border bg-popover p-2 shadow-xl'
                  onCloseAutoFocus={event => event.preventDefault()}
                >
                  <div className='relative mb-1'>
                    <Search className='absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground' />
                    <Input
                      autoFocus={!isMobile}
                      value={sharedBySearchQuery}
                      onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                        setSharedBySearchQuery(event.target.value)
                      }
                      onClick={event => event.stopPropagation()}
                      onKeyDown={event => event.stopPropagation()}
                      placeholder='Search...'
                      className='h-8 rounded-lg border-sidebar-border-muted bg-background pl-8 text-[13px]'
                      data-testid='canvas-shared-by-search'
                    />
                  </div>

                  <div className='max-h-[240px] overflow-y-auto pr-1'>
                    <DropdownMenuItem
                      onSelect={() => {
                        setActiveFilter('shared');
                        setSelectedSharedByUserId(null);
                        setSharedBySearchQuery('');
                      }}
                      className={cn(
                        'h-8 cursor-pointer gap-2 rounded-md px-2 text-[13px] focus:bg-sidebar-accent',
                        !selectedSharedByUserId && 'bg-sidebar-accent',
                      )}
                      data-testid='canvas-shared-by-anyone'
                    >
                      <span className='w-6 shrink-0 text-[9px] font-semibold uppercase text-muted-foreground'>
                        All
                      </span>
                      <span className='min-w-0 flex-1 truncate'>Anyone</span>
                    </DropdownMenuItem>

                    {sharedByUsers.map((user: User) => {
                      const displayName = getUserDisplayName(user);
                      const isSelected = selectedSharedByUserId === user.id;
                      return (
                        <DropdownMenuItem
                          key={user.id}
                          onSelect={() => {
                            setActiveFilter('shared');
                            setSelectedSharedByUserId(user.id);
                            setSharedBySearchQuery('');
                          }}
                          className={cn(
                            'h-8 cursor-pointer gap-2 rounded-md px-2 text-[13px] focus:bg-sidebar-accent',
                            isSelected && 'bg-sidebar-accent',
                          )}
                          data-testid={`canvas-shared-by-user-${user.id}`}
                        >
                          <span
                            className={cn(
                              'flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold leading-none',
                              getUserBadgeClassName(user.id),
                            )}
                          >
                            {getInitials(displayName)}
                          </span>
                          <span className='min-w-0 flex-1 truncate'>{displayName}</span>
                        </DropdownMenuItem>
                      );
                    })}

                    {sharedByUsers.length === 0 && (
                      <div className='px-2 py-4 text-center text-[13px] text-muted-foreground'>
                        No users found
                      </div>
                    )}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button
                  type='button'
                  className={cn(
                    'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-sidebar-border bg-background px-2.5 text-[12px] font-medium text-sidebar-accent-foreground shadow-sm transition-colors hover:bg-sidebar-accent',
                    selectedLabel && 'bg-sidebar-accent',
                  )}
                  data-testid='canvas-label-filter'
                  data-track-category='CANVAS'
                  data-track-name='OPEN_CANVAS_LABEL_FILTER'
                >
                  <Tag className='size-3.5 text-sidebar-foreground/70' strokeWidth={2.1} />
                  Label
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='start' className='w-56'>
                {selectedLabel && (
                  <>
                    <DropdownMenuItem className='gap-2' onClick={() => setSelectedLabel(null)}>
                      <X className='size-3.5 shrink-0' strokeWidth={2.2} />
                      Clear label
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {availableLabels.length > 0 ? (
                  availableLabels.map(({ label, count }, index) => (
                    <DropdownMenuItem
                      key={label.name}
                      className='gap-2'
                      onClick={() => setSelectedLabel(label.name)}
                    >
                      <span
                        className={`size-2 shrink-0 rounded-full ${getLabelDotClassName(
                          label,
                          index,
                        )}`}
                      />
                      <span className='min-w-0 flex-1 truncate'>{label.name}</span>
                      <span className='text-xs text-muted-foreground'>{count}</span>
                    </DropdownMenuItem>
                  ))
                ) : (
                  <DropdownMenuItem disabled className='text-muted-foreground'>
                    No labels
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {selectedLabel && (
            <div className='flex min-w-0 items-center gap-1'>
              <button
                type='button'
                onClick={() => setSelectedLabel(null)}
                className='inline-flex h-7 max-w-full items-center gap-1 rounded-full bg-sidebar-accent-foreground px-2.5 text-[12px] font-medium text-background shadow-sm'
                data-track-category='CANVAS'
                data-track-name='CLEAR_CANVAS_LABEL_FILTER'
                data-track-metadata={JSON.stringify({ label: selectedLabel })}
              >
                <span className='truncate'>{selectedLabel}</span>
                <X className='size-3.5 shrink-0' strokeWidth={2.2} />
              </button>
            </div>
          )}
        </div>
      </div>

      {shouldShowStarredSection && (
        <div className='shrink-0 px-2.5 pt-1'>
          <div className='px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-sidebar-foreground/50'>
            Starred
          </div>
          {visibleStarredCanvases.map(canvas => (
            <div key={canvas.id}>{renderCanvasItem(canvas)}</div>
          ))}
          {hiddenStarredCount > 0 && (
            <button
              type='button'
              onClick={() => setIsStarredSectionExpanded(true)}
              className='flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12px] font-medium text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
              data-track-category='CANVAS'
              data-track-name='SHOW_MORE_STARRED_CANVASES'
            >
              <ChevronDown className='size-3.5 shrink-0' strokeWidth={2.2} />
              See {hiddenStarredCount} more
            </button>
          )}
          {isStarredSectionExpanded && starredCanvases.length > STARRED_SECTION_PAGE_SIZE && (
            <button
              type='button'
              onClick={() => setIsStarredSectionExpanded(false)}
              className='flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[12px] font-medium text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
              data-track-category='CANVAS'
              data-track-name='SHOW_LESS_STARRED_CANVASES'
            >
              <ChevronRight className='size-3.5 shrink-0 -rotate-90' strokeWidth={2.2} />
              Show less
            </button>
          )}
        </div>
      )}

      <div className='flex-1 min-h-0'>
        {isInitialLoading || isChannelFolderViewInitialLoading ? (
          <div className='flex items-center justify-center h-64'>
            <div className='animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600'></div>
          </div>
        ) : shouldRenderChannelFolderGroups ? (
          renderChannelFolderGroupedList()
        ) : filteredCanvases.length === 0 && isFilteredScanIncomplete ? (
          <div className='flex items-center justify-center h-64'>
            <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600'></div>
          </div>
        ) : filteredCanvases.length === 0 ? (
          renderCanvasEmptyState()
        ) : (
          <Virtuoso
            ref={canvasVirtuosoRef}
            key={canvasListResetKey}
            className='h-full'
            data={filteredCanvases}
            computeItemKey={(_index, canvas) => canvas.id}
            endReached={() => {
              if (shouldLoadMoreOnListEnd) requestNextResults();
            }}
            rangeChanged={handleVisibleRangeChanged}
            itemContent={(index, canvas) => renderListItem(index, canvas)}
            components={{
              Footer: () =>
                (isLoadingNext && shouldLoadMoreOnListEnd) || isFilteredScanIncomplete ? (
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
    </div>
  );
};
