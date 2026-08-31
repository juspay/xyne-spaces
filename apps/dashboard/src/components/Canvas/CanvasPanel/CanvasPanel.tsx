import { ReactElement, useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Bot,
  FileText,
  PlusDefault,
  SearchBig,
  Spinner,
  ThreeDotsMenuHorizontal,
} from '@xyne/icons';
import { Archive, PanelLeftCloseIcon, PanelLeftOpenIcon } from 'lucide-react';
import { CanvasList } from '../CanvasList';
import { CanvasListGrouped } from '../CanvasListGrouped';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import type { Canvas } from '../Canvas.types';
import { CanvasVisibility, CanvasRole } from '@xyne/shared';
import { logger, Event } from '../../../utils/logger';
import { useAuth } from '../../../hooks/useAuth';
import { Switch } from '../../ui/Switch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import { Tooltip } from '../../ui/Tooltip/Tooltip';
import Input from '../../ui/Input';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'sonner';
import type { ReadonlyJSONValue } from '@rocicorp/zero';
import {
  ResizableGroup,
  Panel,
  Separator,
  type PanelImperativeHandle,
} from '../../ui/Resizable/Resizable';
import {
  CANVAS_SIDEBAR_DEFAULT_WIDTH,
  CANVAS_SIDEBAR_MAX_WIDTH,
  CANVAS_SIDEBAR_MIN_WIDTH,
} from './canvasSidebarWidth';
import AppNavigator from '../../AppNavigator/AppNavigator';
import { cn } from '../../../utils/classNames';
import { APP_NO_DRAG_STYLE } from '../../../utils/electronApp';
import { usePlatform } from '../../../hooks/usePlatform';
import { usePath } from '../../../hooks/usePath';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { canvasService } from '../../../services/Canvas/canvasService';
import { usePersistedCanvasPreferences } from '../../../hooks/usePersistedCanvasPreferences';
import { useCanvasArchiveToggle } from '../useCanvasArchiveToggle';

export type CanvasPanelOutletContext = {
  leftHeaderSlot?: ReactElement | null;
};

