import { ReactElement, useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { BoardType } from '@xyne/shared';
import { ArrowLeft, Edit2, LayoutGrid, Rocket } from 'lucide-react';
import { BoardsTable, type BoardWithStages } from '../../components/Board';
import * as Tabs from '@radix-ui/react-tabs';

import BoardEditScreen from '../../components/Board/BoardEditScreen/BoardEditScreen';
import BoardStageConfigScreen from '../../components/Board/BoardStageConfigScreen/BoardStageConfigScreen';
import BoardCreateScreen from '../../components/Board/BoardCreateScreen/BoardCreateScreen';
import { ProjectForm } from '../../components/Project';
import { ReleaseConfigWizard } from '../../components/Release/ReleaseConfigWizard/ReleaseConfigWizard';
import { ReleasesSection } from './ReleasesSection';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog/Dialog';
import { queries } from '../../zero/queries';
import { mutators } from '../../zero/mutators';
import { useZero } from '../../hooks/useZero';
import { toast } from 'sonner';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { cn } from '../../utils/classNames';

// Type for board data passed from BoardEditScreen to BoardStageConfigScreen
interface BoardData {
  id: string;
  name?: string;
  [key: string]: unknown;
}

type TabValue = 'boards' | 'release';
type ReleaseBoardFlow =
  | { kind: 'create'; projectId: string }
  | { kind: 'edit-main'; mainBoardId: string }
  | { kind: 'edit-application'; applicationBoardId: string }
  | null;

const ProjectDetailScreen = (): ReactElement => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const zero = useZero();

  // Initial tab can be overridden via `navigate(..., { state: { tab } })` —
  // ReleaseDetailScreen's "Back" button uses this to return to the Releases tab
  // instead of the default Boards tab.
  const initialTab = (location.state as { tab?: TabValue } | null)?.tab ?? 'boards';
  const [activeTab, setActiveTab] = useState<TabValue>(initialTab);
  const [showEditProjectModal, setShowEditProjectModal] = useState(false);
  const [showCreateBoardModal, setShowCreateBoardModal] = useState(false);
  const [showBoardEditModal, setShowBoardEditModal] = useState(false);
  const [showReleaseConfigModal, setShowReleaseConfigModal] = useState(false);
  const [releaseBoardFlow, setReleaseBoardFlow] = useState<ReleaseBoardFlow>(null);
  const [createdBoardId, setCreatedBoardId] = useState<string | null>(null);
  const [createdBoardData, setCreatedBoardData] = useState<BoardData | null>(null);
  const [duplicatingBoard, setDuplicatingBoard] = useState<BoardWithStages | null>(null);
  const [editingBoard, setEditingBoard] = useState<BoardWithStages | null>(null);
  const [configuringStagesForBoard, setConfiguringStagesForBoard] =
    useState<BoardWithStages | null>(null);
  const [boardIdToEdit, setBoardIdToEdit] = useState<string | null>(null);

  // Fetch project details
  const [project] = useCachedQuery(queries.projectById({ projectId: projectId || '' }), {
    enabled: !!projectId,
  });

  // Fetch boards for this project (lightweight list without stages)
  const [boards] = useCachedQuery(queries.boardsListByProject({ projectId: projectId || '' }), {
    enabled: !!projectId,
  });

  // Fetch the project's applications to distinguish main release boards from
  // per-application release boards. Keyed on projectId (stable arg, no
  // boards->applications waterfall, no view re-registration when boards change).
  const [applications, applicationsStatus] = useCachedQuery(
    queries.applicationsByProjectId({ projectId: projectId || '' }),
    { enabled: !!projectId },
  );
  // boardId is @unique on Application, so a board maps to at most one app. This
  // map serves the per-board lookup the (now-removed) applicationByBoardId query
  // used to do — the project's full app list is already synced here.
  const applicationByBoardId = useMemo(() => {
    const list = !applications || applications instanceof Error ? [] : applications;
    return new Map(list.filter(app => app.boardId).map(app => [app.boardId, app] as const));
  }, [applications]);

  const applicationBoardIds = useMemo(
    () => new Set(applicationByBoardId.keys()),
    [applicationByBoardId],
  );
  const boardNamesById = useMemo(
    () => Object.fromEntries((boards ?? []).map(board => [board.id, board.name])),
    [boards],
  );

  // Lazy load full board details (with prStatusMappings) when user clicks edit
  const [fullBoardDetails, fullBoardDetailsStatus] = useCachedQuery(
    queries.boardFullDetailById({ boardId: boardIdToEdit || '' }),
    { enabled: !!boardIdToEdit },
  );
  // Derived from the already-synced project app list (boardId is @unique), so no
  // separate board->application query / waterfall is needed.
  const applicationForEditedBoard = boardIdToEdit
    ? (applicationByBoardId.get(boardIdToEdit) ?? null)
    : null;

  // Release-board ownership is resolved through Application.boardId. A release
  // board with no matching application is the main board for its release group.
  useEffect(() => {
    if (!fullBoardDetails || !boardIdToEdit || fullBoardDetailsStatus.type !== 'complete') {
      return;
    }

    if (fullBoardDetails.boardType !== BoardType.RELEASE) {
      setEditingBoard(fullBoardDetails as BoardWithStages);
      return;
    }

    // Gate on the project app list being fully synced; until then the boardId
    // lookup could falsely resolve to "no application" and mis-route to edit-main.
    if (applicationsStatus.type !== 'complete') return;

    setReleaseBoardFlow(
      applicationForEditedBoard
        ? { kind: 'edit-application', applicationBoardId: boardIdToEdit }
        : { kind: 'edit-main', mainBoardId: boardIdToEdit },
    );
    setShowReleaseConfigModal(true);
    // Ownership has been resolved. Clearing this prevents board updates made by
    // the following screens from retriggering this routing effect.
    setBoardIdToEdit(null);
  }, [
    applicationForEditedBoard,
    applicationsStatus.type,
    boardIdToEdit,
    fullBoardDetails,
    fullBoardDetailsStatus.type,
  ]);

  const loading = project === undefined || boards === undefined;

  // Early return if no projectId
  if (!projectId) {
    return (
      <div className='h-full bg-muted flex items-center justify-center'>
        <div className='text-center'>
          <p className='text-muted-foreground mb-4'>Invalid project ID</p>
          <Button
            variant='default'
            onClick={() => void navigate('/listProjects')}
            data-track-category='ProjectDetail'
            data-track-name='BackToProjectsInvalidId'
          >
            Back to Projects
          </Button>
        </div>
      </div>
    );
  }

  // Lazy load full board details when user clicks edit
  const handleEditBoard = (board: BoardWithStages): void => {
    setBoardIdToEdit(board.id);
  };

  const handleUpdateProject = async (
    projectId: string,
    data: { name?: string; description?: string },
  ): Promise<void> => {
    const result = zero.mutate(
      mutators.project.update({
        projectId,
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        timestamp: Date.now(),
      }),
    );
    const res = await result.server;
    if (res.type === 'error') {
      toast.error('Action Failed', {
        description: res.error.message || 'You do not have permission to modify this.',
        duration: 5000,
      });
    } else {
      setShowEditProjectModal(false);
    }
  };

  if (loading) {
    return (
      <div className='h-full bg-muted flex items-center justify-center'>
        <p className='text-muted-foreground'>Loading...</p>
      </div>
    );
  }

  if (!project) {
    return (
      <div className='h-full bg-muted flex items-center justify-center'>
        <div className='text-center'>
          <p className='text-muted-foreground mb-4'>Project not found</p>
          <Button
            variant='default'
            onClick={() => void navigate('/listProjects')}
            data-track-category='ProjectDetail'
            data-track-name='BackToProjectsNotFound'
          >
            Back to Projects
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className='h-full bg-muted flex flex-col'>
      <div className='flex-1 overflow-auto p-8'>
        <div className='max-w-7xl mx-auto'>
          {/* Header with Back Button */}
          <button
            onClick={() => void navigate('/listProjects')}
            className='flex items-center gap-2 text-muted-foreground hover:text-foreground mb-6 transition-colors'
            data-track-category='ProjectDetail'
            data-track-name='BackToProjects'
          >
            <ArrowLeft size={20} />
            <span>Back to Projects</span>
          </button>

          {/* Project Details Section */}
          <div className='bg-background rounded-lg shadow-sm border border-border p-6 mb-8'>
            <div className='flex items-start justify-between'>
              <div className='flex-1'>
                <h1 className='text-3xl font-bold text-foreground mb-2'>{project.name}</h1>
                {project.description && (
                  <p className='text-muted-foreground mb-4'>{project.description}</p>
                )}
                <div className='text-sm text-muted-foreground'>
                  Created: {new Date(project.createdAt).toLocaleDateString()}
                </div>
              </div>
              <Button
                variant='secondary'
                onClick={() => setShowEditProjectModal(true)}
                data-track-category='ProjectDetail'
                data-track-name='EditProject'
                data-track-metadata={JSON.stringify({ projectId: project.id })}
              >
                <Edit2 size={16} />
                Edit Project
              </Button>
            </div>
          </div>

          {/* Tabs Navigation */}
          <div className='border-b border-border bg-background rounded-t-lg'>
            <Tabs.Root value={activeTab} onValueChange={value => setActiveTab(value as TabValue)}>
              <Tabs.List className='flex gap-0 px-6'>
                <TabTrigger value='boards' icon={LayoutGrid} label='Boards' />
                <TabTrigger value='release' icon={Rocket} label='Release' />
              </Tabs.List>
            </Tabs.Root>
          </div>

          {/* Tab Content */}
          <div className='bg-background rounded-b-lg shadow-sm border border-t-0 border-border p-6'>
            <Tabs.Root value={activeTab} onValueChange={value => setActiveTab(value as TabValue)}>
              <div className='mb-6 flex items-center justify-between'>
                <h2 className='text-2xl font-bold text-foreground'>
                  {activeTab === 'boards' ? 'Boards' : 'Releases'}
                </h2>
                {activeTab === 'boards' && (
                  <div className='flex items-center gap-2'>
                    <Button
                      variant='default'
                      onClick={() => setShowCreateBoardModal(true)}
                      data-track-category='ProjectDetail'
                      data-track-name='CreateBoard'
                      data-track-metadata={JSON.stringify({ projectId })}
                    >
                      Create Board
                    </Button>
                    <Button
                      variant='secondary'
                      onClick={() => {
                        setReleaseBoardFlow({ kind: 'create', projectId });
                        setShowReleaseConfigModal(true);
                      }}
                      data-track-category='ProjectDetail'
                      data-track-name='CreateReleaseBoard'
                      data-track-metadata={JSON.stringify({ projectId })}
                    >
                      <Rocket size={16} />
                      Create Release Board
                    </Button>
                  </div>
                )}
              </div>

              {/* Boards Tab Content */}
              <Tabs.Content value='boards' className='outline-none'>
                <BoardsTable
                  boards={boards}
                  onEdit={handleEditBoard}
                  applicationBoardIds={applicationBoardIds}
                />
              </Tabs.Content>

              <Tabs.Content value='release' className='outline-none'>
                <ReleasesSection projectId={projectId} />
              </Tabs.Content>
            </Tabs.Root>
          </div>
        </div>
      </div>

      {/* Create Board Modal (Template Selection) */}
      {showCreateBoardModal && projectId && (
        <BoardCreateScreen
          projectId={projectId}
          isOpen={true}
          onClose={() => setShowCreateBoardModal(false)}
          onSave={() => {
            setShowCreateBoardModal(false);
          }}
          onCreateNew={() => {
            setShowCreateBoardModal(false);
            setShowBoardEditModal(true);
          }}
          onDuplicate={board => {
            setShowCreateBoardModal(false);
            // Find full board data from boards list
            const fullBoard = boards?.find(b => b.id === board.id);
            if (fullBoard) {
              setDuplicatingBoard(fullBoard);
            }
          }}
        />
      )}

      {/* Create New Board (BoardEditScreen in create mode) */}
      {showBoardEditModal && projectId && !editingBoard && (
        <BoardEditScreen
          projectId={projectId}
          isOpen={true}
          mode={createdBoardId ? 'edit' : 'create'}
          {...(createdBoardId ? { boardId: createdBoardId } : {})}
          initialBoardName={createdBoardData?.name}
          onClose={() => {
            setShowBoardEditModal(false);
            // If we had created a board and went back, clear the created state on close
            if (createdBoardId) {
              setCreatedBoardId(null);
              setCreatedBoardData(null);
            }
            setReleaseBoardFlow(null);
          }}
          onSave={() => {
            // BoardEditScreen calls onNext immediately after a successful save.
            // Keep the board ID so onNext can transition into stage configuration.
          }}
          onNext={(board?: BoardData) => {
            if (board) {
              setCreatedBoardId(board.id);
              setCreatedBoardData(board);
            }
            setShowBoardEditModal(false);
          }}
          onBack={() => {
            setShowBoardEditModal(false);
            if (releaseBoardFlow) {
              setShowReleaseConfigModal(true);
            } else {
              setShowCreateBoardModal(false);
            }
          }}
        />
      )}

      {/* Configure Stages for Newly Created Board */}
      {createdBoardId && projectId && !showBoardEditModal && !showReleaseConfigModal && (
        <BoardStageConfigScreen
          boardId={createdBoardId}
          projectId={projectId}
          isOpen={true}
          initialBoard={createdBoardData}
          onClose={() => {
            setCreatedBoardId(null);
            setCreatedBoardData(null);
            setReleaseBoardFlow(null);
          }}
          onBack={() => {
            // The board already exists, so Back must edit the same board.
            setShowBoardEditModal(true);
          }}
          onSave={() => {
            setCreatedBoardId(null);
            setCreatedBoardData(null);
            setReleaseBoardFlow(null);
          }}
        />
      )}

      {/* Duplicate Board Modal */}
      {duplicatingBoard && projectId && (
        <BoardEditScreen
          projectId={projectId}
          isOpen={true}
          mode='create'
          initialBoardName={`${duplicatingBoard.name} - V2`}
          sourceBoardId={duplicatingBoard.id}
          onClose={() => setDuplicatingBoard(null)}
          onSave={() => {
            setDuplicatingBoard(null);
          }}
          onNext={(board?: BoardData) => {
            if (board) {
              setCreatedBoardId(board.id);
              setCreatedBoardData(board);
            }
            setDuplicatingBoard(null);
          }}
        />
      )}

      {/* Edit Board Modal */}
      {editingBoard && projectId && !configuringStagesForBoard && (
        <BoardEditScreen
          boardId={editingBoard.id}
          projectId={projectId}
          isOpen={true}
          onClose={() => {
            setEditingBoard(null);
            setBoardIdToEdit(null);
          }}
          onSave={() => {
            setEditingBoard(null);
            setBoardIdToEdit(null);
          }}
          onNext={() => {
            setConfiguringStagesForBoard(editingBoard);
            setEditingBoard(null);
          }}
        />
      )}

      {/* Configure Stages Modal */}
      {configuringStagesForBoard && projectId && (
        <BoardStageConfigScreen
          boardId={configuringStagesForBoard.id}
          projectId={projectId}
          isOpen={true}
          onClose={() => {
            setConfiguringStagesForBoard(null);
            setBoardIdToEdit(null);
          }}
          onBack={() => {
            setEditingBoard(configuringStagesForBoard);
            setConfiguringStagesForBoard(null);
          }}
          onSave={() => {
            setConfiguringStagesForBoard(null);
            setBoardIdToEdit(null);
          }}
        />
      )}

      {/* Release-board creation begins here, then continues through the existing
          board fields/ticket preview and stage configuration screens. */}
      {showReleaseConfigModal && projectId && releaseBoardFlow && (
        <ReleaseConfigWizard
          projectId={projectId}
          projectName={project.name}
          boardNamesById={boardNamesById}
          applications={applications instanceof Error ? undefined : applications}
          mode={releaseBoardFlow}
          isOpen={true}
          onClose={() => {
            setShowReleaseConfigModal(false);
            setReleaseBoardFlow(null);
            setBoardIdToEdit(null);
          }}
          onSave={targetBoard => {
            if (releaseBoardFlow.kind === 'edit-application') {
              // Application boards inherit their board fields and stages from
              // the main release board, so application edit ends after config.
              setShowReleaseConfigModal(false);
              setReleaseBoardFlow(null);
              return;
            }

            if (releaseBoardFlow.kind === 'create') {
              setReleaseBoardFlow({ kind: 'edit-main', mainBoardId: targetBoard.id });
            }
            setShowReleaseConfigModal(false);
            setCreatedBoardId(targetBoard.id);
            // The wizard only returns a partial board ({ id, name }). Let the
            // stage screen query the persisted board so it receives its stages.
            setCreatedBoardData(null);
            setShowBoardEditModal(true);
          }}
        />
      )}

      {/* Edit Project Modal */}
      <Dialog
        open={showEditProjectModal}
        onOpenChange={setShowEditProjectModal}
        title='Edit Project'
      >
        <div className='p-6'>
          <ProjectForm
            project={project}
            onSubmit={data => handleUpdateProject(project.id, data)}
            onCancel={() => setShowEditProjectModal(false)}
          />
        </div>
      </Dialog>
    </div>
  );
};

const TabTrigger = ({
  value,
  icon: Icon,
  label,
}: {
  value: TabValue;
  icon: React.ElementType;
  label: string;
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
  </Tabs.Trigger>
);

ProjectDetailScreen.displayName = 'ProjectDetailScreen';

export default ProjectDetailScreen;
