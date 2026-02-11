import { BoardType } from '@xyne/shared';

export const isReleaseBoard = (boardType?: BoardType): boolean => {
  if (!boardType) return false;
  return boardType === BoardType.RELEASE;
};