const CanvasPanel = (): ReactElement => {
  const { isMobile } = usePlatform();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const z = useZero();

  const isOnIndexRoute = usePath() === '/chat/canvas';

  const canvasPanelRef = useRef<PanelImperativeHandle>(null);
  const deletedCanvasIdsRef = useRef<Set<string>>(new Set());
  const {
    filter: activeFilter,
    setFilter: setActiveFilter,
    viewMode,
    setViewMode,
    lastCanvasId,
    setLastCanvasId,
    isSidebarCollapsed,
    setSidebarCollapsed,
  } = usePersistedCanvasPreferences();
  const [isCreatingCanvas, setIsCreatingCanvas] = useState(false);
  const [isPersonalSectionCollapsed, setIsPersonalSectionCollapsed] = useState(false);
  const [excludeCallGeneratedCanvases] = useState(true);
  const [onlyCallGeneratedCanvases, setOnlyCallGeneratedCanvases] = useState(false);
  const [onlyRecordingGeneratedCanvases, setOnlyRecordingGeneratedCanvases] = useState(false);
  const [onlyArchivedCanvases, setOnlyArchivedCanvases] = useState(false);
  const [groupedSearchQuery, setGroupedSearchQuery] = useState('');
  const [listOptionsOpen, setListOptionsOpen] = useState(false);
  const debouncedGroupedSearchQuery = useDebouncedValue(groupedSearchQuery, 300);
  const effectiveGroupedSearchQuery =
    debouncedGroupedSearchQuery.trim().length >= 2 ? debouncedGroupedSearchQuery : '';
  const selectedCanvasId = isOnIndexRoute ? undefined : location.pathname.split('/').at(-1);

  // react-resizable-panels snaps flex-basis instantly with no CSS transition of its
  // own. We animate the toggle here (not permanently, so manual drag-resize stays
  // 1:1 with the pointer instead of lagging behind a transition).
  const [isSidebarToggleAnimating, setIsSidebarToggleAnimating] = useState(false);

  useEffect(() => {
    const panel = canvasPanelRef.current;
    if (!panel) return;

    const isCurrentlyCollapsed = panel.isCollapsed();
    if (isSidebarCollapsed === isCurrentlyCollapsed) return;

    setIsSidebarToggleAnimating(true);
    if (isSidebarCollapsed) {
      panel.collapse();
    } else {
      panel.expand();
    }

    const timeoutId = window.setTimeout(() => setIsSidebarToggleAnimating(false), 220);
    return (): void => window.clearTimeout(timeoutId);
  }, [isSidebarCollapsed]);

  // Remember which canvas was last opened
  useEffect(() => {
    if (
      selectedCanvasId &&
      selectedCanvasId !== 'new' &&
      selectedCanvasId !== lastCanvasId &&
      !deletedCanvasIdsRef.current.has(selectedCanvasId)
    ) {
      setLastCanvasId(selectedCanvasId);
    }
  }, [selectedCanvasId, lastCanvasId, setLastCanvasId]);

  // Restore last opened canvas when landing on the canvas index
  useEffect(() => {
    if (
      !isMobile &&
      isOnIndexRoute &&
      lastCanvasId &&
      !deletedCanvasIdsRef.current.has(lastCanvasId)
    ) {
      void navigate(`/chat/canvas/${lastCanvasId}`, { replace: true });
    }
  }, [isMobile, isOnIndexRoute, lastCanvasId, navigate]);

  const handleCreateCanvas = useCallback(async () => {
    setIsCreatingCanvas(true);
    if (viewMode === 'grouped') {
      setIsPersonalSectionCollapsed(false);
    }
    const newCanvasId = uuidv4();
    const createStartedAt = performance.now();

    try {
      await canvasService.createCollaborativeCanvas({
        id: newCanvasId,
        title: 'Untitled Canvas',
      });

      logger.info(Event.CANVAS_CREATED, {
        canvasId: newCanvasId,
        durationMs: Math.round(performance.now() - createStartedAt),
      });

      const now = Date.now();
      const optimisticCanvas: Canvas = {
        id: newCanvasId,
        title: 'Untitled Canvas',
        content: [],
        createdBy: user?.id || '',
        visibility: CanvasVisibility.PRIVATE,
        isTemplate: false,
        isArchived: false,
        isCollaborative: true,
        isStarred: false,
        createdAt: now,
        updatedAt: now,
        accessLevel: CanvasRole.OWNER,
      };

      void navigate(`/chat/canvas/${newCanvasId}`, { state: { canvas: optimisticCanvas } });
    } catch (error) {
      logger.error(Event.CANVAS_CREATE_FAILED, {
        canvasId: newCanvasId,
        error: error instanceof Error ? error.message : String(error),
      });
      toast.error('Error', {
        description: 'Failed to create canvas. Please try again.',
      });
    } finally {
      setIsCreatingCanvas(false);
    }
  }, [navigate, viewMode, user?.id]);

  const handleSelectCanvas = useCallback(
    (e: React.MouseEvent | KeyboardEvent, canvas: Canvas) => {
      if (!navigator.onLine) {
        toast.info('Canvas Unavailable', {
          description: 'Canvases are available online only. Please check your connection.',
        });
        return;
      }

      const isCmdClick = 'metaKey' in e && (e.metaKey || e.ctrlKey);
      // Navigate to the canvas in the right panel
      const canvasUrl = `/chat/canvas/${canvas.id}`;
      // Only open in new tab on desktop when Cmd/Ctrl+Click is pressed
      if (!isMobile && isCmdClick) {
        window.open(canvasUrl, '_blank');
      } else {
        void navigate(canvasUrl, { state: { canvas } });
      }
    },
    [navigate, isMobile],
  );

  const handleDeleteCanvas = useCallback(
    (id: string) => {
      try {
        deletedCanvasIdsRef.current.add(id);
        z.mutate(mutators.canvas.delete({ id }));
        toast.success('Success', {
          description: 'Canvas deleted successfully.',
        });
        if (selectedCanvasId === id) {
          setLastCanvasId(null);
          void navigate('/chat/canvas', { replace: true });
        }
      } catch {
        deletedCanvasIdsRef.current.delete(id);
        toast.error('Error', {
          description: 'Failed to delete canvas. Please try again.',
        });
      }
    },
    [navigate, selectedCanvasId, setLastCanvasId, z],
  );

  const handleToggleStar = useCallback(
    (canvas: Canvas) => {
      try {
        z.mutate(
          mutators.canvasUserStatus.toggleStarred({
            id: uuidv4(),
            canvasId: canvas.id,
            timestamp: Date.now(),
          }),
        );
      } catch {
        toast.error('Error', {
          description: 'Failed to update starred canvas. Please try again.',
        });
      }
    },
    [z],
  );

  const handleArchiveToggleCanvas = useCanvasArchiveToggle();

  const handleDuplicateCanvas = useCallback(
    (canvasOrId: Canvas | string, canvasFromList?: Canvas) => {
      const originalCanvas = typeof canvasOrId === 'string' ? canvasFromList : canvasOrId;
      if (!originalCanvas) return;

      try {
        const newCanvasId = uuidv4();

        const resolvedProjectId =
          originalCanvas.projectId ??
          originalCanvas.channel?.projectId ??
          originalCanvas.folder?.project?.id;

        z.mutate(
          mutators.canvas.create({
            id: newCanvasId,
            title: `${originalCanvas.title} (Copy)`,
            content: originalCanvas.content as ReadonlyJSONValue,
            visibility: originalCanvas.visibility,
            ...(originalCanvas.channelId ? { channelId: originalCanvas.channelId } : {}),
            ...(originalCanvas.folderId ? { folderId: originalCanvas.folderId } : {}),
            ...(resolvedProjectId ? { projectId: resolvedProjectId } : {}),
            timestamp: Date.now(),
            participantId: uuidv4(),
          }),
        );

        toast.success('Success', {
          description: 'Canvas duplicated successfully.',
        });

        void navigate(`/chat/canvas/${newCanvasId}`);
      } catch {
        toast.error('Error', {
          description: 'Failed to duplicate canvas. Please try again.',
        });
      }
    },
    [z, navigate],
  );

  const collapseCanvasSidebar = useCallback((): void => {
    setListOptionsOpen(false);
    setSidebarCollapsed(true);
  }, [setSidebarCollapsed]);

  const expandCanvasSidebar = useCallback((): void => {
    setSidebarCollapsed(false);
  }, [setSidebarCollapsed]);

  const canvasPanelOutletContext = useMemo<CanvasPanelOutletContext>(
    () => ({
      leftHeaderSlot: isSidebarCollapsed ? (
        <Tooltip content='Show canvases' side='bottom' delayDuration={300}>
          <button
            type='button'
            className='flex size-7 shrink-0 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
            style={APP_NO_DRAG_STYLE}
            onClick={expandCanvasSidebar}
            aria-label='Show canvases panel'
            data-track-category='CANVAS'
            data-track-name='EXPAND_CANVAS_SIDEBAR'
          >
            <PanelLeftOpenIcon className='size-4' strokeWidth={2.1} />
          </button>
        </Tooltip>
      ) : null,
    }),
    [expandCanvasSidebar, isSidebarCollapsed],
  );

  // Render the left panel content
  const renderLeftPanel = (): ReactElement => (
    <div className={cn('h-full w-full flex flex-col', isMobile && 'bg-sidebar')}>
      <div className='w-full h-[52px] shrink-0'>
        <AppNavigator />
      </div>
      <div className='flex-1 min-h-0 flex flex-col overflow-hidden border-t border-sidebar-border-muted'>
        {/* Header — the frame is a bare title row; the list controls live behind
            the overflow menu so the chrome stays as quiet as the design. */}
        <div className='shrink-0 px-2.5 pt-3'>
          <div className='flex items-center justify-between gap-2 px-1.5 py-1'>
            <h2 className='truncate text-base font-bold leading-normal text-sidebar-accent-foreground'>
              Canvases
            </h2>
            <div className='flex shrink-0 items-center gap-1'>
              <Tooltip content='Hide canvases' side='bottom' delayDuration={300}>
                <button
                  type='button'
                  className='size-7 flex items-center justify-center rounded-lg border border-transparent text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground disabled:opacity-40'
                  onClick={collapseCanvasSidebar}
                  aria-label='Hide canvases panel'
                  data-track-category='CANVAS'
                  data-track-name='COLLAPSE_CANVAS_SIDEBAR'
                >
                  <PanelLeftCloseIcon className='size-4' strokeWidth={2.1} />
                </button>
              </Tooltip>
              <Tooltip content='New canvas' side='bottom' delayDuration={300}>
                <button
                  type='button'
                  className='size-7 flex items-center justify-center rounded-lg border border-transparent text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground disabled:opacity-40'
                  onClick={() => void handleCreateCanvas()}
                  disabled={isCreatingCanvas}
                  aria-label='New Canvas'
                  data-track-category='CANVAS'
                  data-track-name='Create_Canvas'
                >
                  {isCreatingCanvas ? (
                    <Spinner size={16} className='animate-spin' />
                  ) : (
                    <PlusDefault size={16} />
                  )}
                </button>
              </Tooltip>
              <DropdownMenu open={listOptionsOpen} onOpenChange={setListOptionsOpen}>
                <DropdownMenuTrigger asChild>
                  <button
                    type='button'
                    className='size-7 flex items-center justify-center rounded-lg border border-transparent text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                    aria-label='Canvas list options'
                    data-track-category='CANVAS'
                    data-track-name='CANVAS_LIST_OPTIONS_MENU'
                    data-testid='canvas-list-options'
                  >
                    <ThreeDotsMenuHorizontal size={16} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align='end'
                  className='w-[265px] rounded-xl border-sidebar-border-muted bg-background p-1.5 shadow-xl'
                >
                  <DropdownMenuItem
                    className='items-start gap-2 rounded-lg px-2 py-2 text-[13px]'
                    onSelect={event => event.preventDefault()}
                    data-track-category='CANVAS'
                    data-track-name='TOGGLE_ONLY_BOT_GENERATED_CANVASES'
                  >
                    <Bot size={15} className='mt-0.5 shrink-0 text-sidebar-foreground/55' />
                    <span className='min-w-0 flex-1'>
                      <span className='block leading-5'>Only bot-generated</span>
                      <span className='block max-w-[170px] text-xs leading-4 text-sidebar-foreground/50'>
                        Call notes and workflow docs Oats writes for you
                      </span>
                    </span>
                    <Switch
                      id='only-call-generated-canvases'
                      checked={onlyCallGeneratedCanvases}
                      onCheckedChange={checked => {
                        setOnlyCallGeneratedCanvases(checked);
                        if (checked) {
                          setViewMode('list');
                        }
                      }}
                    />
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className='items-start gap-2 rounded-lg px-2 py-2 text-[13px]'
                    onSelect={event => event.preventDefault()}
                    data-track-category='CANVAS'
                    data-track-name='TOGGLE_ONLY_RECORDING_GENERATED_CANVASES'
                  >
                    <Bot size={15} className='mt-0.5 shrink-0 text-sidebar-foreground/55' />
                    <span className='min-w-0 flex-1'>
                      <span className='block leading-5'>Only recording-generated</span>
                      <span className='block max-w-[170px] text-xs leading-4 text-sidebar-foreground/50'>
                        Notes and summaries from your recordings
                      </span>
                    </span>
                    <Switch
                      id='only-recording-generated-canvases'
                      checked={onlyRecordingGeneratedCanvases}
                      onCheckedChange={checked => {
                        setOnlyRecordingGeneratedCanvases(checked);
                        if (checked) {
                          setViewMode('list');
                        }
                      }}
                    />
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className='items-start gap-2 rounded-lg px-2 py-2 text-[13px]'
                    onSelect={event => event.preventDefault()}
                    data-track-category='CANVAS'
                    data-track-name='TOGGLE_ONLY_ARCHIVED_CANVASES'
                  >
                    <Archive size={15} className='mt-0.5 shrink-0 text-sidebar-foreground/55' />
                    <span className='min-w-0 flex-1'>
                      <span className='block leading-5'>Only archived</span>
                      <span className='block max-w-[170px] text-xs leading-4 text-sidebar-foreground/50'>
                        Show archived canvases only
                      </span>
                    </span>
                    <Switch
                      id='only-archived-canvases'
                      checked={onlyArchivedCanvases}
                      onCheckedChange={setOnlyArchivedCanvases}
                    />
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          {viewMode === 'grouped' && (
            <div className='relative mt-2'>
              <SearchBig
                size={16}
                className='absolute left-3 top-1/2 -translate-y-1/2 text-sidebar-foreground'
              />
              <Input
                type='text'
                value={groupedSearchQuery}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                  setGroupedSearchQuery(event.target.value)
                }
                placeholder='Search canvases'
                className='pl-9 w-full'
                data-testid='canvas-grouped-search-input'
              />
            </div>
          )}
        </div>

        {/* Canvas List */}
        <div className='flex-1 min-h-0 overflow-auto no-scrollbar px-2.5 pt-2 pb-3'>
          {viewMode === 'grouped' ? (
            <CanvasListGrouped
              onSelect={handleSelectCanvas}
              currentUserId={user?.id}
              selectedCanvasId={selectedCanvasId}
              onDelete={handleDeleteCanvas}
              onDuplicate={handleDuplicateCanvas}
              onArchiveToggle={handleArchiveToggleCanvas}
              isPersonalSectionCollapsed={isPersonalSectionCollapsed}
              onSetPersonalSectionCollapsed={setIsPersonalSectionCollapsed}
              excludeCallGeneratedCanvases={
                onlyCallGeneratedCanvases ? false : excludeCallGeneratedCanvases
              }
              showStarredOnly={false}
              onlyArchived={onlyArchivedCanvases}
              onToggleStar={handleToggleStar}
              searchQuery={effectiveGroupedSearchQuery}
            />
          ) : (
            <CanvasList
              paginated={true}
              onSelect={handleSelectCanvas}
              onDelete={handleDeleteCanvas}
              onDuplicate={handleDuplicateCanvas}
              onArchiveToggle={handleArchiveToggleCanvas}
              currentUserId={user?.id}
              activeFilter={activeFilter}
              onFilterChange={setActiveFilter}
              excludeCallGeneratedCanvases={
                onlyCallGeneratedCanvases ? false : excludeCallGeneratedCanvases
              }
              onlyCallGeneratedCanvases={onlyCallGeneratedCanvases}
              onlyRecordingGeneratedCanvases={onlyRecordingGeneratedCanvases}
              showStarredOnly={false}
              onlyArchived={onlyArchivedCanvases}
              onToggleStar={handleToggleStar}
              {...(selectedCanvasId ? { selectedCanvasId } : {})}
            />
          )}
        </div>
      </div>
    </div>
  );

  // Placeholder for right panel when no canvas is selected
  const renderPlaceholder = (): ReactElement => (
    <div className='flex-1 flex flex-col items-center justify-center bg-muted h-full'>
      <div className='text-center max-w-md mx-auto flex flex-col items-center'>
        <FileText className='text-muted-foreground mb-4' size={64} />
        <h3 className='text-xl font-medium text-foreground mb-2'>Select a canvas</h3>
        <p className='text-muted-foreground max-w-md'>
          Choose a canvas from the list to view its details or create a new one
        </p>
      </div>
    </div>
  );

  // Mobile view - show canvas list on index route, detail view otherwise
  if (isMobile) {
    // If on a specific canvas route, render the canvas detail using Outlet
    if (!isOnIndexRoute) {
      return (
        <div className='flex flex-col h-full bg-background w-screen'>
          <Outlet />
        </div>
      );
    }

    // Show canvas list on index route
    return <div className='flex flex-col h-full bg-background w-screen'>{renderLeftPanel()}</div>;
  }

  // Desktop view - two-panel layout with resizable panels
  return (
    <div className='flex h-full w-full overflow-hidden'>
      <ResizableGroup
        orientation='horizontal'
        className='flex align-top h-full'
        autoSaveId='canvas-screen-resize'
      >
        {/* LEFT PANEL - Canvas List */}
        <Panel
          id='canvas-sidebar'
          panelRef={canvasPanelRef}
          className={cn(
            isSidebarToggleAnimating && 'transition-[flex-basis] duration-200 ease-out',
          )}
          defaultSize={CANVAS_SIDEBAR_DEFAULT_WIDTH}
          minSize={CANVAS_SIDEBAR_MIN_WIDTH}
          maxSize={CANVAS_SIDEBAR_MAX_WIDTH}
          groupResizeBehavior='preserve-pixel-size'
          collapsible
          collapsedSize={0}
        >
          {renderLeftPanel()}
        </Panel>

        {/* RESIZE HANDLE */}
        <Separator
          className={cn(
            'w-[2px] transition-colors cursor-col-resize flex items-center justify-center group',
            isSidebarCollapsed && 'hidden',
          )}
        >
          <div className='w-[2px] h-full bg-sidebar-divider group-hover:bg-primary group-active:bg-primary'></div>
        </Separator>

        {/* RIGHT PANEL - Detail View */}
        <Panel id='canvas-content'>
          <div className='flex-1 flex flex-col bg-background relative h-full overflow-hidden rounded-2xl border border-border'>
            <div className='flex-1 h-full overflow-hidden'>
              {isSidebarCollapsed && isOnIndexRoute && (
                <div className='absolute left-3 top-3 z-30' style={APP_NO_DRAG_STYLE}>
                  {canvasPanelOutletContext.leftHeaderSlot}
                </div>
              )}
              {isOnIndexRoute ? renderPlaceholder() : <Outlet context={canvasPanelOutletContext} />}
            </div>
          </div>
        </Panel>
      </ResizableGroup>
    </div>
  );
};

CanvasPanel.displayName = 'CanvasPanel';

export default CanvasPanel;
