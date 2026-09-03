import type { Stage } from '../../../routes/KanbanBoardScreen/KanbanBoardScreen.types';

export interface HiddenColumnsPanelProps {
  stages: Stage[];
  getCount: (stage: Stage) => number;
  onUnhide: (stageId: string) => void;
  isOpen: boolean;
  onToggle: () => void;
}
