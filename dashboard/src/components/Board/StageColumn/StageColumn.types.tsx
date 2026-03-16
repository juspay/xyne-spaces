import type { TicketStatusV2 } from '@xyne/shared';
import type { StageNode as StageNodeType } from '../BoardStageConfigScreen/BoardStageConfigScreen.types';

export interface ETAChipProps {
  eta: number;
  onUpdate: (eta: number) => void;
}

export interface StageColumnProps {
  node: StageNodeType;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onUpdateEta: (eta: number) => void;
  onStatusChange: (status: TicketStatusV2) => void;
}

export interface StageConnectorProps {
  onClick: () => void;
}
