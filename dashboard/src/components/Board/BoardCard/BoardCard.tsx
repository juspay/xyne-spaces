import { ReactElement } from 'react';
import { Button, ButtonType } from '@juspay/blend-design-system';
import type { Stage, BoardType } from '@xyne/shared';
import type { ReadonlyJSONValue } from '@rocicorp/zero';

// Board type from Zero query with related stages
export interface BoardWithStages {
  readonly id: string;
  readonly name: string;
  readonly boardType: BoardType;
  readonly projectId: string;
  readonly createdBy: string;
  readonly updatedBy: string | null;
  readonly createdAt: number;
  readonly updatedAt: number | null;
  readonly metadata?: ReadonlyJSONValue;
  readonly stages?: readonly Stage[] | Error;
}

interface BoardCardProps {
  board: BoardWithStages;
  onEdit: (board: BoardWithStages) => void;
  onDelete: (boardId: string) => void;
}

export const BoardCard = ({ board, onEdit, onDelete }: BoardCardProps): ReactElement => {
  const stages = (
    board.stages && Array.isArray(board.stages) ? board.stages : []
  ) as readonly Stage[];
  const hasStages = stages.length > 0;

  return (
    <div className='bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow'>
      <div className='mb-4'>
        <h3 className='text-lg font-semibold text-gray-900 mb-2'>{board.name}</h3>
        <p className='text-sm text-gray-500'>Project ID: {board.projectId}</p>
      </div>

      {hasStages && (
        <div className='border-t border-gray-100 pt-4 mt-4'>
          <p className='text-xs font-semibold text-gray-700 mb-2'>Stages ({stages.length})</p>
          <div className='space-y-1'>
            {[...stages]
              .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
              .map(stage => (
                <div key={stage.id} className='text-xs text-gray-600 flex justify-between'>
                  <span>
                    {stage.sequenceNumber}. {stage.name}
                  </span>
                  <span className='text-gray-400'>{stage.eta}h</span>
                </div>
              ))}
          </div>
        </div>
      )}

      <div className='border-t border-gray-100 pt-4 mt-4'>
        <div className='text-xs text-gray-500 mb-3'>
          <p>Created: {new Date(board.createdAt).toLocaleDateString()}</p>
        </div>

        <div className='flex gap-2'>
          <Button buttonType={ButtonType.SECONDARY} text='Edit' onClick={() => onEdit(board)} />
          <Button
            buttonType={ButtonType.DANGER}
            text='Delete'
            onClick={() => void onDelete(board.id)}
          />
        </div>
      </div>
    </div>
  );
};
