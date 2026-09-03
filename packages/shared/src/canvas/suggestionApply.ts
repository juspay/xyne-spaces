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

export async function applyOps<TBlock extends { id?: string }>(
  current: TBlock[],
  rows: SuggestionRowLike[],
  toBlocks: (markdown: string) => Promise<TBlock[]>,
  siblingOrder: Map<string, number> = new Map()
): Promise<ApplyOutcome<TBlock>> {
  const working: TBlock[] = [...current];
  const applied: string[] = [];
  const stale: string[] = [];

  const findIdx = (id: string | null): number =>
    id === null ? -1 : working.findIndex(b => b.id === id);

  const markdownOf = (row: SuggestionRowLike): string | null => {
    const c = row.afterContent as { markdown?: string } | null;
    return c?.markdown ?? null;
  };

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
    const next = parsed[0];
    if (!next) {
      stale.push(row.id);
      continue;
    }
    working[idx] = { ...(next as object), id: row.blockId } as TBlock;
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
      const siblingIndex = id === undefined ? undefined : siblingOrder.get(id);
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
      const next = parsed[0];
      if (!next) {
        stale.push(row.id);
        continue;
      }
      placeAfter({ ...(next as object), id: row.id } as TBlock, anchor.anchorId, row.orderIndex);
      applied.push(row.id);
    }
  }

  return { blocks: working, applied, stale };
}
