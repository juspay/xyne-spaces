import { useCallback, useMemo, useState, type ReactElement, type RefObject } from 'react';
import { toast } from 'sonner';

import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useZero } from '../../../hooks/useZero';
import { queries } from '../../../zero/queries';
import { mutators } from '../../../zero/mutators';
import { cn } from '../../../utils/classNames';
import {
  createCanvasContentTextDiff,
  isVisibleCanvasContentDiffPart,
} from '../../../utils/canvasVersioning';
import { useCanvasSuggestionAnchors } from '../useCanvasSuggestionAnchors';

interface SuggestionChange {
  id: string;
  op: string;
  blockId: string | null;
  basePos: number | null;
  beforeContent: unknown;
  afterContent: unknown;
  status: string;
  orderIndex: number;
}

interface Suggestion {
  id: string;
  baseBlockIds: unknown;
  createdAt: number;
  changes?: readonly SuggestionChange[];
}

interface Props {
  canvasId: string;
  canEdit: boolean;
  editorContainerRef?: RefObject<HTMLElement | null>;
  className?: string;
}

/** Above this change ratio a word diff is unreadable — show old and new blocks whole. */
const WORD_DIFF_MAX_CHANGE_RATIO = 0.4;

const changeRatio = (parts: { type: string; value: string }[]): number => {
  let changed = 0;
  let total = 0;
  for (const part of parts) {
    total += part.value.length;
    if (part.type !== 'same') changed += part.value.length;
  }
  return total === 0 ? 0 : changed / total;
};

const asText = (value: unknown): string => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  const record = value as { markdown?: string };
  if (typeof record.markdown === 'string') return record.markdown;
  return '';
};

/** Extract readable text from a block; content may be a run array, a table object, or absent. */
const runsToText = (runs: unknown): string =>
  Array.isArray(runs)
    ? runs
        .map(run => {
          const r = run as { text?: string; content?: unknown };
          if (typeof r?.text === 'string') return r.text;
          return r?.content ? runsToText(r.content) : '';
        })
        .join('')
    : '';

const blockText = (value: unknown): string => {
  if (!value || typeof value !== 'object') return '';
  const content = (value as { content?: unknown }).content;
  if (!content) return '';
  if (Array.isArray(content)) return runsToText(content);
  const table = content as { rows?: { cells?: unknown[] }[] };
  if (Array.isArray(table.rows)) {
    return table.rows
      .map(row =>
        (row?.cells ?? [])
          .map(cell => {
            const c = cell as { content?: unknown };
            return runsToText(Array.isArray(cell) ? cell : c?.content);
          })
          .join(' | '),
      )
      .join('\n');
  }
  return '';
};

const blockType = (value: unknown): string | null =>
  value && typeof value === 'object' ? ((value as { type?: string }).type ?? null) : null;

/**
 * A reviewable item. Usually one change — but a delete+insert produced by the
 * relabel guard (same score stamped on both, insert anchored to the deleted
 * block, adjacent orderIndex) is really ONE decision: "replace this paragraph".
 * Pairing is display-only; the rows stay independent in the database.
 */
interface ReviewItem {
  key: string;
  suggestion: Suggestion;
  primary: SuggestionChange;
  paired?: SuggestionChange; // the insert half of a replace-pair
}

