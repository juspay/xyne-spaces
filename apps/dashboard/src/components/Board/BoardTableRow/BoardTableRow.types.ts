import type { BoardRow } from '../BoardCreateScreen/BoardCreateScreen.types';

export interface BoardTableRowProps {
  board: BoardRow & { customFieldNames?: string[] };
  onDuplicate: (board: BoardRow) => void;
  onPreview: (board: BoardRow) => void;
  index: number;
  selectedBoardId?: string | undefined;
}
