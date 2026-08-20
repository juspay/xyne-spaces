import type {
  BlockNoteEditor,
  BlockSchema,
  InlineContentSchema,
  StyleSchema,
} from '@blocknote/core';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

type CanvasEditorLike = BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>;

/** Style spec registered in `canvasSchema`; the mark carries the thread id. */
const COMMENT_THREAD_STYLE = 'canvasCommentThread';

/** BlockNote stores a `propSchema: 'string'` style value under this mark attribute. */
const COMMENT_THREAD_STYLE_VALUE_ATTR = 'stringValue';

/** One scan per burst of typing instead of one per keystroke. */
const SCAN_DEBOUNCE_MS = 150;

/**
 * The document can arrive after mount (initial load, first collaborative sync) without a
 * further change event, so the first scan is retried across that window.
 */
const SCAN_RETRY_DELAYS_MS = [100, 400, 900];

/**
 * How long a document with no text must stay quiet before it is believed to be genuinely empty
 * rather than still loading. Comfortably longer than a collaborative sync takes to land, and it
 * restarts on every document change — see `useCanvasCommentAnchors`.
 */
const EMPTY_DOCUMENT_SETTLE_MS = 2500;

interface ProseMirrorMarkLike {
  type: { name: string };
  attrs: Record<string, unknown>;
}

interface ProseMirrorNodeLike {
  isText: boolean;
  text?: string | undefined;
  marks: readonly ProseMirrorMarkLike[];
  descendants: (callback: (node: ProseMirrorNodeLike) => void) => void;
}

interface CanvasCommentAnchorScan {
  anchoredThreadIds: Set<string>;
  /** Whether the document held any text at all — see `useCanvasCommentAnchors`. */
  hasText: boolean;
}

const getEditorDocument = (editor: CanvasEditorLike | null): ProseMirrorNodeLike | null => {
  if (!editor) return null;
  try {
    return (
      (editor as unknown as { _tiptapEditor?: { state?: { doc?: ProseMirrorNodeLike } } })
        ._tiptapEditor?.state?.doc ?? null
    );
  } catch {
    return null;
  }
};

const isSameThreadIdSet = (a: Set<string>, b: Set<string>): boolean =>
  a.size === b.size && [...a].every(threadId => b.has(threadId));

/**
 * Walks the document for comment anchor marks. Returns null when there is no document to read.
 */
export const scanCanvasCommentAnchors = (
  editor: CanvasEditorLike | null,
): CanvasCommentAnchorScan | null => {
  const doc = getEditorDocument(editor);
  if (!doc) return null;

  const anchoredThreadIds = new Set<string>();
  let hasText = false;

  try {
    doc.descendants(node => {
      if (!hasText && node.isText && node.text && node.text.trim().length > 0) {
        hasText = true;
      }
      node.marks.forEach(mark => {
        if (mark.type.name !== COMMENT_THREAD_STYLE) return;
        const threadId = mark.attrs[COMMENT_THREAD_STYLE_VALUE_ATTR];
        if (typeof threadId === 'string' && threadId.length > 0) {
          anchoredThreadIds.add(threadId);
        }
      });
    });
  } catch {
    return null;
  }

  return { anchoredThreadIds, hasText };
};

interface UseCanvasCommentAnchorsOptions {
  canvasId?: string | undefined;
  containerRef: RefObject<HTMLElement | null>;
  getEditor: () => CanvasEditorLike | null;
  enabled?: boolean;
  /** Bumped by the editors on every document change, including undo and redo. */
  refreshKey?: unknown;
}

export interface CanvasCommentAnchors {
  /**
   * Thread ids whose anchor mark is still in the document, or `null` while that cannot be known
   * yet. Callers treat `null` as "show everything".
   */
  anchoredThreadIds: Set<string> | null;
  /**
   * Records an anchor the caller just wrote into the document, so a brand new thread is never
   * hidden for the one debounce window before the next scan sees its mark.
   */
  trackAnchoredThreadId: (threadId: string) => void;
}

/**
 * Tracks which comment threads still have their anchor in the document.
 *
 * The anchor mark lives in the document itself, so deleting the commented text takes the mark
 * with it and undo puts it back. Deriving comment visibility from the mark therefore gives a
 * comment exactly the lifetime of the text it annotates — including undo — without a second
 * source of truth that could disagree with the document.
 */
export const useCanvasCommentAnchors = ({
  canvasId,
  containerRef,
  getEditor,
  enabled = true,
  refreshKey,
}: UseCanvasCommentAnchorsOptions): CanvasCommentAnchors => {
  const [anchoredThreadIds, setAnchoredThreadIds] = useState<Set<string> | null>(null);

  /**
   * An editor that has not loaded its content yet is indistinguishable from one whose text was
   * all deleted: both scan as zero anchors. Text in the document settles that immediately and
   * for good — the flag stays set, so later emptying the whole canvas still drops its comments.
   * A document that has never held text is only trusted after the settle period below, so a slow
   * load never wipes every comment on screen.
   */
  const hasHeldTextRef = useRef(false);
  const getEditorRef = useRef(getEditor);
  getEditorRef.current = getEditor;

  useEffect(() => {
    hasHeldTextRef.current = false;
    setAnchoredThreadIds(null);
  }, [canvasId]);

  const trackAnchoredThreadId = useCallback((threadId: string): void => {
    setAnchoredThreadIds(current => {
      if (!current || current.has(threadId)) return current;
      const next = new Set(current);
      next.add(threadId);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      setAnchoredThreadIds(null);
      return;
    }

    // Reset on every document change, so the deadline means "quiet for this long", not "this
    // long after mount". Emptying the canvas therefore settles once the user stops deleting.
    let hasSettled = false;

    const scan = (): void => {
      const scanned = scanCanvasCommentAnchors(getEditorRef.current());
      if (!scanned) return;
      if (scanned.hasText) hasHeldTextRef.current = true;
      if (!hasHeldTextRef.current && !hasSettled) return;

      setAnchoredThreadIds(current =>
        current && isSameThreadIdSet(current, scanned.anchoredThreadIds)
          ? current
          : scanned.anchoredThreadIds,
      );
    };

    const settleTimeout = window.setTimeout(() => {
      hasSettled = true;
      scan();
    }, EMPTY_DOCUMENT_SETTLE_MS);

    let debounceTimeout: number | null = null;
    const scheduleScan = (): void => {
      if (debounceTimeout !== null) window.clearTimeout(debounceTimeout);
      debounceTimeout = window.setTimeout(() => {
        debounceTimeout = null;
        scan();
      }, SCAN_DEBOUNCE_MS);
    };

    scheduleScan();
    const retryTimeouts = SCAN_RETRY_DELAYS_MS.map(delay => window.setTimeout(scan, delay));

    // A remote collaborator's edit reaches the document without a local change event, so watch
    // the rendered anchors too rather than relying on the editor's onChange alone.
    const container = containerRef.current;
    const observer =
      container && typeof MutationObserver !== 'undefined'
        ? new MutationObserver(scheduleScan)
        : null;
    if (observer && container) {
      observer.observe(container, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['data-canvas-comment-thread-id'],
      });
    }

    return () => {
      if (debounceTimeout !== null) window.clearTimeout(debounceTimeout);
      window.clearTimeout(settleTimeout);
      retryTimeouts.forEach(timeout => window.clearTimeout(timeout));
      observer?.disconnect();
    };
  }, [containerRef, enabled, refreshKey]);

  return { anchoredThreadIds, trackAnchoredThreadId };
};
