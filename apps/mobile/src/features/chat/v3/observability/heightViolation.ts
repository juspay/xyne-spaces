/** G4: any size change on an already-visible row is a violation. */

export type HeightViolation = {
  itemId: string;
  previousSize: number;
  nextSize: number;
};

export const isVisibleHeightViolation = (
  itemId: string,
  nextSize: number,
  visibleIds: ReadonlySet<string>,
  previousSizeById: ReadonlyMap<string, number>,
): boolean => {
  if (!visibleIds.has(itemId)) {
    return false;
  }
  const previous = previousSizeById.get(itemId);
  return previous !== undefined && previous !== nextSize;
};

export const heightViolationFor = (
  itemId: string,
  nextSize: number,
  visibleIds: ReadonlySet<string>,
  previousSizeById: ReadonlyMap<string, number>,
): HeightViolation | null => {
  if (!isVisibleHeightViolation(itemId, nextSize, visibleIds, previousSizeById)) {
    return null;
  }
  return {
    itemId,
    previousSize: previousSizeById.get(itemId) ?? nextSize,
    nextSize,
  };
};

let lastViolation: HeightViolation | null = null;

export const recordHeightViolation = (violation: HeightViolation | null): void => {
  lastViolation = violation;
};

export const takeHeightViolation = (): HeightViolation | null => {
  const next = lastViolation;
  lastViolation = null;
  return next;
};
