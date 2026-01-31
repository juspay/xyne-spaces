import { ReactElement, useState, useRef, useCallback } from 'react';
import { Outlet, useLocation, useNavigate, Link } from 'react-router-dom';
import { FileText, Plus, ArrowLeft } from 'lucide-react';
import { CanvasList } from '../CanvasList';
import { useQuery, useZero } from '@rocicorp/zero/react';
import { queries } from '../../../zero/queries';
import { mutators } from '../../../zero/mutators';
import type { Canvas } from '../Canvas.types';
import { CanvasVisibility, DocType } from '@xyne/shared';
import { useAuth } from '../../../hooks/useAuth';
import { Button } from '../../ui/Button';
import { v4 as uuidv4 } from 'uuid';
import { toast } from 'sonner';
import { isElectronApp } from '../../../utils/electronApp';
import { OpenIDEModal } from '../../Tickets/OpenIDEModal';
import type { ReadonlyJSONValue } from '@rocicorp/zero';
import {
  PanelGroup,
  Panel,
  PanelResizeHandle,
  type ImperativePanelHandle,
} from 'react-resizable-panels';
import { usePlatform } from '../../../hooks/usePlatform';

type FilterTab = 'all' | 'created_by_me' | 'quarto_docs';

const CanvasPanel = (): ReactElement => {
  const { isMobile } = usePlatform();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const z = useZero();

  const isOnIndexRoute = location.pathname === '/chat/canvas';

  const canvasPanelRef = useRef<ImperativePanelHandle>(null);
  const [showNewQuartoDocModal, setShowNewQuartoDocModal] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');

  // Fetch canvases
  const [allCanvases] = useQuery(queries.userCanvases());
  const [allQuartoDocs] = useQuery(queries.userQuartoDocs());

  const canvases = (allCanvases as unknown as Canvas[]) || [];
  const quartoDocs = (allQuartoDocs as unknown as Canvas[]) || [];

  const handleCreateCanvas = useCallback(() => {
    const newCanvasId = uuidv4();
    const viewAccessId = uuidv4();

    try {
      z.mutate(
        mutators.canvas.create({
          id: newCanvasId,
          title: 'Untitled Canvas',
          content: [] as ReadonlyJSONValue,
          viewAccessId,
          visibility: CanvasVisibility.PRIVATE,
          timestamp: Date.now(),
          participantId: uuidv4(),
        }),
      );

      void navigate(`/chat/canvas/${newCanvasId}`);
    } catch {
      toast.error('Error', {
        description: 'Failed to create canvas. Please try again.',
      });
    }
  }, [z, navigate]);

  const handleCreateQuartoDoc = useCallback(() => {
    if (isElectronApp()) {
      setShowNewQuartoDocModal(true);
    } else {
      toast.info('Create Quarto Doc', {
        description: 'Quarto doc creation is only available in the Electron app.',
      });
    }
  }, []);

  const handleSelectCanvas = useCallback(
    (canvas: Canvas) => {
      // If it's a Quarto doc, navigate to docs
      if (canvas.docType === DocType.Quarto && canvas.userRepo) {
        void navigate(`/docs/${canvas.userRepo}`);
        return;
      }

      // Navigate to the canvas in the right panel
      void navigate(`/chat/canvas/${canvas.id}`);
    },
    [navigate],
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

  const handleDuplicateCanvas = useCallback(
    (id: string) => {
      const originalCanvas = canvases.find(c => c.id === id);
      if (!originalCanvas) return;

      try {
        const newCanvasId = uuidv4();
        const viewAccessId = uuidv4();

        z.mutate(
          mutators.canvas.create({
            id: newCanvasId,
            title: `${originalCanvas.title} (Copy)`,
            content: originalCanvas.content as ReadonlyJSONValue,
            viewAccessId,
            visibility: originalCanvas.visibility,
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
    [canvases, z, navigate],
  );

  // Render the left panel content
  const renderLeftPanel = (): ReactElement => (
    <div className='flex-1 h-full flex flex-col bg-white border-r border-gray-200'>
      {/* Header */}
      <div className='p-4 border-b border-gray-100'>
        <div className='flex items-center justify-between mb-3'>
          <div className='flex items-center gap-2'>
            <Link
              to='/chat/dir'
              className='p-1 rounded-md text-gray-900 hover:text-gray-600 hover:bg-gray-100 transition-colors duration-200'
              aria-label='Go back'
            >
              <ArrowLeft size={20} />
            </Link>
            <h2 className='text-lg font-semibold text-gray-900'>Canvases</h2>
          </div>
          {activeFilter === 'quarto_docs' ? (
            isElectronApp() && (
              <Button variant='default' size='sm' onClick={() => handleCreateQuartoDoc()}>
                <Plus size={16} className='mr-1' />
                New Quarto Doc
              </Button>
            )
          ) : (
            <Button variant='default' size='sm' onClick={() => handleCreateCanvas()}>
              <Plus size={16} className='mr-1' />
              New Canvas
            </Button>
          )}
        </div>
      </div>

      {/* Canvas List */}
      <div className='flex-1 overflow-hidden'>
        <CanvasList
          canvases={canvases}
          onSelect={handleSelectCanvas}
          onDelete={handleDeleteCanvas}
          onDuplicate={handleDuplicateCanvas}
          loading={!allCanvases}
          currentUserId={user?.id}
          quartoDocs={quartoDocs}
          showQuartoDocsFilter={true}
          activeFilter={activeFilter}
          onFilterChange={setActiveFilter}
        />
      </div>
    </div>
  );

  // Placeholder for right panel when no canvas is selected
  const renderPlaceholder = (): ReactElement => (
    <div className='flex-1 flex flex-col items-center justify-center bg-gray-50 h-full'>
      <div className='text-center max-w-md mx-auto flex flex-col items-center'>
        <FileText className='text-gray-300 mb-4' size={64} />
        <h3 className='text-xl font-medium text-gray-900 mb-2'>Select a canvas</h3>
        <p className='text-gray-500 max-w-md'>
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
        <div className='flex flex-col h-full bg-white w-screen'>
          <Outlet />
        </div>
      );
    }

    // Show canvas list on index route
    return <div className='flex flex-col h-full bg-white w-screen'>{renderLeftPanel()}</div>;
  }

  // Desktop view - two-panel layout with resizable panels
  return (
    <div className='flex h-full w-full md:rounded-2xl overflow-hidden shadow-[0_0_8px_0_rgba(0,0,0,0.15)]'>
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
          <div className='flex-1 flex flex-col bg-white relative h-full'>
            <div className='flex-1 h-full overflow-hidden'>
              {isOnIndexRoute ? renderPlaceholder() : <Outlet />}
            </div>
          </div>
        </Panel>
      </PanelGroup>

      <OpenIDEModal
        isOpen={showNewQuartoDocModal}
        onClose={() => setShowNewQuartoDocModal(false)}
        mode='quarto'
      />
    </div>
  );
};

CanvasPanel.displayName = 'CanvasPanel';

export default CanvasPanel;
