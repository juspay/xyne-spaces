import { ReactElement, useState } from 'react';
import { useZero } from '../../hooks/useZero';
import type { ReadonlyJSONValue } from '@rocicorp/zero';
import type { BoardType } from '@xyne/shared';
import { BoardForm, BoardsGrid, PageHeader, type BoardWithStages } from '../../components/Board';
import { Dialog } from '../../components/ui/Dialog/Dialog';
import { apiInstance } from '../../services/clients/apiClient';
import { queries } from '../../zero/queries';
import { mutators } from '../../zero/mutators';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { v4 as uuidv4 } from 'uuid';
import { PRStatusEvent } from '@xyne/shared';

const BoardsScreen = (): ReactElement => {
  const zero = useZero();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingBoard, setEditingBoard] = useState<BoardWithStages | null>(null);

  // Fetch all boards using zero
  const [boards] = useCachedQuery(queries.getAllBoards());

  const loading = boards === undefined;

  const handleCreateBoard = async (data: {
    name?: string;
    projectId?: string;
    stages?: Array<{
      name: string;
      eta: number;
      sequenceNumber: number;
      defaultTicketStatusV2?: string;
      prStatuses?: PRStatusEvent[];
      approverIds?: string[];
      formId?: string;
    }>;
  }): Promise<void> => {
    // Only called in create mode, so we know all fields are present
    await apiInstance.post('/boards', data);
    setShowCreateModal(false);
  };

  const handleUpdateBoard = (
    boardId: string,
    data: {
      name?: string;
      projectId?: string;
      boardType?: BoardType;
      metadata?: ReadonlyJSONValue;
      stages?: Array<{
        id?: string;
        name: string;
        eta: number;
        sequenceNumber: number;
        defaultTicketStatusV2?: string;
        prStatuses?: PRStatusEvent[];
        approverIds?: string[];
        formId?: string | undefined;
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
  ): void => {
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

    // Use the stageFormMappings passed from BoardForm, or build from stages if not provided
    const stageFormMappings: Array<{ stageId: string; formId: string; mappingId: string }> =
      data.stageFormMappings || [];

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

    const mutatorArgs = {
      boardId,
      ...(data.name !== undefined && { name: data.name }),
      ...(data.projectId !== undefined && { projectId: data.projectId }),
      ...(data.boardType !== undefined && { boardType: data.boardType }),
      ...(data.metadata !== undefined && { metadata: data.metadata }),
      ...(data.stages !== undefined && { stages: data.stages }),
      ...(stageIds !== undefined && { stageIds }),
      ...(prStatusMappingIds !== undefined && { prStatusMappingIds }),
      ...(stageFormMappings.length > 0 && { stageFormMappings }),
      ...(stageApprovers.length > 0 && { stageApprovers }),
      timestamp: Date.now(),
    };

    void zero.mutate(mutators.board.update(mutatorArgs));
    setEditingBoard(null);
  };

  const handleDeleteBoard = (boardId: string): void => {
    void zero.mutate(mutators.board.delete({ boardId }));
  };

  if (loading) {
    return (
      <div className='h-full bg-gray-50 flex items-center justify-center'>
        <p className='text-gray-600'>Loading...</p>
      </div>
    );
  }

  return (
    <div className='h-full bg-gray-50 p-8'>
      <div className='max-w-7xl mx-auto'>
        <PageHeader
          title='Boards'
          subtitle='Manage your project boards and workflow stages'
          actionButtonText='Create Board'
          onActionClick={() => setShowCreateModal(true)}
        />

        <BoardsGrid boards={boards} onEdit={setEditingBoard} onDelete={handleDeleteBoard} />
      </div>

      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal} title='Create New Board'>
        <div className='p-6'>
          <BoardForm onSubmit={handleCreateBoard} onCancel={() => setShowCreateModal(false)} />
        </div>
      </Dialog>

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
            />
          </div>
        </Dialog>
      )}
    </div>
  );
};

BoardsScreen.displayName = 'BoardsScreen';

export default BoardsScreen;
