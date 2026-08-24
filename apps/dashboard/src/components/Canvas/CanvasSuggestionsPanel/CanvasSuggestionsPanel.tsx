// Review UI for pending agent suggestions: collapsed bar over the canvas,
// batch-grouped cards (green insert / red delete / red-green replace / neutral
// move), accept/reject wired to Zero mutators. A batch is visible while it has
// at least one PENDING row; count and cards derive from that same predicate.
import { useCallback, useMemo, useState, type ReactElement, type RefObject } from 'react';
import { toast } from 'sonner';

import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useZero } from '../../../hooks/useZero';
import { queries } from '../../../zero/queries';
import { mutators } from '../../../zero/mutators';
import { cn } from '../../../utils/classNames';
import { useCanvasSuggestionAnchors } from '../useCanvasSuggestionAnchors';

interface SuggestionRow {
  id: string;
  batchId: string;
  op: string; // insert | replace | delete | move
  blockId: string | null;
  proposedAnchorId: string | null;
  currentAnchorId: string | null;
  beforeContent: unknown;
  afterContent: unknown;
  status: string;
  orderIndex: number;
  createdAt: number;
}

interface Batch {
  batchId: string;
  rows: SuggestionRow[];
  createdAt: number;
}

interface Props {
  canvasId: string;
  canEdit: boolean;
  editorContainerRef?: RefObject<HTMLElement | null>;
  className?: string;
}

/** Extract readable text from stored content: {markdown} for proposals, a block for snapshots. */
const asText = (value: unknown): string => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  const record = value as { markdown?: string };
  if (typeof record.markdown === 'string') return record.markdown;
  return '';
};

const runsToText = (runs: unknown): string => {
  if (!Array.isArray(runs)) return '';
  return runs.map(r => (r as { text?: string }).text ?? '').join('');
};

/** Text of a stored block; content may be a run array, a table object, or absent. */
const blockText = (value: unknown): string => {
  const block = value as { content?: unknown } | null;
  if (!block) return '';
  const content = block.content;
  if (Array.isArray(content)) return runsToText(content);
  const table = content as { rows?: { cells?: unknown[] }[] } | undefined;
  if (table?.rows) {
    return table.rows
      .map(row =>
        (row.cells ?? [])
          .map(cell => runsToText((cell as { content?: unknown }).content ?? cell))
          .join(' | '),
      )
      .join('\n');
  }
  return '';
};

/** A batch is visible while it still has a PENDING row. */
const buildBatches = (rows: SuggestionRow[]): Batch[] => {
  const byBatch = new Map<string, SuggestionRow[]>();
  for (const row of rows) {
    const list = byBatch.get(row.batchId) ?? [];
    list.push(row);
    byBatch.set(row.batchId, list);
  }
  const batches: Batch[] = [];
  for (const [batchId, batchRows] of byBatch) {
    if (!batchRows.some(r => r.status === 'PENDING')) continue;
    batches.push({ batchId, rows: batchRows, createdAt: batchRows[0]?.createdAt ?? 0 });
  }
  return batches.sort((a, b) => a.createdAt - b.createdAt);
};

