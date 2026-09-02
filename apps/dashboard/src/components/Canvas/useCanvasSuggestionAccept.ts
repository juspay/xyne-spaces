// Client-side accept: the accepting browser applies the suggestion through the
// editor API, so the write is a LOCAL Yjs transaction — undoable with Ctrl+Z —
// and the mutator only records statuses (the `outcome` payload). Returns null
// when the editor is unavailable; the caller then falls back to the legacy
// server-side apply (correct result, just not undoable).
import { useCallback, type RefObject } from 'react';
import { BlockNoteEditor, type PartialBlock } from '@blocknote/core';
import { applyOps, type SuggestionRowLike } from '@xyne/shared';

import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';

export interface SuggestionOutcome {
  applied: string[];
  stale: string[];
}

/** The slice of the editor ref the client apply needs (both editor refs have it). */
export interface SuggestionEditorHandle {
  getBlocks: () => PartialBlock[];
  replaceContent: (blocks: PartialBlock[]) => void;
  /** Optional: park the caret in a block after an apply (never scrolls). */
  setTextCursorPosition?: (blockId: string, placement?: 'start' | 'end') => void;
}

/** Nearest scrollable ancestor — the pane whose position an apply must not move. */
const findScrollable = (el: HTMLElement | null | undefined): HTMLElement | null => {
  for (let n = el ?? null; n; n = n.parentElement) {
    if (n.scrollHeight > n.clientHeight) {
      const overflowY = getComputedStyle(n).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') return n;
    }
  }
  return null;
};

interface AcceptableRow {
  id: string;
  batchId: string;
  op: string;
  blockId: string | null;
  proposedAnchorId: string | null;
  currentAnchorId: string | null;
  orderIndex: number;
  afterContent: unknown;
  status: string;
  createdAt: number;
}

export const useCanvasSuggestionAccept = (
  canvasId: string,
  editorRef: RefObject<SuggestionEditorHandle | null> | undefined,
  editorContainerRef: RefObject<HTMLElement | null> | undefined,
): ((rows: AcceptableRow[]) => Promise<SuggestionOutcome | null>) => {
  // Placement rows (inserts + moves) of every live batch — accepted siblings
  // included — so a later accept lands behind siblings that precede it.
  const [placementRows = []] = useCachedQuery(
    queries.canvasSuggestionPlacementOrder({ canvasId }),
    { enabled: Boolean(canvasId) },
  );

  return useCallback(
    async (rows: AcceptableRow[]): Promise<SuggestionOutcome | null> => {
      const editor = editorRef?.current;
      if (!editor) return null;
      const pending = rows.filter(r => r.status === 'PENDING');
      if (!pending.length) return null;

      const current = editor.getBlocks();

      const batchIds = new Set(pending.map(r => r.batchId));
      const siblingOrder = new Map<string, number>();
      for (const row of placementRows as unknown as AcceptableRow[]) {
        if (!batchIds.has(row.batchId)) continue;
        const blockId = row.op === 'insert' ? row.id : row.blockId;
        if (blockId) siblingOrder.set(blockId, row.orderIndex);
      }

      // Headless parser, same as chat paste handling; agent markdown only uses
      // standard blocks, so the default schema matches the server renderer.
      const parser = BlockNoteEditor.create();
      const toBlocks = async (markdown: string): Promise<PartialBlock[]> =>
        (await Promise.resolve(parser.tryParseMarkdownToBlocks(markdown))) as PartialBlock[];

      const normalized: SuggestionRowLike[] = pending.map(r => ({
        id: r.id,
        op: r.op,
        blockId: r.blockId ?? null,
        proposedAnchorId: r.proposedAnchorId ?? null,
        currentAnchorId: r.currentAnchorId ?? null,
        orderIndex: r.orderIndex,
        afterContent: r.afterContent,
        createdAt: r.createdAt,
      }));

      const outcome = await applyOps(current, normalized, toBlocks, siblingOrder);

      if (outcome.applied.length) {
        const editable = editorContainerRef?.current?.querySelector<HTMLElement>(
          '[contenteditable="true"]',
        );
        const scroller = findScrollable(editable);
        const scrollTop = scroller?.scrollTop ?? 0;

        editor.replaceContent(outcome.blocks);

        const appliedSet = new Set(outcome.applied);
        const caretRow = pending.find(r => appliedSet.has(r.id) && r.op !== 'delete');
        const caretBlockId = caretRow
          ? caretRow.op === 'insert'
            ? caretRow.id
            : caretRow.blockId
          : null;
        if (caretBlockId) {
          try {
            editor.setTextCursorPosition?.(caretBlockId, 'start');
          } catch {
            // Block without inline content (e.g. a table edge case) — caret stays put.
          }
        }

        // Ctrl+Z only reaches the undo plugin while the editor is focused.
        editable?.focus({ preventScroll: true });
        if (scroller) {
          scroller.scrollTop = scrollTop;
          // Once more after layout settles: widget removal shifts heights.
          requestAnimationFrame(() => {
            scroller.scrollTop = scrollTop;
          });
        }
      }

      return { applied: outcome.applied, stale: outcome.stale };
    },
    [editorRef, editorContainerRef, placementRows],
  );
};
