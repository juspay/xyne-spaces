import { BoardType } from '@xyne/shared';

export const isReleaseBoard = (boardType?: BoardType): boolean => {
  if (!boardType) return false;
  return boardType === BoardType.RELEASE;
};

// Main release board = the repo target (owns the commit range); it carries a
// vcsProvider, unlike per-service RELEASE boards.
export const isMainReleaseBoard = (board?: {
  boardType?: BoardType;
  vcsProvider?: string | null;
}): boolean => {
  return isReleaseBoard(board?.boardType) && Boolean(board?.vcsProvider);
};