export const CanvasSuggestionsPanel = ({
  canvasId,
  canEdit,
  editorContainerRef,
  className,
}: Props): ReactElement | null => {
  const z = useZero();
  const [busy, setBusy] = useState<string | null>(null);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  // Panel starts as a one-line bar; the card list is opt-in.
  const [expanded, setExpanded] = useState(false);
  const [rows = []] = useCachedQuery(queries.canvasSuggestionChanges({ canvasId }), {
    enabled: Boolean(canvasId),
  });

  const batches = useMemo(() => buildBatches(rows as unknown as SuggestionRow[]), [rows]);
  const visibleRows = useMemo(() => batches.flatMap(b => b.rows), [batches]);
  const pending = visibleRows.filter(r => r.status === 'PENDING');
  const attention = visibleRows.filter(r => r.status !== 'PENDING');

  // Rail anchor: the row's own block, or the paragraph an insert lands after.
  const anchors = useMemo(
    () =>
      visibleRows.map(row => ({
        blockId: row.blockId ?? row.currentAnchorId,
        status: row.status === 'PENDING' ? 'PENDING' : 'CONFLICT',
      })),
    [visibleRows],
  );

  // Clicking a railed block in the document expands, selects and scrolls to its card.
  const handleBlockClick = useCallback((blockId: string) => {
    setExpanded(true);
    setActiveBlockId(blockId);
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-suggestion-card-block="${CSS.escape(blockId)}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }, []);

  const { scrollToBlock } = useCanvasSuggestionAnchors(
    editorContainerRef ?? { current: null },
    anchors,
    activeBlockId,
    handleBlockClick,
  );

  const focusChange = useCallback(
    (blockId: string | null) => {
      setActiveBlockId(blockId);
      scrollToBlock(blockId);
    },
    [scrollToBlock],
  );

  /** Snippet of a live block, read from the rendered document (moves carry no content). */
  const domSnippet = useCallback(
    (blockId: string | null): string => {
      if (!blockId) return '';
      const el = editorContainerRef?.current?.querySelector<HTMLElement>(
        `[data-id="${CSS.escape(blockId)}"]`,
      );
      const text = el?.textContent?.trim() ?? '';
      return text.length > 60 ? `${text.slice(0, 60)}…` : text;
    },
    [editorContainerRef],
  );

  // Fires one mutator with busy-state + error toast handling.
  const run = useCallback(
    async (key: string, mutation: unknown, failure: string) => {
      setBusy(key);
      try {
        const result = z.mutate(mutation as never);
        const server = await (
          result as { server: Promise<{ type: string; error?: { message?: string } }> }
        ).server;
        if (server.type === 'error') throw new Error(server.error?.message || failure);
      } catch (error) {
        toast.error(failure, {
          description: error instanceof Error ? error.message : undefined,
        });
      } finally {
        setBusy(null);
      }
    },
    [z],
  );

  const resolveRow = useCallback(
    (row: SuggestionRow, accept: boolean) =>
      run(
        row.id,
        mutators.canvasSuggestion.resolveChange({
          changeId: row.id,
          accept,
          timestamp: Date.now(),
        }),
        accept ? 'Failed to accept change' : 'Failed to reject change',
      ),
    [run],
  );

  if (!batches.length) return null;

  const opLabel = (op: string): string =>
    op === 'insert' ? 'add' : op === 'delete' ? 'remove' : op === 'move' ? 'move' : 'edit';

  // ── the collapsed bar ─────────────────────────────────────────────────
  const bar = (
    <div className='flex flex-wrap items-center justify-between gap-2'>
      <button
        type='button'
        onClick={() => setExpanded(e => !e)}
        data-track-category='CANVAS'
        data-track-name='suggestion_panel_toggle'
        className='flex items-center gap-2 text-sm font-medium text-foreground hover:underline'
      >
        <span aria-hidden>✦</span>
        Agent proposed {pending.length} change
        {pending.length === 1 ? '' : 's'}
        {batches.length > 1 ? (
          <span className='text-xs text-muted-foreground'>({batches.length} proposals)</span>
        ) : null}
        {attention.length ? (
          <span className='rounded-sm bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-amber-900'>
            {attention.length} need attention
          </span>
        ) : null}
        <span className='text-xs text-muted-foreground'>{expanded ? 'hide' : 'review'} ▾</span>
      </button>
      {canEdit && pending.length > 0 ? (
        <div className='flex items-center gap-2'>
          <button
            type='button'
            disabled={busy !== null}
            onClick={() => {
              void run(
                'accept-all',
                mutators.canvasSuggestion.resolveAll({
                  canvasId,
                  accept: true,
                  timestamp: Date.now(),
                }),
                'Failed to accept changes',
              );
            }}
            data-track-category='CANVAS'
            data-track-name='suggestion_accept_all'
            className='rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50'
          >
            Accept all
          </button>
          <button
            type='button'
            disabled={busy !== null}
            onClick={() => {
              void run(
                'reject-all',
                mutators.canvasSuggestion.resolveAll({
                  canvasId,
                  accept: false,
                  timestamp: Date.now(),
                }),
                'Failed to reject changes',
              );
            }}
            data-track-category='CANVAS'
            data-track-name='suggestion_reject_all'
            className='rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted'
          >
            Reject all
          </button>
        </div>
      ) : null}
    </div>
  );

  return (
    <div
      className={cn(
        'border-b border-border bg-amber-50/50 px-4 py-2 dark:bg-amber-950/20',
        className,
      )}
    >
      {bar}
      {expanded ? (
        <div className='mt-2 flex max-h-72 flex-col gap-2 overflow-y-auto pb-1'>
          {batches.map((batch, batchIndex) => (
            <div key={batch.batchId} className='flex flex-col gap-2'>
              {batches.length > 1 ? (
                <div className='mt-1 text-[11px] font-medium uppercase text-muted-foreground'>
                  Proposal {batchIndex + 1} · {new Date(batch.createdAt).toLocaleTimeString()}
                </div>
              ) : null}
              {batch.rows.map(row => {
                const blocked = row.status !== 'PENDING';
                const railBlockId = row.blockId ?? row.currentAnchorId;
                const before = blockText(row.beforeContent);
                const after = asText(row.afterContent);
                return (
                  <div
                    key={row.id}
                    data-suggestion-card-block={railBlockId ?? undefined}
                    data-track-category='CANVAS'
                    data-track-name='suggestion_card_focus'
                    role={railBlockId ? 'button' : undefined}
                    tabIndex={railBlockId ? 0 : undefined}
                    onClick={() => focusChange(railBlockId)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        focusChange(railBlockId);
                      }
                    }}
                    className={cn(
                      'rounded-md border bg-muted/20 px-3 py-2 transition-colors',
                      railBlockId &&
                        'cursor-pointer hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500',
                      activeBlockId && railBlockId === activeBlockId
                        ? 'border-amber-500 bg-amber-50/60'
                        : 'border-border',
                    )}
                  >
                    <div className='mb-1 flex items-center justify-between gap-2'>
                      <span className='text-[11px] font-medium uppercase text-muted-foreground'>
                        {opLabel(row.op)}
                      </span>
                      {blocked ? (
                        <span className='rounded-sm bg-red-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-red-900'>
                          no longer applies
                        </span>
                      ) : null}
                    </div>

                    <div className='whitespace-pre-wrap break-words text-sm leading-6'>
                      {row.op === 'move' ? (
                        <span className='text-muted-foreground'>
                          Move “{domSnippet(row.blockId) || 'this paragraph'}” →{' '}
                          {row.currentAnchorId
                            ? `after “${domSnippet(row.currentAnchorId) || 'the highlighted paragraph'}”`
                            : 'to the top of the document'}
                        </span>
                      ) : (
                        <>
                          {row.op !== 'insert' && before ? (
                            <div className='rounded-sm bg-red-50 px-1 text-red-950 line-through decoration-red-400 dark:bg-red-950/40 dark:text-red-200'>
                              {before}
                            </div>
                          ) : null}
                          {row.op !== 'delete' && after ? (
                            <div className='mt-0.5 rounded-sm bg-emerald-50 px-1 text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-200'>
                              {after}
                            </div>
                          ) : null}
                        </>
                      )}
                    </div>

                    {canEdit ? (
                      <div
                        className='mt-2 flex items-center gap-2'
                        role='presentation'
                        data-track-category='CANVAS'
                        data-track-name='suggestion_card_actions_boundary'
                        onClick={e => e.stopPropagation()}
                      >
                        {!blocked ? (
                          <button
                            type='button'
                            disabled={busy !== null}
                            onClick={() => void resolveRow(row, true)}
                            data-track-category='CANVAS'
                            data-track-name='suggestion_accept'
                            className='rounded-md bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50'
                          >
                            Accept
                          </button>
                        ) : null}
                        <button
                          type='button'
                          disabled={busy !== null}
                          onClick={() => void resolveRow(row, false)}
                          data-track-category='CANVAS'
                          data-track-name='suggestion_reject'
                          className='rounded-md border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground hover:bg-muted'
                        >
                          {blocked ? 'Dismiss' : 'Reject'}
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};
