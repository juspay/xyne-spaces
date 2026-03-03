import { ReactElement, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useZero } from '../../hooks/useZero';
import type { ReadonlyJSONValue } from '@rocicorp/zero';
import { toast } from 'sonner';
import { ArrowLeft, Edit2 } from 'lucide-react';
import { BoardForm, BoardsTable, type BoardWithStages } from '../../components/Board';
import type { CreateBoardFormData } from '../../components/Board/BoardForm';
import { ProjectForm } from '../../components/Project';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog/Dialog';
import { apiInstance } from '../../services/clients/apiClient';
import { queries } from '../../zero/queries';
import { mutators } from '../../zero/mutators';
import { FormContextType, PRStatusEvent } from '@xyne/shared';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { v4 as uuidv4 } from 'uuid';

const ProjectDetailScreen = (): ReactElement => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const zero = useZero();

  const [showCreateBoardModal, setShowCreateBoardModal] = useState(false);
  const [showEditProjectModal, setShowEditProjectModal] = useState(false);
  const [editingBoard, setEditingBoard] = useState<BoardWithStages | null>(null);

  // Fetch project details
  const [project] = useCachedQuery(queries.projectById({ projectId: projectId || '' }), {
    enabled: !!projectId,
  });

  // Fetch boards for this project
  const [boards] = useCachedQuery(queries.boardsByProject({ projectId: projectId || '' }), {
    enabled: !!projectId,
  });

  // Fetch all forms for form mapping processing
  const [allForms] = useCachedQuery(
    queries.getFormsByContextType({ contextType: FormContextType.BOARD }),
  );

  const loading = project === undefined || boards === undefined;

  // Early return if no projectId
  if (!projectId) {
    return (
      <div className='h-full bg-gray-50 flex items-center justify-center'>
        <div className='text-center'>
          <p className='text-gray-600 mb-4'>Invalid project ID</p>
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

  const handleCreateBoard = async (data: CreateBoardFormData): Promise<void> => {
    await apiInstance.post('/boards', data);
    setShowCreateBoardModal(false);
  };

  const handleUpdateBoard = async (
    boardId: string,
    data: {
      name?: string;
      description?: string;
      projectId?: string;
      metadata?: ReadonlyJSONValue;
      stages?: Array<{
        id?: string;
        name: string;
        eta?: number;
        sequenceNumber: number;
        defaultTicketStatusV2?: string;
        prStatuses?: PRStatusEvent[];
        formId?: string;
      }>;
      formIds?: string[] | null;
      stageFormMappings?: Array<{
        stageId: string;
        formId: string;
        mappingId: string;
      }>;
      stageApprovers?: Array<{
        stageId: string;
        approverIds: string[];
      }>;
    },
  ): Promise<void> => {
    // Preserve existing stage IDs, only generate new IDs for stages without one
    const stageIds = data.stages?.reduce(
      (acc, stage) => {
        acc[stage.sequenceNumber] = stage.id || uuidv4();
        return acc;
      },
      {} as Record<string, string>,
    );

    // Generate IDs for PR status mappings
    const prStatusMappingIds = data.stages?.reduce(
      (acc, stage) => {
        stage.prStatuses?.forEach(prStatus => {
          acc[`${stage.sequenceNumber}-${prStatus}`] = uuidv4();
        });
        return acc;
      },
      {} as Record<string, string>,
    );
    // Build stageFormMappings using the preserved/new stageIds
    // Use the stageFormMappings passed from BoardForm, or build from stages if not provided
    const stageFormMappings: Array<{ stageId: string; formId: string; mappingId: string }> =
      data.stageFormMappings ||
      (() => {
        const mappings: Array<{ stageId: string; formId: string; mappingId: string }> = [];
        if (data.stages && stageIds) {
          data.stages.forEach(stage => {
            if (stage.formId) {
              const stageId = stage.id || stageIds[stage.sequenceNumber];
              if (stageId) {
                mappings.push({
                  stageId,
                  formId: stage.formId,
                  mappingId: uuidv4(),
                });
              }
            }
          });
        }
        return mappings;
      })();

    // Build stageApprovers with resolved stage IDs
    // sa.stageId is either:
    // - The actual stage UUID (for existing stages)
    // - The sequenceNumber as string (for new stages, which will be looked up in stageIds)
    const stageApprovers =
      data.stageApprovers
        ?.map(sa => {
          const resolvedStageId = stageIds?.[sa.stageId] || sa.stageId;
          if (!resolvedStageId) {
            return null;
          }
          return {
            stageId: resolvedStageId,
            approverIds: sa.approverIds,
          };
        })
        .filter((sa): sa is { stageId: string; approverIds: string[] } => sa !== null) || [];

    const boardMutation = zero.mutate(
      mutators.board.update({
        boardId,
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.projectId !== undefined && { projectId: data.projectId }),
        ...(data.metadata !== undefined && { metadata: data.metadata }),
        ...(data.stages !== undefined && { stages: data.stages }),
        ...(stageIds !== undefined && { stageIds }),
        ...(prStatusMappingIds !== undefined && { prStatusMappingIds }),
        ...(stageFormMappings.length > 0 && { stageFormMappings }),
        ...(stageApprovers.length > 0 && { stageApprovers }),
        timestamp: Date.now(),
      }),
    );

    const res = await boardMutation.server;
    if (res.type === 'error') {
      toast.error('Action Failed', {
        description: res.error.message || 'You do not have permission to modify this.',
        duration: 5000,
      });
      return;
    }

    // Handle form mappings
    if (data.formIds !== undefined && allForms) {
      const forms = allForms;

      // Get currently mapped form IDs
      const currentFormIds = forms
        .filter(form =>
          form.formContextMappings?.some(
            mapping =>
              mapping.contextId === boardId && mapping.contextType === FormContextType.BOARD,
          ),
        )
        .map(form => form.id);

      const newFormIds = data.formIds || [];

      // Determine forms to add and remove
      const toAdd = newFormIds.filter((id: string) => !currentFormIds.includes(id));
      const toRemove = currentFormIds.filter((id: string) => !newFormIds.includes(id));

      const mappingPromises: Promise<unknown>[] = [];

      toRemove.forEach((formId: string) => {
        const form = forms.find(f => f.id === formId);
        if (form) {
          const res = zero.mutate(
            mutators.formContextMapping.delete({
              contextId: boardId,
              contextType: FormContextType.BOARD,
              entityType: form.entityType,
            }),
          );
          mappingPromises.push(res.server);
        }
      });

      // Add mappings for newly selected forms
      toAdd.forEach((formId: string) => {
        const form = forms.find(f => f.id === formId);
        if (form) {
          const res = zero.mutate(
            mutators.formContextMapping.upsert({
              contextId: boardId,
              contextType: FormContextType.BOARD,
              entityType: form.entityType,
              formId,
              mappingId: uuidv4(),
            }),
          );
          mappingPromises.push(res.server);
        }
      });

      await Promise.all(mappingPromises);
    }

    setEditingBoard(null);
  };

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
      <div className='h-full bg-gray-50 flex items-center justify-center'>
        <p className='text-gray-600'>Loading...</p>
      </div>
    );
  }

  if (!project) {
    return (
      <div className='h-full bg-gray-50 flex items-center justify-center'>
        <div className='text-center'>
          <p className='text-gray-600 mb-4'>Project not found</p>
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
    <div className='h-full bg-gray-50 p-8'>
      <div className='max-w-7xl mx-auto'>
        {/* Header with Back Button */}
        <button
          onClick={() => void navigate('/listProjects')}
          className='flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 transition-colors'
          data-track-category='ProjectDetail'
          data-track-name='BackToProjects'
        >
          <ArrowLeft size={20} />
          <span>Back to Projects</span>
        </button>

        {/* Project Details Section */}
        <div className='bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-8'>
          <div className='flex items-start justify-between'>
            <div className='flex-1'>
              <h1 className='text-3xl font-bold text-gray-900 mb-2'>{project.name}</h1>
              {project.description && <p className='text-gray-600 mb-4'>{project.description}</p>}
              <div className='text-sm text-gray-500'>
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
          <h2 className='text-2xl font-bold text-gray-900'>Boards</h2>
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
          onEdit={setEditingBoard}
          onDelete={boardId => void handleDeleteBoard(boardId)}
        />
      </div>

      {/* Create Board Modal */}
      <Dialog
        open={showCreateBoardModal}
        onOpenChange={setShowCreateBoardModal}
        title='Create New Board'
      >
        <div className='p-6'>
          <BoardForm
            onSubmit={data => handleCreateBoard({ ...data, projectId } as CreateBoardFormData)}
            onCancel={() => setShowCreateBoardModal(false)}
            projectId={projectId}
          />
        </div>
      </Dialog>

      {/* Edit Board Modal */}
      {editingBoard && (
        <Dialog
          open={true}
          onOpenChange={open => !open && setEditingBoard(null)}
          title='Edit Board'
        >
          <div className='p-6'>
            <BoardForm
              board={editingBoard}
              onSubmit={data => handleUpdateBoard(editingBoard.id, data)}
              onCancel={() => setEditingBoard(null)}
              projectId={projectId}
            />
          </div>
        </Dialog>
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
