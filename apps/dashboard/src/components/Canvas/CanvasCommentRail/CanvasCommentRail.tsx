import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MessageSquare } from 'lucide-react';
import { CanvasCommentThreadStatus } from '@xyne/shared';
import { v4 as uuidv4 } from 'uuid';

import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { logger, Event } from '../../../utils/logger';
import { cn } from '../../../utils/classNames';
import type { CanvasCommentHighlightThread } from '../useCanvasCommentHighlights';
import type { CanvasCommentAnchor } from '../CanvasCommentsPanel/CanvasCommentsPanel';
import { CanvasCommentCard } from './CanvasCommentCard';
import { CanvasCommentDraftCard } from './CanvasCommentDraftCard';
import { useCanvasCommentAnchors } from './useCanvasCommentAnchors';

/** Matches --canvas-comment-rail-width in global.css. */
const RAIL_WIDTH = 344;
/** Inset from the scroll container's right edge. */
const RAIL_INSET = 24;
const CARD_WIDTH = RAIL_WIDTH - RAIL_INSET * 2;
const CARD_GAP = 12;
const FALLBACK_CARD_HEIGHT = 104;
const DRAFT_CARD_HEIGHT = 128;

interface CanvasCommentRailProps {
  canvasId: string;
  containerRef: React.RefObject<HTMLElement | null>;
  threads: CanvasCommentHighlightThread[];
  activeThreadId: string | null;
  editable: boolean;
  enabled?: boolean;
  refreshKey?: unknown;
  onActivate: (threadId: string | null) => void;
  /** In-flight new comment: shown as a card in the rail beside its selection. */
  draft?: { anchor: CanvasCommentAnchor; rect: DOMRect } | null;
  onDraftBeforeCreate?: ((threadId: string, anchor: CanvasCommentAnchor) => boolean) | undefined;
  onDraftCreated?: (() => void) | undefined;
  onDraftFailed?: ((anchor: CanvasCommentAnchor) => void) | undefined;
  onDraftCancel?: (() => void) | undefined;
}

