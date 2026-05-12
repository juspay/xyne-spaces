import { ReactElement, useState, useRef, useCallback } from 'react';
import { Outlet, useLocation, useNavigate, Link } from 'react-router-dom';
import { FileText, Plus, ArrowLeft, Info, Loader2, List, FolderTree } from 'lucide-react';
import { CanvasList } from '../CanvasList';
import { CanvasListGrouped } from '../CanvasListGrouped';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import type { Canvas } from '../Canvas.types';
import { DocType } from '@xyne/shared';
import { useAuth } from '../../../hooks/useAuth';
import { Button } from '../../ui/Button';
import { PublishDocsModal } from '../QuartoInstructionsModal/QuartoInstructionsModal';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'sonner';
import type { ReadonlyJSONValue } from '@rocicorp/zero';
import {
  PanelGroup,
  Panel,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from 'react-resizable-panels';
import { usePlatform } from '../../../hooks/usePlatform';
import { usePath } from '../../../hooks/usePath';
import { canvasService } from '../../../services/Canvas/canvasService';

type FilterTab = 'all' | 'created_by_me' | 'quarto_docs';
type ViewMode = 'list' | 'grouped';

const CanvasPanel = (): ReactElement => {
  const { isMobile } = usePlatform();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const z = useZero();

  const isOnIndexRoute = usePath() === '/chat/canvas';

  const canvasPanelRef = useRef<ImperativePanelHandle>(null);
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('grouped');
  const [isCreatingCanvas, setIsCreatingCanvas] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const selectedCanvasId = isOnIndexRoute ? undefined : location.pathname.split('/').at(-1);

  const handleCreateCanvas = useCallback(async () => {
    setIsCreatingCanvas(true);
    const newCanvasId = uuidv4();
    const viewAccessId = uuidv4();

    try {
      await canvasService.createCollaborativeCanvas({
        id: newCanvasId,
        title: 'Untitled Canvas',
        viewAccessId,
      });

      void navigate(`/chat/canvas/${newCanvasId}`);
    } catch {
      toast.error('Error', {
        description: 'Failed to create canvas. Please try again.',
      });
    } finally {
      setIsCreatingCanvas(false);
    }
  }, [navigate]);

  const handleSelectCanvas = useCallback(
    (e: React.MouseEvent | KeyboardEvent, canvas: Canvas) => {
      if (!navigator.onLine) {
        toast.info('Canvas Unavailable', {
          description: 'Canvases are available online only. Please check your connection.',
        });
        return;
      }
      const isCmdClick = 'metaKey' in e && (e.metaKey || e.ctrlKey);
      // If it's a Quarto doc, navigate to docs
      if (canvas.docType === DocType.Quarto && canvas.userRepo) {
        const docsUrl = `/docs/${canvas.userRepo}`;
        // Only open in new tab on desktop when Cmd/Ctrl+Click is pressed
        if (!isMobile && isCmdClick) {
          window.open(docsUrl, '_blank');
        } else {
          void navigate(docsUrl);
        }
        return;
      }

      // Navigate to the canvas in the right panel
      const canvasUrl = `/chat/canvas/${canvas.id}`;
      // Only open in new tab on desktop when Cmd/Ctrl+Click is pressed
      if (!isMobile && isCmdClick) {
        window.open(canvasUrl, '_blank');
      } else {
        void navigate(canvasUrl);
      }
    },
    [navigate, isMobile],
  );

  const handleDeleteCanvas = useCallback(
    (id: string) => {
      try {
        z.mutate(mutators.canvas.delete({ id }));
        toast.success('Success', {
          description: 'Canvas deleted successfully.',
        });
      } catch {
        toast.error('Error', {
          description: 'Failed to delete canvas. Please try again.',
        });
      }
    },
    [z],
  );

  const handleCreateQuartoDoc = useCallback((): void => {
    setShowPublishModal(true);
  }, []);

  const handleDuplicateCanvas = useCallback(
    (canvasOrId: Canvas | string, canvasFromList?: Canvas) => {
      const originalCanvas = typeof canvasOrId === 'string' ? canvasFromList : canvasOrId;
      if (!originalCanvas) return;

      try {
        const newCanvasId = uuidv4();
        const viewAccessId = uuidv4();

        const resolvedProjectId =
          originalCanvas.projectId ??
          originalCanvas.channel?.projectId ??
          originalCanvas.folder?.project?.id;

        z.mutate(
          mutators.canvas.create({
            id: newCanvasId,
            title: `${originalCanvas.title} (Copy)`,
            content: originalCanvas.content as ReadonlyJSONValue,
            viewAccessId,
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

  // Render the left panel content
  const renderLeftPanel = (): ReactElement => (
    <div className='flex-1 h-full flex flex-col bg-background border-r border-border'>
      {/* Header */}
      <div className='p-4 border-b border-border'>
        <div className='flex items-center justify-between mb-3'>
          <div className='flex items-center gap-2'>
            {!isMobile && (
              <Link
                to='/chat/dir'
                className='p-1 rounded-md text-foreground hover:text-muted-foreground hover:bg-accent transition-colors duration-200'
                aria-label='Go back'
              >
                <ArrowLeft size={20} />
              </Link>
            )}
            <h2 className='text-lg font-semibold text-foreground'>Canvases</h2>
          </div>
          <div className='flex items-center gap-2'>
            <div className='flex items-center border border-border rounded-md'>
              <button
                className={`p-1.5 rounded-l-md transition-colors ${
                  viewMode === 'grouped'
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:bg-accent/50'
                }`}
                onClick={() => setViewMode('grouped')}
                title='Group by project'
                data-track-category='CANVAS'
                data-track-name='VIEW_MODE_GROUPED'
                data-testid='canvas-view-grouped'
              >
                <FolderTree size={16} />
              </button>
              <button
                className={`p-1.5 rounded-r-md transition-colors ${
                  viewMode === 'list'
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:bg-accent/50'
                }`}
                onClick={() => setViewMode('list')}
                title='List view'
                data-track-category='CANVAS'
                data-track-name='VIEW_MODE_LIST'
                data-testid='canvas-view-list'
              >
                <List size={16} />
              </button>
            </div>
            {viewMode === 'list' && activeFilter === 'quarto_docs' ? (
              <Button
                variant='default'
                size='sm'
                onClick={handleCreateQuartoDoc}
                data-track-category='CANVAS'
                data-track-name='Publish_Doc_Instructions'
              >
                <Info size={16} className='mr-1' />
                How to publish
              </Button>
            ) : (
              <Button
                variant='default'
                size='sm'
                onClick={() => void handleCreateCanvas()}
                disabled={isCreatingCanvas}
                data-track-category='CANVAS'
                data-track-name='Create_Canvas'
              >
                {isCreatingCanvas ? (
                  <Loader2 size={16} className='mr-1 animate-spin' />
                ) : (
                  <Plus size={16} className='mr-1' />
                )}
                {isCreatingCanvas ? 'Creating...' : 'New Canvas'}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Canvas List */}
      <div className='flex-1 min-h-0 overflow-auto'>
        {viewMode === 'grouped' ? (
          <CanvasListGrouped
            onSelect={handleSelectCanvas}
            currentUserId={user?.id}
            selectedCanvasId={selectedCanvasId}
            onDelete={handleDeleteCanvas}
            onDuplicate={handleDuplicateCanvas}
          />
        ) : (
          <CanvasList
            paginated={true}
            onSelect={handleSelectCanvas}
            onDelete={handleDeleteCanvas}
            onDuplicate={handleDuplicateCanvas}
            currentUserId={user?.id}
            showQuartoDocsFilter={true}
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
            {...(selectedCanvasId ? { selectedCanvasId } : {})}
          />
        )}
      </div>
      <PublishDocsModal isOpen={showPublishModal} onClose={() => setShowPublishModal(false)} />
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
    <div className='flex h-full w-full md:rounded-2xl overflow-hidden shadow-md'>
      <PanelGroup
        direction='horizontal'
        className='flex align-top h-full'
        autoSaveId='canvas-screen-resize'
      >
        {/* LEFT PANEL - Canvas List */}
        <Panel ref={canvasPanelRef} defaultSize={30} minSize={25} maxSize={45}>
          {renderLeftPanel()}
        </Panel>

        {/* RESIZE HANDLE */}
        <PanelResizeHandle className='w-[2px] transition-colors cursor-col-resize flex items-center justify-center group'>
          <div className='w-[2px] h-full bg-sidebar-divider group-hover:bg-sidebar-badge-accent group-active:bg-sidebar-badge-accent'></div>
        </PanelResizeHandle>

        {/* RIGHT PANEL - Detail View */}
        <Panel>
          <div className='flex-1 flex flex-col bg-background relative h-full'>
            <div className='flex-1 h-full overflow-hidden'>
              {isOnIndexRoute ? renderPlaceholder() : <Outlet />}
            </div>
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
};

CanvasPanel.displayName = 'CanvasPanel';

export default CanvasPanel;
