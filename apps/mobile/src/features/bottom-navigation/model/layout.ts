/** The bar always shows this many pills, so Visible can never fall below it. */
export const MIN_VISIBLE_TABS = 3;

/**
 * Stands in for the Visible/Hidden divide inside the drag order.
 *
 * Modelling the divide as a row rather than as a separate count is what keeps
 * the reorder rule to one array operation: an item crossing sections is just an
 * item crossing this marker, and "how many are visible" is only ever its index.
 */
export const BOUNDARY_ID = '__boundary__';

export type TabLayout = {
  visible: string[];
  hidden: string[];
};

export function toDragOrder(layout: TabLayout): string[] {
  'worklet';
  return [...layout.visible, BOUNDARY_ID, ...layout.hidden];
}

export function fromDragOrder(order: readonly string[]): TabLayout {
  'worklet';
  const boundary = order.indexOf(BOUNDARY_ID);
  const cut = boundary === -1 ? order.length : boundary;
  return {
    visible: order.slice(0, cut),
    hidden: order.slice(cut + 1),
  };
}

export function layoutsEqual(a: TabLayout, b: TabLayout): boolean {
  const sameList = (x: readonly string[], y: readonly string[]): boolean =>
    x.length === y.length && x.every((id, index) => id === y[index]);
  return sameList(a.visible, b.visible) && sameList(a.hidden, b.hidden);
}

/**
 * The arrangement a fresh install starts from: catalog order, first three in
 * the bar, nothing hidden.
 */
export function defaultLayout(catalogIds: readonly string[]): TabLayout {
  return { visible: [...catalogIds], hidden: [] };
}

/**
 * Reconciles a stored arrangement with the catalog as it is today.
 *
 * Destinations the app has dropped disappear, ones it has gained land at the
 * end of Visible so a release never hides something behind a drawer the user
 * has not been told about, and Visible is topped back up if it somehow came
 * back short. Anything unparseable falls all the way back to the default.
 *
 * Takes the id list rather than reading the catalog, so the rules stay free of
 * the icon components the catalog carries and can be exercised directly.
 */
export function normalizeLayout(raw: unknown, catalogIds: readonly string[]): TabLayout {
  const known = new Set<string>(catalogIds);
  const seen = new Set<string>();

  const clean = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    const out: string[] = [];
    for (const id of value) {
      if (typeof id !== 'string' || !known.has(id) || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  };

  const source = (raw ?? {}) as { visible?: unknown; hidden?: unknown };
  const visible = clean(source.visible);
  const hidden = clean(source.hidden);

  // Catalog entries the stored arrangement never mentioned — a new release, or
  // a partially written record.
  for (const id of catalogIds) {
    if (!seen.has(id)) visible.push(id);
  }

  while (visible.length < MIN_VISIBLE_TABS && hidden.length > 0) {
    const promoted = hidden.shift();
    if (promoted !== undefined) visible.push(promoted);
  }

  return { visible, hidden };
}

/**
 * Moves the dragged row to `targetIndex`, keeping Visible at or above its
 * floor.
 *
 * When the move would empty Visible past the floor, the topmost hidden row is
 * promoted to take the dragged row's place — the swap that lets you drag a
 * fourth item out without the bar ever going short. With nothing left to
 * promote there is no legal arrangement, so the move is refused and the caller
 * gets its own array back untouched.
 */
export function moveInDragOrder(
  order: readonly string[],
  activeId: string,
  targetIndex: number,
): string[] {
  'worklet';
  const from = order.indexOf(activeId);
  if (from === -1) return order as string[];

  const to = targetIndex < 0 ? 0 : targetIndex > order.length - 1 ? order.length - 1 : targetIndex;
  if (to === from) return order as string[];

  const next = order.slice();
  next.splice(from, 1);
  next.splice(to, 0, activeId);

  // Promote from Hidden until the bar is full again. The dragged row is skipped
  // — promoting it would tear it out from under the finger.
  let boundary = next.indexOf(BOUNDARY_ID);
  while (boundary < MIN_VISIBLE_TABS) {
    let promote = -1;
    for (let index = boundary + 1; index < next.length; index += 1) {
      if (next[index] !== activeId) {
        promote = index;
        break;
      }
    }
    if (promote === -1) return order as string[];

    const [promoted] = next.splice(promote, 1);
    if (promoted === undefined) return order as string[];
    next.splice(boundary, 0, promoted);
    boundary = next.indexOf(BOUNDARY_ID);
  }

  return next;
}
