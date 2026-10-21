import { BOUNDARY_ID } from '@/src/features/bottom-navigation/model/layout';

// Geometry only, and free of `react-native` so the slot maths can be exercised
// directly. Anything that needs Reanimated lives in `customize-motion`.

export const ROW_HEIGHT = 52;
export const GROUP_RADIUS = 14;
/** A lifted row is a capsule, whatever shape it had in the group. */
export const LIFTED_RADIUS = ROW_HEIGHT / 2;

export const SECTION_LABEL_HEIGHT = 30;
/** Clear space between the Visible group and the Hidden label above it. */
export const SECTION_TOP_GAP = 18;
/** What the boundary row occupies: the gap plus the "Hidden" label. */
export const BOUNDARY_HEIGHT = SECTION_TOP_GAP + SECTION_LABEL_HEIGHT;
/** Placeholder that stands in for an empty Hidden group, so it is still a target. */
export const EMPTY_GROUP_HEIGHT = 56;

export const LIST_SIDE_PADDING = 16;

export function rowHeight(id: string): number {
  'worklet';
  return id === BOUNDARY_ID ? BOUNDARY_HEIGHT : ROW_HEIGHT;
}

/** Distance from the top of the list to the top of the slot at `index`. */
export function offsetForIndex(order: readonly string[], index: number): number {
  'worklet';
  let offset = 0;
  for (let i = 0; i < index && i < order.length; i += 1) {
    offset += rowHeight(order[i] ?? '');
  }
  return offset;
}

/**
 * Slot a row belongs in, given where its top edge currently sits.
 *
 * The row's centre picks the slot it falls inside, so a row has to travel half
 * its own height before it displaces its neighbour. Comparing against slot
 * midpoints instead looks equivalent but is not: an untouched row sits exactly
 * on its own midpoint, and a strict `<` there hands it straight to the next
 * slot — which swapped the neighbour in the instant a row was picked up,
 * before the finger had moved at all.
 */
export function indexForOffset(order: readonly string[], offset: number): number {
  'worklet';
  const probe = offset + ROW_HEIGHT / 2;
  let acc = 0;
  for (let i = 0; i < order.length; i += 1) {
    const height = rowHeight(order[i] ?? '');
    if (probe < acc + height) return i;
    acc += height;
  }
  return order.length - 1;
}

export function contentHeight(order: readonly string[], hasHiddenRows: boolean): number {
  'worklet';
  return offsetForIndex(order, order.length) + (hasHiddenRows ? 0 : EMPTY_GROUP_HEIGHT);
}
