import { ReactElement, useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import {
  BoardType,
  deserializeFlowPlan,
  inferRepositoryNameFromUrl,
  type FlowPlan,
} from '@xyne/shared';
import { ArrowLeft, Edit2, GitBranch, LayoutGrid, Rocket } from 'lucide-react';
import { BoardsTable, type BoardWithStages } from '../../components/Board';
import * as Tabs from '@radix-ui/react-tabs';

import BoardEditScreen from '../../components/Board/BoardEditScreen/BoardEditScreen';
import BoardStageConfigScreen from '../../components/Board/BoardStageConfigScreen/BoardStageConfigScreen';
import { BoardRolesConfigScreen } from '../../components/Board/BoardRolesConfigScreen';
import { BoardConfigCopyScreen } from '../../components/Board/BoardConfigCopyScreen';
import BoardCreateScreen from '../../components/Board/BoardCreateScreen/BoardCreateScreen';
import { BoardTypeChooserDialog } from '../../components/Board/BoardTypeChooserDialog/BoardTypeChooserDialog';
import { FlowBoardCreateScreen } from '../../components/Board/FlowBoardCreateScreen/FlowBoardCreateScreen';
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
import { apiInstance } from '../../services/clients/apiClient';
import { ProjectRepositoriesSection } from './ProjectRepositoriesSection';

// Type for board data passed from BoardEditScreen to BoardStageConfigScreen
interface BoardData {
  id: string;
  name?: string;
  [key: string]: unknown;
}

type TabValue = 'boards' | 'repos' | 'release';
type ReleaseBoardFlow =
  | { kind: 'create'; projectId: string }
  | { kind: 'edit-main'; mainBoardId: string }
  | { kind: 'edit-application'; applicationBoardId: string }
  | null;

const getNextClonedBoardName = (
  sourceName: string,
  existingBoardNames: readonly string[],
): string => {
  const baseName = sourceName.replace(/\s+-\s+V\d+$/i, '').trim() || sourceName.trim();
  const existingNames = new Set(existingBoardNames.map(name => name.trim().toLowerCase()));

  for (let version = 2; version <= existingNames.size + 2; version += 1) {
    const candidate = `${baseName} - V${version}`;
    if (!existingNames.has(candidate.toLowerCase())) {
      return candidate;
    }
  }

  return `${baseName} - V${existingNames.size + 2}`;
};

const ProjectDetailScreen = (): ReactElement => {
  const { workspaceId, projectId } = useParams<{ workspaceId: string; projectId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const zero = useZero();

  // Initial tab can be overridden via `navigate(..., { state: { tab } })` —
  // ReleaseDetailScreen's "Back" button uses this to return to the Releases tab
  // instead of the default Boards tab.
  const initialTab = (location.state as { tab?: TabValue } | null)?.tab ?? 'boards';
  const [activeTab, setActiveTab] = useState<TabValue>(initialTab);
  const [showEditProjectModal, setShowEditProjectModal] = useState(false);
  const [showAddRepositoryModal, setShowAddRepositoryModal] = useState(false);
  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [repositoryName, setRepositoryName] = useState('');
  const [repositoryNameEdited, setRepositoryNameEdited] = useState(false);
  const [repositoryBranch, setRepositoryBranch] = useState('main');
  const [addingRepository, setAddingRepository] = useState(false);
  const [repositoryRefreshKey, setRepositoryRefreshKey] = useState(0);
  const [showCreateBoardModal, setShowCreateBoardModal] = useState(false);
  const [showBoardTypeChooser, setShowBoardTypeChooser] = useState(false);
  const [showFlowBoardCreate, setShowFlowBoardCreate] = useState(false);
  const [showBoardEditModal, setShowBoardEditModal] = useState(false);
  const [showReleaseConfigModal, setShowReleaseConfigModal] = useState(false);
  const [releaseBoardFlow, setReleaseBoardFlow] = useState<ReleaseBoardFlow>(null);
  const [createdBoardId, setCreatedBoardId] = useState<string | null>(null);
  const [createdBoardData, setCreatedBoardData] = useState<BoardData | null>(null);
  const [duplicatingBoard, setDuplicatingBoard] = useState<BoardWithStages | null>(null);
  const [editingBoard, setEditingBoard] = useState<BoardWithStages | null>(null);
  const [editingFlowBoard, setEditingFlowBoard] = useState<BoardWithStages | null>(null);
  const [cloningFlowBoard, setCloningFlowBoard] = useState<BoardWithStages | null>(null);
  const [configuringStagesForBoard, setConfiguringStagesForBoard] =
    useState<BoardWithStages | null>(null);
  const [configuringRolesForBoardId, setConfiguringRolesForBoardId] = useState<string | null>(null);
  const [boardIdToEdit, setBoardIdToEdit] = useState<string | null>(null);
  const [copyConfigTargetBoard, setCopyConfigTargetBoard] = useState<BoardWithStages | null>(null);

  // Fetch project details
  const [project] = useCachedQuery(queries.projectById({ projectId: projectId || '' }), {
    enabled: !!projectId,
  });

  // Fetch boards for this project (lightweight list without stages)
  const [boards] = useCachedQuery(queries.boardsListByProject({ projectId: projectId || '' }), {
    enabled: !!projectId,
  });

  // Consume the Ticket view's edit-board intent once.
  const requestedEditBoardId = searchParams.get('editBoard');
  useEffect(() => {
    if (!requestedEditBoardId || !boards) return;

    setActiveTab('boards');
    const board = boards.find(candidate => candidate.id === requestedEditBoardId);
    if (board?.boardType === BoardType.FLOW) {
      setEditingFlowBoard(board);
    } else if (board) {
      setBoardIdToEdit(board.id);
    }

    setSearchParams(
      current => {
        const next = new URLSearchParams(current);
        next.delete('editBoard');
        return next;
      },
      { replace: true },
    );
  }, [boards, requestedEditBoardId, setSearchParams]);

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

  const editingFlowBoardPlan = useMemo<FlowPlan | null>(() => {
    if (!editingFlowBoard) return null;
    if (!editingFlowBoard.flowPlan) {
      return { version: 2, nodes: [], groups: [], decisions: [], updatedAt: 0 };
    }
    return deserializeFlowPlan(editingFlowBoard.flowPlan);
  }, [editingFlowBoard]);

  const cloningFlowBoardPlan = useMemo<FlowPlan | null>(() => {
    if (!cloningFlowBoard) return null;
    if (!cloningFlowBoard.flowPlan) {
      return { version: 2, nodes: [], groups: [], decisions: [], updatedAt: 0 };
    }
    return deserializeFlowPlan(cloningFlowBoard.flowPlan);
  }, [cloningFlowBoard]);

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

  // Lazy load full board details when user clicks edit. Flow boards skip the
  // normal edit form — their only editable thing is the step plan.
  const handleEditBoard = (board: BoardWithStages): void => {
    if (board.boardType === BoardType.FLOW) {
      setEditingFlowBoard(board);
      return;
    }
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

  // A repository label, not a channel name: repositories no longer create a
  // channel, and a space names itself when it is created.
  const repositoryNameError =
    repositoryName && repositoryName.length > 120 ? 'Keep the name under 120 characters' : null;

  const handleRepositoryUrlChange = (value: string): void => {
    setRepositoryUrl(value);
    if (repositoryNameEdited) return;
    setRepositoryName(inferRepositoryNameFromUrl(value) ?? '');
  };

  const closeAddRepositoryModal = (): void => {
    setShowAddRepositoryModal(false);
    setRepositoryUrl('');
    setRepositoryName('');
    setRepositoryNameEdited(false);
  };

  const handleAddRepository = async (): Promise<void> => {
    if (!repositoryUrl.trim() || repositoryNameError || !repositoryName) return;
    setAddingRepository(true);
    try {
      await apiInstance.post('/sdlc/repositories', {
        projectId,
        url: repositoryUrl.trim(),
        name: repositoryName,
        baseBranch: repositoryBranch.trim() || 'main',
      });
      toast.success('Repository attached');
      closeAddRepositoryModal();
      setActiveTab('repos');
      setRepositoryRefreshKey(value => value + 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to attach repository');
    } finally {
      setAddingRepository(false);
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
            type='button'
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
              <div className='flex gap-2'>
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
          </div>

          {/* Tabs Navigation */}
          <div className='border-b border-border bg-background rounded-t-lg'>
            <Tabs.Root value={activeTab} onValueChange={value => setActiveTab(value as TabValue)}>
              <Tabs.List className='flex gap-0 px-6'>
                <TabTrigger value='boards' icon={LayoutGrid} label='Boards' />
                <TabTrigger value='repos' icon={GitBranch} label='Repos' />
                <TabTrigger value='release' icon={Rocket} label='Release' />
              </Tabs.List>
            </Tabs.Root>
          </div>

          {/* Tab Content */}
          <div className='bg-background rounded-b-lg shadow-sm border border-t-0 border-border p-6'>
            <Tabs.Root value={activeTab} onValueChange={value => setActiveTab(value as TabValue)}>
              <div className='mb-6 flex items-center justify-between'>
                <h2 className='text-2xl font-bold text-foreground'>
                  {activeTab === 'boards'
                    ? 'Boards'
                    : activeTab === 'repos'
                      ? 'Repositories'
                      : 'Releases'}
                </h2>
                {activeTab === 'boards' && (
                  <Button
                    variant='default'
                    onClick={() => setShowBoardTypeChooser(true)}
                    data-track-category='ProjectDetail'
                    data-track-name='CreateBoard'
                    data-track-metadata={JSON.stringify({ projectId })}
                  >
                    Create Board
                  </Button>
                )}
                {activeTab === 'repos' && (
                  <Button onClick={() => setShowAddRepositoryModal(true)}>
                    <GitBranch size={16} /> Add Repository
                  </Button>
                )}
              </div>

              {/* Boards Tab Content */}
              <Tabs.Content value='boards' className='outline-none'>
                <BoardsTable
                  boards={boards}
                  onEdit={handleEditBoard}
                  onClone={board => setCloningFlowBoard(board)}
                  onCopyConfig={board => setCopyConfigTargetBoard(board)}
                  applicationBoardIds={applicationBoardIds}
                  applicationByBoardId={applicationByBoardId}
                  {...(workspaceId && projectId
                    ? {
                        onBoardClick: (board: BoardWithStages) =>
                          void navigate(`/${workspaceId}/projects/${projectId}/${board.id}`),
                      }
                    : {})}
                />
              </Tabs.Content>

              <Tabs.Content value='release' className='outline-none'>
                <ReleasesSection projectId={projectId} />
              </Tabs.Content>
              <Tabs.Content value='repos' className='outline-none'>
                <ProjectRepositoriesSection
                  projectId={projectId}
                  refreshKey={repositoryRefreshKey}
                  onAdd={() => setShowAddRepositoryModal(true)}
                />
              </Tabs.Content>
            </Tabs.Root>
          </div>
        </div>
      </div>

      {showBoardTypeChooser && projectId && (
        <BoardTypeChooserDialog
          isOpen={true}
          onClose={() => setShowBoardTypeChooser(false)}
          onChooseFlow={() => {
            setShowBoardTypeChooser(false);
            setShowFlowBoardCreate(true);
          }}
          onChooseStandard={() => {
            setShowBoardTypeChooser(false);
            setShowCreateBoardModal(true);
          }}
          onChooseRelease={() => {
            setShowBoardTypeChooser(false);
            setReleaseBoardFlow({ kind: 'create', projectId });
            setShowReleaseConfigModal(true);
          }}
        />
      )}

      {showFlowBoardCreate && projectId && (
        <FlowBoardCreateScreen
          projectId={projectId}
          isOpen={true}
          onClose={() => setShowFlowBoardCreate(false)}
        />
      )}

      {editingFlowBoardPlan && editingFlowBoard && projectId && (
        <FlowBoardCreateScreen
          projectId={projectId}
          isOpen={true}
          onClose={() => setEditingFlowBoard(null)}
          editBoard={{
            id: editingFlowBoard.id,
            name: editingFlowBoard.name,
            description: editingFlowBoard.description,
            nodes: editingFlowBoardPlan.nodes,
            groups: editingFlowBoardPlan.groups ?? [],
            decisions: editingFlowBoardPlan.decisions ?? [],
          }}
        />
      )}

      {cloningFlowBoardPlan && cloningFlowBoard && projectId && (
        <FlowBoardCreateScreen
          projectId={projectId}
          isOpen={true}
          onClose={() => setCloningFlowBoard(null)}
          cloneBoard={{
            name: getNextClonedBoardName(
              cloningFlowBoard.name,
              (boards ?? []).map(board => board.name),
            ),
            description: cloningFlowBoard.description,
            nodes: cloningFlowBoardPlan.nodes,
            groups: cloningFlowBoardPlan.groups ?? [],
            decisions: cloningFlowBoardPlan.decisions ?? [],
          }}
        />
      )}

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
      {createdBoardId &&
        projectId &&
        !showBoardEditModal &&
        !showReleaseConfigModal &&
        !configuringRolesForBoardId && (
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
            onNext={() => {
              setConfiguringRolesForBoardId(createdBoardId);
            }}
            onSave={() => {
              setCreatedBoardId(null);
              setCreatedBoardData(null);
              setReleaseBoardFlow(null);
            }}
          />
        )}

      {/* Configure Roles for Newly Created Board */}
      {configuringRolesForBoardId && createdBoardId && projectId && (
        <BoardRolesConfigScreen
          boardId={createdBoardId}
          isOpen={true}
          onClose={() => {
            setConfiguringRolesForBoardId(null);
            setCreatedBoardId(null);
            setCreatedBoardData(null);
            setReleaseBoardFlow(null);
          }}
          onBack={() => {
            setConfiguringRolesForBoardId(null);
          }}
          onSave={() => {
            setConfiguringRolesForBoardId(null);
            setCreatedBoardId(null);
            setCreatedBoardData(null);
            setReleaseBoardFlow(null);
          }}
        />
      )}

      {/* Clone Board Modal */}
      {duplicatingBoard && projectId && (
        <BoardEditScreen
          projectId={projectId}
          isOpen={true}
          mode='create'
          initialBoardName={getNextClonedBoardName(
            duplicatingBoard.name,
            (boards ?? []).map(board => board.name),
          )}
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
      {configuringStagesForBoard && projectId && !configuringRolesForBoardId && (
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
          onNext={() => {
            setConfiguringRolesForBoardId(configuringStagesForBoard.id);
          }}
          onSave={() => {
            setConfiguringStagesForBoard(null);
            setBoardIdToEdit(null);
          }}
        />
      )}

      {/* Configure Roles Modal (existing board) */}
      {configuringRolesForBoardId && configuringStagesForBoard && projectId && (
        <BoardRolesConfigScreen
          boardId={configuringStagesForBoard.id}
          isOpen={true}
          onClose={() => {
            setConfiguringRolesForBoardId(null);
            setConfiguringStagesForBoard(null);
            setBoardIdToEdit(null);
          }}
          onBack={() => {
            setConfiguringRolesForBoardId(null);
          }}
          onSave={() => {
            setConfiguringRolesForBoardId(null);
            setConfiguringStagesForBoard(null);
            setBoardIdToEdit(null);
          }}
        />
      )}

      {/* Copy Board Configuration Modal */}
      {copyConfigTargetBoard && projectId && (
        <BoardConfigCopyScreen
          targetBoardId={copyConfigTargetBoard.id}
          targetBoardName={copyConfigTargetBoard.name}
          projectId={projectId}
          isOpen={true}
          onClose={() => setCopyConfigTargetBoard(null)}
          onDone={() => setCopyConfigTargetBoard(null)}
        />
      )}

      {/* Release-board creation begins here, then continues through the existing
          board fields/ticket preview and stage configuration screens. */}
      {showReleaseConfigModal && projectId && releaseBoardFlow && (
        <ReleaseConfigWizard
          projectId={projectId}
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

      <Dialog
        open={showAddRepositoryModal}
        onOpenChange={open => (open ? setShowAddRepositoryModal(true) : closeAddRepositoryModal())}
        title='Add Repository'
        description='Create a private SDLC hub for this repository'
      >
        <form
          className='p-6'
          onSubmit={event => {
            event.preventDefault();
            void handleAddRepository();
          }}
        >
          <h2 className='text-lg font-semibold'>Add Repository</h2>
          <p className='mt-1 text-sm text-muted-foreground'>
            Creates the hub, then runs a non-mutating access check. Baseline generation starts only
            after you click Next.
          </p>
          <label htmlFor='sdlc-repository-url' className='mt-5 block text-sm font-medium'>
            Repository URL
          </label>
          <input
            id='sdlc-repository-url'
            autoFocus
            required
            value={repositoryUrl}
            onChange={event => handleRepositoryUrlChange(event.target.value)}
            className='mt-2 h-10 w-full rounded-md border bg-background px-3 outline-none focus:ring-2 focus:ring-ring'
            placeholder='https://github.com/org/repository.git'
            data-track-category='ProjectDetail'
            data-track-name='RepositoryUrlChanged'
          />
          <label htmlFor='sdlc-repository-name' className='mt-4 block text-sm font-medium'>
            Repository name
          </label>
          <input
            id='sdlc-repository-name'
            required
            value={repositoryName}
            onChange={event => {
              setRepositoryNameEdited(true);
              setRepositoryName(event.target.value);
            }}
            className={cn(
              'mt-2 h-10 w-full rounded-md border bg-background px-3 outline-none focus:ring-2 focus:ring-ring',
              repositoryNameError && 'border-destructive focus:ring-destructive',
            )}
            data-track-category='ProjectDetail'
            data-track-name='RepositoryNameChanged'
          />
          <p
            className={cn(
              'mt-1 text-xs',
              repositoryNameError ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {repositoryNameError ?? 'How this repository is labelled in SDLC spaces.'}
          </p>
          <div className='mt-4'>
            <label htmlFor='sdlc-repository-branch' className='block text-sm font-medium'>
              Base branch
            </label>
            <input
              id='sdlc-repository-branch'
              value={repositoryBranch}
              onChange={event => setRepositoryBranch(event.target.value)}
              className='mt-2 h-10 w-full rounded-md border bg-background px-3'
              data-track-category='ProjectDetail'
              data-track-name='RepositoryBranchChanged'
            />
          </div>
          <div className='mt-6 flex justify-end gap-2'>
            <Button type='button' variant='outline' onClick={closeAddRepositoryModal}>
              Cancel
            </Button>
            <Button
              type='submit'
              loading={addingRepository}
              disabled={!repositoryUrl.trim() || !repositoryName || Boolean(repositoryNameError)}
            >
              Add repository
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
};

const TabTrigger = ({
  value,
  icon,
  label,
}: {
  value: TabValue;
  icon: React.ElementType;
  label: string;
}): ReactElement => {
  const Icon = icon;
  return (
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
};

ProjectDetailScreen.displayName = 'ProjectDetailScreen';

export default ProjectDetailScreen;
