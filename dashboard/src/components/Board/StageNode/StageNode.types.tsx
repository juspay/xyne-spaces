import type { StageNode as StageNodeType } from '../BoardStageConfigScreen/BoardStageConfigScreen.types';

export interface StageNodeProps {
  node: StageNodeType;
  isSelected: boolean;
  isFirst: boolean;
  isLast: boolean;
  onSelect: () => void;
  onDelete: () => void;
}
