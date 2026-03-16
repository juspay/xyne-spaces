import { ReactElement, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useZero } from '../../hooks/useZero';
import { toast } from 'sonner';
import { ArrowLeft, Edit2 } from 'lucide-react';
import { BoardsTable, type BoardWithStages } from '../../components/Board';

import BoardEditScreen from '../../components/Board/BoardEditScreen/BoardEditScreen';
import BoardStageConfigScreen from '../../components/Board/BoardStageConfigScreen/BoardStageConfigScreen';
import BoardCreateScreen from '../../components/Board/BoardCreateScreen/BoardCreateScreen';
import { ProjectForm } from '../../components/Project';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog/Dialog';
import { queries } from '../../zero/queries';
import { mutators } from '../../zero/mutators';
import { useCachedQuery } from '../../hooks/useCachedQuery';

// Type for board data passed from BoardEditScreen to BoardStageConfigScreen
interface BoardData {
  id: string;
  name?: string;
  [key: string]: unknown;
}

const ProjectDetailScreen = (): ReactElement => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const zero = useZero();

  const [showEditProjectModal, setShowEditProjectModal] = useState(false);
  const [showCreateBoardModal, setShowCreateBoardModal] = useState(false);
  const [showBoardEditModal, setShowBoardEditModal] = useState(false);
  const [createdBoardId, setCreatedBoardId] = useState<string | null>(null);
  const [createdBoardData, setCreatedBoardData] = useState<BoardData | null>(null);
  const [duplicatingBoard, setDuplicatingBoard] = useState<BoardWithStages | null>(null);
  const [editingBoard, setEditingBoard] = useState<BoardWithStages | null>(null);
  const [configuringStagesForBoard, setConfiguringStagesForBoard] =
    useState<BoardWithStages | null>(null);

  // Fetch project details
  const [project] = useCachedQuery(queries.projectById({ projectId: projectId || '' }), {
    enabled: !!projectId,
  });

  // Fetch boards for this project
  const [boards] = useCachedQuery(queries.boardsByProject({ projectId: projectId || '' }), {
    enabled: !!projectId,
  });

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

  const handleDeleteBoard = async (boardId: string): Promise<void> => {
    const result = zero.mutate(mutators.board.delete({ boardId }));
    const res = await result.server;
    if (res.type === 'error') {
      toast.error('Action Failed', {
        description: res.error.message || 'You do not have permission to delete this.',
        duration: 5000,
      });
    }
  };

  const handleEditBoard = (board: BoardWithStages): void => {
    setEditingBoard(board);
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
    <div className='h-full bg-muted p-8'>
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

        {/* Boards Section */}
        <div className='mb-6 flex items-center justify-between'>
          <h2 className='text-2xl font-bold text-foreground'>Boards</h2>
          <Button
            variant='default'
            onClick={() => setShowCreateBoardModal(true)}
            data-track-category='ProjectDetail'
            data-track-name='CreateBoard'
            data-track-metadata={JSON.stringify({ projectId })}
          >
            Create Board
          </Button>
        </div>

        <BoardsTable
          boards={boards}
          onEdit={handleEditBoard}
          onDelete={boardId => void handleDeleteBoard(boardId)}
        />
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
          }}
          onSave={() => {
            setShowBoardEditModal(false);
            setCreatedBoardId(null);
            setCreatedBoardData(null);
          }}
          onNext={(board?: BoardData) => {
            if (board) {
              setCreatedBoardId(board.id);
              setCreatedBoardData(board);
            }
            setShowBoardEditModal(false);
          }}
          onBack={() => {
            // When in create flow, close everything completely
            setShowBoardEditModal(false);
            setShowCreateBoardModal(false);
          }}
        />
      )}

      {/* Configure Stages for Newly Created Board */}
      {createdBoardId && projectId && (
        <BoardStageConfigScreen
          boardId={createdBoardId}
          projectId={projectId}
          isOpen={true}
          initialBoard={createdBoardData}
          onClose={() => {
            setCreatedBoardId(null);
            setCreatedBoardData(null);
          }}
          onBack={() => {
            // Go back to BoardEditScreen in create mode
            setShowBoardEditModal(true);
            setCreatedBoardId(null);
            // Keep createdBoardData so the form retains the board info
          }}
          onSave={() => {
            setCreatedBoardId(null);
            setCreatedBoardData(null);
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
          onClose={() => setEditingBoard(null)}
          onSave={() => {
            setEditingBoard(null);
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
          onClose={() => setConfiguringStagesForBoard(null)}
          onBack={() => {
            setEditingBoard(configuringStagesForBoard);
            setConfiguringStagesForBoard(null);
          }}
          onSave={() => {
            setConfiguringStagesForBoard(null);
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

ProjectDetailScreen.displayName = 'ProjectDetailScreen';

export default ProjectDetailScreen;
