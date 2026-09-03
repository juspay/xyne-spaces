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
import { Check, Eye, EyeOff, Sparkles, X } from 'lucide-react';
import { Button } from '../../ui/Button';
import { Badge } from '../../ui/Badge';

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
  reviewMode?: boolean;
  onToggleReview?: () => void;
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
  reviewMode = false,
  onToggleReview,
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
  const attention = visible.filter(r => r.status === 'STALE');

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

  useEffect(() => {
    if (!reviewMode) return;
    const container = editorContainerRef?.current;
    if (!container) return;
    const raf = requestAnimationFrame(() => {
      container
        .querySelector('[data-suggestion-widget]')
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return (): void => cancelAnimationFrame(raf);
  }, [reviewMode, editorContainerRef]);

  if (!batches) return null;

  const count = pending.length;

  return (
    <div
      className={cn(
        'flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/50 px-3 py-2 text-sm md:px-4',
        className,
      )}
      data-testid='canvas-suggestions-bar'
    >
      <div className='flex min-w-0 flex-wrap items-center gap-2'>
        <Sparkles size={16} className='shrink-0 text-primary' aria-hidden />
        <span className='truncate'>
          <span className='font-medium text-foreground'>
            {count} suggested {count === 1 ? 'change' : 'changes'}
          </span>
          <span className='text-muted-foreground'> from the agent</span>
        </span>
        {attention.length ? (
          <Badge variant='outline' className='text-muted-foreground'>
            {attention.length} no longer {attention.length === 1 ? 'applies' : 'apply'}
          </Badge>
        ) : null}
      </div>
      <div className='flex items-center gap-2'>
        {onToggleReview ? (
          <Button
            variant='secondary'
            size='sm'
            onClick={onToggleReview}
            aria-pressed={reviewMode}
            data-track-category='CANVAS'
            data-track-name={reviewMode ? 'SUGGESTIONS_HIDE' : 'SUGGESTIONS_REVIEW'}
          >
            {reviewMode ? <EyeOff size={14} /> : <Eye size={14} />}
            {reviewMode ? 'Hide' : 'Review'}
          </Button>
        ) : null}
        {canEdit && count > 0 ? (
          <>
            <Button
              variant='outline'
              size='sm'
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
              data-track-name='SUGGESTIONS_ACCEPT_ALL'
            >
              <Check size={14} />
              Accept all
            </Button>
            <Button
              variant='outline'
              size='sm'
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
              data-track-name='SUGGESTIONS_REJECT_ALL'
            >
              <X size={14} />
              Reject all
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
};
