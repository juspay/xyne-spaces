export interface ViewBoardPickerProps {
  selectedBoardIds: string[];
  onChange: (boardIds: string[]) => void;
  className?: string;
}

export interface PickerProjectRowProps {
  project: { id: string; name: string };
  selected: ReadonlySet<string>;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleBoards: (boardIds: string[], on: boolean) => void;
}