export function CanvasCommentRail({
  canvasId,
  containerRef,
  threads,
  activeThreadId,
  editable,
  enabled = true,
  refreshKey,
  onActivate,
  draft,
  onDraftBeforeCreate,
  onDraftCreated,
  onDraftFailed,
  onDraftCancel,
}: CanvasCommentRailProps): React.JSX.Element | null {
  const zero = useZero();
  const openThreads = threads.filter(thread => thread.status === CanvasCommentThreadStatus.OPEN);

  const { scrollContainer, positions, isNarrow, remeasure } = useCanvasCommentAnchors({
    containerRef,
    threads: openThreads,
    enabled,
    refreshKey,
    // A card needs its own width plus the inset — not the full rail track.
    railWidth: CARD_WIDTH + RAIL_INSET,
  });

  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [heights, setHeights] = useState<Record<string, number>>({});

  // Measure rendered card heights so the stack can account for tall threads.
  useLayoutEffect(() => {
    const next: Record<string, number> = {};
    let changed = false;
    Object.entries(cardRefs.current).forEach(([id, element]) => {
      if (!element) return;
      const height = element.offsetHeight;
      if (!height) return;
      next[id] = height;
      if (heights[id] !== height) changed = true;
    });
    if (changed || Object.keys(next).length !== Object.keys(heights).length) {
      setHeights(next);
    }
  });

  // Re-measure anchors when the active card expands or collapses — the stack
  // below it has to move to make room.
  useEffect(() => {
    remeasure();
  }, [activeThreadId, remeasure]);

  // Reserve the reading column's right gutter while the rail has anything to
  // show, so cards never sit on top of the text. Removing the flag lets the
  // column glide back to full width.
  const hasContent = Boolean(openThreads.length || draft);
  useEffect(() => {
    const surface =
      containerRef.current?.querySelector<HTMLElement>('.canvas-surface') ??
      containerRef.current?.closest<HTMLElement>('.canvas-surface') ??
      null;
    if (!surface) return;
    if (hasContent) surface.dataset['canvasCommentRail'] = 'on';
    else delete surface.dataset['canvasCommentRail'];
    return () => {
      delete surface.dataset['canvasCommentRail'];
    };
  }, [containerRef, hasContent]);

  const reply = useCallback(
    (thread: CanvasCommentHighlightThread, body: string): void => {
      const result = zero.mutate(
        mutators.canvasComment.reply({
          commentId: uuidv4(),
          threadId: thread.id,
          canvasId,
          body,
          mentionedUserIds: [],
          timestamp: Date.now(),
        }),
      );
      void result.server.catch((error: unknown) => {
        logger.error(Event.API_CALL_FAILED, { reason: error, context: 'canvas_comment_reply' });
      });
    },
    [canvasId, zero],
  );

  const setStatus = useCallback(
    (thread: CanvasCommentHighlightThread): void => {
      zero.mutate(
        mutators.canvasComment.setThreadStatus({
          threadId: thread.id,
          status:
            thread.status === CanvasCommentThreadStatus.RESOLVED
              ? CanvasCommentThreadStatus.OPEN
              : CanvasCommentThreadStatus.RESOLVED,
          timestamp: Date.now(),
        }),
      );
    },
    [zero],
  );

  if (!enabled || !scrollContainer || (!openThreads.length && !draft)) return null;

  // Ideal position is the anchor's top; each card is then pushed down past the
  // one above it. Sorting by anchor keeps document order.
  const ordered = openThreads
    .filter(thread => positions[thread.id])
    .sort((a, b) => (positions[a.id]?.top ?? 0) - (positions[b.id]?.top ?? 0));

  // Selection rect is in viewport space; convert to the scroll container's
  // content space so the draft sits in the same coordinate system as the cards.
  const scrollRect = scrollContainer.getBoundingClientRect();
  const draftTop = draft
    ? Math.round(draft.rect.top - scrollRect.top + scrollContainer.scrollTop)
    : null;

  const layout: Record<string, number> = {};
  let cursor = Number.NEGATIVE_INFINITY;
  let draftLayoutTop = draftTop;
  let draftPlaced = draftTop === null;

  const placeDraft = (): void => {
    if (draftPlaced || draftTop === null) return;
    draftLayoutTop = Math.max(draftTop, cursor);
    cursor = draftLayoutTop + (heights['__draft'] ?? DRAFT_CARD_HEIGHT) + CARD_GAP;
    draftPlaced = true;
  };

  ordered.forEach(thread => {
    const anchor = positions[thread.id];
    if (!anchor) return;
    // The draft claims its slot in document order, so cards below shift down
    // for it instead of overlapping.
    if (draftTop !== null && !draftPlaced && draftTop <= anchor.top) placeDraft();
    const height = heights[thread.id] ?? FALLBACK_CARD_HEIGHT;
    const top = Math.max(anchor.top - 2, cursor);
    layout[thread.id] = top;
    cursor = top + height + CARD_GAP;
  });
  placeDraft();

  const rail = (
    <div
      className='pointer-events-none absolute right-0 top-0 z-20'
      style={{ width: RAIL_WIDTH, bottom: 0 }}
      data-canvas-comment-rail='true'
    >
      {ordered.map(thread => {
        const anchor = positions[thread.id];
        if (!anchor) return null;
        const isActive = activeThreadId === thread.id;

        // Narrow: collapse to a margin badge, float the open card over the doc.
        if (isNarrow && !isActive) {
          return (
            <button
              key={thread.id}
              type='button'
              onClick={() => onActivate(thread.id)}
              style={{ top: anchor.top }}
              className='canvas-comment-badge pointer-events-auto absolute right-3 inline-flex h-[26px] items-center gap-1.5 rounded-lg border border-border bg-card px-2 text-muted-foreground shadow-[0_1px_2px_hsl(var(--foreground)/0.05)] hover:bg-accent hover:text-foreground'
              aria-label={`${thread.commentCount ?? 1} comments on this text`}
              data-track-category='CANVAS'
              data-track-name='Canvas_Comment_Badge_Open'
            >
              <MessageSquare className='size-3.5' />
              <span className='text-[11.5px] font-semibold'>{thread.commentCount ?? 1}</span>
            </button>
          );
        }

        const floating = isNarrow && isActive;

        return (
          <div
            key={thread.id}
            ref={element => {
              cardRefs.current[thread.id] = element;
            }}
            className={cn(
              'canvas-comment-rail__slot pointer-events-auto',
              floating ? 'fixed' : 'absolute',
              isActive && !floating && 'canvas-comment-rail__slot--active',
            )}
            style={
              floating
                ? {
                    left: Math.min(
                      Math.max(anchor.viewportLeft, 16),
                      window.innerWidth - CARD_WIDTH - 16,
                    ),
                    top: anchor.viewportBottom + 10,
                    width: CARD_WIDTH,
                    zIndex: 130,
                  }
                : { top: layout[thread.id] ?? anchor.top, right: RAIL_INSET, width: CARD_WIDTH }
            }
          >
            <CanvasCommentCard
              thread={thread}
              isActive={isActive}
              editable={editable}
              onSelect={() => onActivate(thread.id)}
              onResolveToggle={() => setStatus(thread)}
              onReply={body => reply(thread, body)}
            />
          </div>
        );
      })}

      {draft && draftLayoutTop !== null && (
        <div
          ref={element => {
            cardRefs.current['__draft'] = element;
          }}
          className='canvas-comment-rail__slot canvas-comment-rail__slot--active pointer-events-auto absolute'
          style={{ top: draftLayoutTop, right: RAIL_INSET, width: CARD_WIDTH }}
        >
          <CanvasCommentDraftCard
            canvasId={canvasId}
            anchor={draft.anchor}
            onBeforeCreate={onDraftBeforeCreate}
            onCreated={onDraftCreated}
            onFailed={onDraftFailed}
            onCancel={onDraftCancel ?? (() => undefined)}
          />
        </div>
      )}
    </div>
  );

  return createPortal(rail, scrollContainer);
}
