/**
 * Pure application of suggestion rows to a block array. No I/O, no logging,
 * no BlockNote dependency — the orchestration lives in the backend
 * (suggestions.ts) and, for client-applied accepts, in the dashboard hook.
 * Shared so both runtimes run the identical algorithm.
 *
 * Phases: 1) replaces in place (position-blind, block id kept)
 *         2) deletes
 *         3) placement — moves + inserts together, in (createdAt, orderIndex)
 *            order, anchors resolved proposed-first; unresolvable = STALE,
 *            never guessed. Content is applied as accepted — no conflict
 *            detection; the human's review of the card is the check.
 */

export interface SuggestionRowLike {
  id: string;
  op: string; // insert | replace | delete | move
  blockId: string | null;
  proposedAnchorId: string | null;
  currentAnchorId: string | null;
  orderIndex: number;
  afterContent: unknown;
  createdAt: Date | number;
}

export interface ApplyOutcome<TBlock> {
  blocks: TBlock[];
  applied: string[];
  stale: string[];
}

const createdAtMs = (v: Date | number): number => (typeof v === 'number' ? v : v.getTime());

/** Separator between a row id and the index of a follower block it produced. */
const FOLLOWER_SEP = '__';

/**
 * The row a block belongs to: a follower block resolves to the head that
 * produced it, any other block to itself. The editor preview uses this to
 * draw pending cards after a whole group, where the engine will place them.
 */
export function suggestionGroupOf(blockId: string): string {
  const at = blockId.indexOf(FOLLOWER_SEP);
  return at < 0 ? blockId : blockId.slice(0, at);
}

export function suggestionSiblingOrder<TBlock extends { id?: string }>(
  current: TBlock[],
  rows: Array<{ id: string; op: string; blockId: string | null; orderIndex: number }>
): Map<string, number> {
  const order = new Map<string, number>();
  for (const row of rows) {
    if (row.op === 'insert') {
      order.set(row.id, row.orderIndex);
      for (const block of current) {
        const id = block.id;
        if (id && id !== row.id && suggestionGroupOf(id) === row.id) order.set(id, row.orderIndex);
      }
    } else if (row.op === 'move' && row.blockId) {
      order.set(row.blockId, row.orderIndex);
    }
  }
  return order;
}