const buildItems = (suggestions: Suggestion[]): ReviewItem[] => {
  const items: ReviewItem[] = [];
  for (const s of suggestions) {
    const visible = (s.changes ?? []).filter(
      c => c.status === 'PENDING' || c.status === 'CONFLICT' || c.status === 'STALE',
    );
    let i = 0;
    while (i < visible.length) {
      const c = visible[i] as SuggestionChange;
      const next = visible[i + 1];
      // Delete + insert anchored to the same block = one "replace" decision (derived from op + position).
      const baseIds = (s.baseBlockIds as string[] | null) ?? [];
      const insertTarget =
        next?.op === 'insert_after' && next.basePos !== null && next.basePos >= 0
          ? baseIds[next.basePos]
          : null;
      const isRelabelPair =
        c.op === 'delete' &&
        next?.op === 'insert_after' &&
        insertTarget === c.blockId &&
        next.orderIndex === c.orderIndex + 1;
      if (isRelabelPair) {
        items.push({ key: c.id, suggestion: s, primary: c, paired: next });
        i += 2;
      } else {
        items.push({ key: c.id, suggestion: s, primary: c });
        i += 1;
      }
    }
  }
  return items;
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
  // Stage 1: the panel starts as a one-line bar; the card list is opt-in so
  // the document keeps its full height until the reviewer chooses to review.
  const [expanded, setExpanded] = useState(false);
  const [suggestions = []] = useCachedQuery(queries.canvasSuggestions({ canvasId }), {
    enabled: Boolean(canvasId),
  });

  const items = useMemo(() => buildItems(suggestions as unknown as Suggestion[]), [suggestions]);

  const anchors = useMemo(
    () =>
      items.map(it => {
        const baseIds = (it.suggestion.baseBlockIds as string[] | null) ?? [];
        const insertNeighbour =
          it.primary.basePos !== null && it.primary.basePos >= 0
            ? (baseIds[it.primary.basePos] ?? null)
            : null;
        return {
          blockId: it.primary.blockId ?? insertNeighbour,
          status: it.primary.status,
        };
      }),
    [items],
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

  const resolveItem = useCallback(
    (item: ReviewItem, accept: boolean) => {
      const timestamp = Date.now();
      if (item.paired && accept) {
        // Both halves as ONE batched apply — one document read, one write.
        return run(
          item.key,
          mutators.canvasSuggestion.acceptChanges({
            changeIds: [item.primary.id, item.paired.id],
            timestamp,
          }),
          'Failed to accept change',
        );
      }
      const ids = item.paired ? [item.primary.id, item.paired.id] : [item.primary.id];
      return (async () => {
        for (const changeId of ids) {
          await run(
            item.key,
            mutators.canvasSuggestion.resolveChange({ changeId, accept, timestamp }),
            accept ? 'Failed to accept change' : 'Failed to reject change',
          );
        }
      })();
    },
    [run],
  );

  if (!items.length) return null;

  const first = items[0]?.suggestion;
  const actionable = items.filter(it => it.primary.status === 'PENDING');
  const conflicts = items.filter(it => it.primary.status !== 'PENDING');

  // ── Stage 1: the collapsed bar ──────────────────────────────────────────
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
        Agent proposed {actionable.length} change
        {actionable.length === 1 ? '' : 's'}
        {conflicts.length ? (
          <span className='rounded-sm bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-amber-900'>
            {conflicts.length} need attention
          </span>
        ) : null}
        <span className='text-xs text-muted-foreground'>{expanded ? 'hide' : 'review'} ▾</span>
      </button>
      {canEdit && first && actionable.length > 0 ? (
        <div className='flex items-center gap-2'>
          <button
            type='button'
            disabled={busy !== null}
            onClick={() => {
              void run(
                'accept-all',
                mutators.canvasSuggestion.acceptAll({
                  suggestionId: first.id,
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
                mutators.canvasSuggestion.rejectAll({
                  suggestionId: first.id,
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
        'shrink-0 border-b border-border bg-background px-3 py-2 text-sm md:px-4',
        className,
      )}
    >
      {bar}
      {expanded ? (
        <div className='mt-3 max-h-80 space-y-2 overflow-auto'>
          {items.map((item, index) => {
            const { primary, paired } = item;
            const isPair = Boolean(paired);
            const before = blockText(primary.beforeContent);
            const after = asText(paired ? paired.afterContent : primary.afterContent);
            const isTable =
              blockType(primary.beforeContent) === 'table' ||
              (primary.op === 'insert_after' && after.trimStart().startsWith('|'));
            const blocked = primary.status !== 'PENDING';

            // Word diff only for readable same-paragraph edits; tables and replace-pairs show whole blocks.
            const wordParts =
              !isPair && !isTable && primary.op === 'replace'
                ? createCanvasContentTextDiff(
                    [{ type: 'paragraph', content: [{ type: 'text', text: before, styles: {} }] }],
                    [{ type: 'paragraph', content: [{ type: 'text', text: after, styles: {} }] }],
                  )
                : null;
            const parts =
              wordParts && changeRatio(wordParts) <= WORD_DIFF_MAX_CHANGE_RATIO ? wordParts : null;

            const label = isPair
              ? 'replace this paragraph'
              : primary.op === 'delete'
                ? 'remove'
                : primary.op === 'insert_after'
                  ? 'add'
                  : isTable
                    ? 'table changed'
                    : 'edit';

            return (
              <div
                key={item.key}
                data-suggestion-card-block={anchors[index]?.blockId ?? undefined}
                data-track-category='CANVAS'
                data-track-name='suggestion_card_focus'
                role={anchors[index]?.blockId ? 'button' : undefined}
                tabIndex={anchors[index]?.blockId ? 0 : undefined}
                onClick={() => focusChange(anchors[index]?.blockId ?? null)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    focusChange(anchors[index]?.blockId ?? null);
                  }
                }}
                className={cn(
                  'rounded-md border bg-muted/20 px-3 py-2 transition-colors',
                  anchors[index]?.blockId &&
                    'cursor-pointer hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500',
                  activeBlockId && anchors[index]?.blockId === activeBlockId
                    ? 'border-amber-500 bg-amber-50/60'
                    : 'border-border',
                )}
              >
                <div className='mb-1 flex items-center justify-between gap-2'>
                  <span className='text-[11px] font-medium uppercase text-muted-foreground'>
                    Change {index + 1} · {label}
                  </span>
                  {blocked ? (
                    <span
                      className={cn(
                        'rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase',
                        primary.status === 'CONFLICT'
                          ? 'bg-amber-100 text-amber-900'
                          : 'bg-red-100 text-red-900',
                      )}
                    >
                      {primary.status === 'CONFLICT'
                        ? 'edited since proposed'
                        : 'no longer applies'}
                    </span>
                  ) : null}
                </div>

                {primary.op === 'insert_after' && !isPair && anchors[index]?.blockId ? (
                  <div className='mb-1 text-[11px] italic text-muted-foreground'>
                    will be added after the highlighted paragraph
                  </div>
                ) : null}
                <div className='whitespace-pre-wrap break-words text-sm leading-6'>
                  {parts ? (
                    parts.filter(isVisibleCanvasContentDiffPart).length ? (
                      parts.map((part, i) => (
                        <span
                          key={`${item.key}-${i}`}
                          className={cn(
                            part.type === 'added' &&
                              'rounded-sm bg-emerald-100 px-0.5 text-emerald-950',
                            part.type === 'removed' &&
                              'rounded-sm bg-red-100 px-0.5 text-red-950 line-through decoration-red-700',
                          )}
                        >
                          {part.value}
                        </span>
                      ))
                    ) : (
                      <span className='text-muted-foreground'>
                        Changes affect formatting or non-text content only
                      </span>
                    )
                  ) : (
                    <>
                      {before ? (
                        <div
                          className={cn(
                            'mb-1 rounded-sm bg-red-50 px-1.5 py-1 text-red-900',
                            isTable ? 'font-mono text-xs' : 'line-through decoration-red-700/70',
                          )}
                        >
                          {before}
                        </div>
                      ) : null}
                      {after ? (
                        <div
                          className={cn(
                            'rounded-sm bg-emerald-50 px-1.5 py-1 text-emerald-950',
                            isTable && 'font-mono text-xs',
                          )}
                        >
                          {after}
                        </div>
                      ) : null}
                    </>
                  )}
                </div>

                {canEdit && !blocked ? (
                  <div
                    className='mt-2 flex items-center gap-2'
                    role='presentation'
                    data-track-category='CANVAS'
                    data-track-name='suggestion_card_actions_boundary'
                    onClick={e => e.stopPropagation()}
                  >
                    <button
                      type='button'
                      disabled={busy !== null}
                      onClick={() => void resolveItem(item, true)}
                      data-track-category='CANVAS'
                      data-track-name='suggestion_accept'
                      className='rounded-md bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50'
                    >
                      Accept{isPair ? ' both' : ''}
                    </button>
                    <button
                      type='button'
                      disabled={busy !== null}
                      onClick={() => void resolveItem(item, false)}
                      data-track-category='CANVAS'
                      data-track-name='suggestion_reject'
                      className='rounded-md border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground hover:bg-muted'
                    >
                      Reject{isPair ? ' both' : ''}
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};
