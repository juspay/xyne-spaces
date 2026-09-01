// Bar over the canvas for pending agent suggestions. The suggestions
// themselves are painted inline in the document (suggestionDecorations.ts,
// Google-Docs style); this bar carries the counts and accept-all/reject-all,
// and routes the inline ✓/✗ button clicks to the Zero mutators.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from 'react';
import { toast } from 'sonner';

import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useZero } from '../../../hooks/useZero';
import { queries } from '../../../zero/queries';
import { mutators } from '../../../zero/mutators';
import { cn } from '../../../utils/classNames';
import {
  useCanvasSuggestionAccept,
  type SuggestionEditorHandle,
} from '../useCanvasSuggestionAccept';

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

interface Props {
  canvasId: string;
  canEdit: boolean;
  editorContainerRef?: RefObject<HTMLElement | null>;
  editorRef?: RefObject<SuggestionEditorHandle | null>;
  className?: string;
}

/** A batch stays visible (rows painted, counted) while it has a PENDING row. */
const visibleRowsOf = (rows: SuggestionRow[]): { visible: SuggestionRow[]; batches: number } => {
  const byBatch = new Map<string, SuggestionRow[]>();
  for (const row of rows) {
    byBatch.set(row.batchId, [...(byBatch.get(row.batchId) ?? []), row]);
  }
  const visible: SuggestionRow[] = [];
  let batches = 0;
  for (const batchRows of byBatch.values()) {
    if (!batchRows.some(r => r.status === 'PENDING')) continue;
    batches += 1;
    visible.push(...batchRows);
  }
  return { visible, batches };
};

export const CanvasSuggestionsPanel = ({
  canvasId,
  canEdit,
  editorContainerRef,
  editorRef,
  className,
}: Props): ReactElement | null => {
  const z = useZero();
  const [busy, setBusy] = useState<string | null>(null);
  const [rows = []] = useCachedQuery(queries.canvasSuggestionChanges({ canvasId }), {
    enabled: Boolean(canvasId),
  });

  const { visible, batches } = useMemo(
    () => visibleRowsOf(rows as unknown as SuggestionRow[]),
    [rows],
  );
  const pending = visible.filter(r => r.status === 'PENDING');
  const attention = visible.filter(r => r.status !== 'PENDING');

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

  const clientApply = useCanvasSuggestionAccept(canvasId, editorRef, editorContainerRef);

  /** Apply in this browser when possible (undoable); null → legacy server apply. */
  const tryClientApply = useCallback(
    async (targets: SuggestionRow[]) => {
      try {
        return await clientApply(targets);
      } catch {
        return null;
      }
    },
    [clientApply],
  );

  const resolveRow = useCallback(
    async (row: SuggestionRow, accept: boolean) => {
      const outcome = accept ? await tryClientApply([row]) : null;
      return run(
        row.id,
        mutators.canvasSuggestion.resolveChange({
          changeId: row.id,
          accept,
          timestamp: Date.now(),
          ...(outcome ? { outcome } : {}),
        }),
        accept ? 'Failed to accept change' : 'Failed to reject change',
      );
    },
    [run, tryClientApply],
  );

  // Inline ✓/✗ clicks: the buttons live in editor decorations (plain DOM, no
  // React), so one delegated listener on the editor container routes them here.
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  useEffect(() => {
    const container = editorContainerRef?.current;
    if (!container) return;
    const onClick = (e: MouseEvent): void => {
      const target = e.target as HTMLElement;
      const btn = target.closest?.('[data-suggestion-action]');
      if (btn && canEdit) {
        e.preventDefault();
        e.stopPropagation();
        if (busyRef.current !== null) return;
        const row = visibleRef.current.find(r => r.id === btn.getAttribute('data-suggestion-id'));
        if (!row) return;
        void resolveRow(row, btn.getAttribute('data-suggestion-action') === 'accept');
        return;
      }
      // A move's source chip and destination ghost jump to each other.
      const jump = target.closest?.('[data-suggestion-jump]');
      const jumpId = jump?.getAttribute('data-suggestion-jump');
      if (jumpId) {
        e.preventDefault();
        container
          .querySelector(`[data-id="${CSS.escape(jumpId)}"]`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    };
    container.addEventListener('click', onClick);
    return (): void => container.removeEventListener('click', onClick);
  }, [editorContainerRef, canEdit, resolveRow]);

  if (!batches) return null;

  return (
    <div
      className={cn(
        'border-b border-border bg-amber-50/50 px-4 py-2 dark:bg-amber-950/20',
        className,
      )}
    >
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <span className='flex items-center gap-2 text-sm font-medium text-foreground'>
          <span aria-hidden>✦</span>
          Agent proposed {pending.length} change
          {pending.length === 1 ? '' : 's'} — review them in the document
          {batches > 1 ? (
            <span className='text-xs text-muted-foreground'>({batches} proposals)</span>
          ) : null}
          {attention.length ? (
            <span className='rounded-sm bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-amber-900'>
              {attention.length} need attention
            </span>
          ) : null}
        </span>
        {canEdit && pending.length > 0 ? (
          <div className='flex items-center gap-2'>
            <button
              type='button'
              disabled={busy !== null}
              onClick={() => {
                void (async (): Promise<void> => {
                  const outcome = await tryClientApply(pending);
                  await run(
                    'accept-all',
                    mutators.canvasSuggestion.resolveAll({
                      canvasId,
                      accept: true,
                      timestamp: Date.now(),
                      ...(outcome ? { outcome } : {}),
                    }),
                    'Failed to accept changes',
                  );
                })();
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
    </div>
  );
};
