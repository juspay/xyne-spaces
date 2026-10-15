export type MeasuredListState = {
  scroll: number;
  scrollLength: number;
  start: number;
  end: number;
  positionByKey: (key: string) => number | undefined;
  sizeAtIndex: (index: number) => number | undefined;
};

/** A requested scroll is not a landing. The target must be measured above the composer. */
export const isMeasuredRowVisible = ({
  state,
  key,
  index,
  readableTop,
  readableBottom,
}: {
  state: MeasuredListState;
  key: string;
  index: number;
  readableTop: number;
  readableBottom: number;
}): boolean => {
  if (index < state.start || index > state.end) return false;
  const position = state.positionByKey(key);
  const size = state.sizeAtIndex(index);
  if (position === undefined || size === undefined || size <= 0) return false;

  const top = position - state.scroll;
  const bottom = top + size;
  return bottom > readableTop && bottom <= readableBottom;
};