export async function applyOps<TBlock extends { id?: string }>(
  current: TBlock[],
  rows: SuggestionRowLike[],
  toBlocks: (markdown: string) => Promise<TBlock[]>,
  siblingOrder: Map<string, number> = new Map()
): Promise<ApplyOutcome<TBlock>> {
  const working: TBlock[] = [...current];
  const applied: string[] = [];
  const stale: string[] = [];
  // Followers minted during this call join the map under their row's order.
  const order = new Map(siblingOrder);

  const findIdx = (id: string | null): number =>
    id === null ? -1 : working.findIndex(b => b.id === id);

  const markdownOf = (row: SuggestionRowLike): string | null => {
    const c = row.afterContent as { markdown?: string } | null;
    return c?.markdown ?? null;
  };

  // One row can parse into several blocks — a list, or a heading and its
  // paragraph, returned by the agent without a blank line between. The first
  // block carries the row's identity; the followers get ids derived from it
  // and the row's sibling order, so a later sibling lands after the group.
  const followerId = (base: string, i: number): string => `${base}${FOLLOWER_SEP}${i + 1}`;
  const withIds = (blocks: TBlock[], base: string, orderIndex: number): TBlock[] =>
    blocks.map((b, i) => {
      const id = i === 0 ? base : followerId(base, i - 1);
      if (i > 0) order.set(id, orderIndex);
      return { ...(b as object), id } as TBlock;
    });

  // ── phase 1: replaces — in place, by id, block id kept. Applies over
  // whatever the block currently holds: the human's accept is the authority. ──
  for (const row of rows.filter(r => r.op === 'replace')) {
    const idx = findIdx(row.blockId);
    if (idx < 0) {
      stale.push(row.id);
      continue;
    }
    const md = markdownOf(row);
    const parsed = md ? await toBlocks(md) : [];
    if (!parsed[0]) {
      stale.push(row.id);
      continue;
    }
    // Replaced block keeps its id; extra blocks follow it under the row's id.
    const [first, ...rest] = withIds(parsed, row.id, row.orderIndex);
    working[idx] = { ...(first as object), id: row.blockId } as TBlock;
    working.splice(idx + 1, 0, ...rest);
    applied.push(row.id);
  }

  // ── phase 2: deletes ──────────────────────────────────────────────────
  for (const row of rows.filter(r => r.op === 'delete')) {
    const idx = findIdx(row.blockId);
    if (idx < 0) {
      applied.push(row.id); // already gone — what it wanted happened
      continue;
    }
    working.splice(idx, 1);
    applied.push(row.id);
  }

  // ── phase 3: placement — moves + inserts, proposed-first anchors ──────
  const placement = rows
    .filter(r => r.op === 'move' || r.op === 'insert')
    .sort(
      (a, b) =>
        createdAtMs(a.createdAt) - createdAtMs(b.createdAt) || a.orderIndex - b.orderIndex
    );

  // Current-first: currentAnchorId is the live pointer (forwarded by deletion
  // events and by sibling accepts), so it is the tracked reality; the frozen
  // proposedAnchorId is the fallback when the live pointer's block is gone.
  // null is a VALID pointer (top of document), not a missing one.
  const resolveAnchor = (
    row: SuggestionRowLike
  ): { ok: true; anchorId: string | null } | { ok: false } => {
    if (row.currentAnchorId === null) return { ok: true, anchorId: null }; // top of document
    if (findIdx(row.currentAnchorId) >= 0) return { ok: true, anchorId: row.currentAnchorId };
    if (row.proposedAnchorId === null) return { ok: true, anchorId: null };
    if (findIdx(row.proposedAnchorId) >= 0) return { ok: true, anchorId: row.proposedAnchorId };
    return { ok: false };
  };

  const placeAfter = (block: TBlock, anchorId: string | null, orderIndex: number): void => {
    let at = anchorId === null ? 0 : findIdx(anchorId) + 1;
    for (;;) {
      const id = at < working.length ? (working[at] as TBlock).id : undefined;
      const siblingIndex = id === undefined ? undefined : order.get(id);
      if (siblingIndex === undefined || siblingIndex >= orderIndex) break;
      at++;
    }
    working.splice(at, 0, block);
  };

  for (const row of placement) {
    if (row.op === 'move') {
      const srcIdx = findIdx(row.blockId);
      if (srcIdx < 0) {
        stale.push(row.id);
        continue;
      }
      const anchor = resolveAnchor(row);
      if (!anchor.ok) {
        stale.push(row.id);
        continue;
      }
      const [block] = working.splice(srcIdx, 1); // same object: id + content survive
      placeAfter(block as TBlock, anchor.anchorId, row.orderIndex);
      applied.push(row.id);
    } else {
      // An insert's row id doubles as its block id — if that block already
      // exists, this row was applied before (e.g. a retry after a failed
      // status commit). Re-applying would duplicate the paragraph.
      if (findIdx(row.id) >= 0) {
        applied.push(row.id);
        continue;
      }
      const anchor = resolveAnchor(row);
      if (!anchor.ok) {
        stale.push(row.id);
        continue;
      }
      const md = markdownOf(row);
      const parsed = md ? await toBlocks(md) : [];
      if (!parsed[0]) {
        stale.push(row.id);
        continue;
      }
      const [first, ...rest] = withIds(parsed, row.id, row.orderIndex);
      placeAfter(first as TBlock, anchor.anchorId, row.orderIndex);
      working.splice(findIdx(row.id) + 1, 0, ...rest);
      applied.push(row.id);
    }
  }

  return { blocks: working, applied, stale };
}
