interface CanvasUserPageScanState {
  hasClientSideResultFilters: boolean;
  visibleRowCount: number;
  minimumVisibleRows: number;
  isSpecificChannelScope: boolean;
  hasMore: boolean;
  hasNextCursor: boolean;
}

export function shouldScanCanvasUserPages({
  hasClientSideResultFilters,
  visibleRowCount,
  minimumVisibleRows,
  isSpecificChannelScope,
  hasMore,
  hasNextCursor,
}: CanvasUserPageScanState): boolean {
  return (
    !isSpecificChannelScope &&
    hasMore &&
    hasNextCursor &&
    (hasClientSideResultFilters || visibleRowCount < minimumVisibleRows)
  );
}
