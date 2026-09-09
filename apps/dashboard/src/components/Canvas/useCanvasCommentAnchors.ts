import type {
  BlockNoteEditor,
  BlockSchema,
  InlineContentSchema,
  StyleSchema,
} from '@blocknote/core';
import { useEffect, useRef, useState, type RefObject } from 'react';

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

/** Shared "nothing is lost" value, so a reset cannot churn consumers with a new identity. */
const NO_LOST_THREAD_IDS: Set<string> = new Set();

export interface CanvasCommentAnchors {
  /**
   * Threads whose anchor mark was seen in this document and is now gone — the commented text
   * was deleted. Callers hide these and show everything else.
   */
  lostThreadIds: Set<string>;
}

/**
 * Tracks comment threads whose anchor has been deleted from the document.
 *
 * The anchor mark lives in the document itself, so deleting the commented text takes the mark
 * with it and undo puts it back. Deriving comment visibility from the mark therefore gives a
 * comment exactly the lifetime of the text it annotates — including undo — without a second
 * source of truth that could disagree with the document.
 *
 * The rule is deliberately "hide what was observed to disappear", not "show only what carries
 * a mark". A missing mark has two causes that a scan cannot tell apart: the text was deleted,
 * or the mark was never in this document to begin with — a thread predating the mark, or one
 * whose write never reached the server because the debounced save was blocked by the content
 * size limit or dropped by a reload. Hiding on the second cause loses the comment everywhere
 * (panel, highlights and badge count) with nothing said, while the row still exists. So a
 * thread is only ever hidden once this hook has actually watched its mark go.
 */
export const useCanvasCommentAnchors = ({
  canvasId,
  containerRef,
  getEditor,
  enabled = true,
  refreshKey,
}: UseCanvasCommentAnchorsOptions): CanvasCommentAnchors => {
  const [lostThreadIds, setLostThreadIds] = useState<Set<string>>(NO_LOST_THREAD_IDS);

  /** Threads whose mark this document has carried at least once — the only ones losable. */
  const everAnchoredRef = useRef<Set<string>>(new Set());

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

  /** Set while the scan effect is mounted; lets a document change nudge it without a rebuild. */
  const scheduleScanRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    hasHeldTextRef.current = false;
    everAnchoredRef.current = new Set();
    setLostThreadIds(NO_LOST_THREAD_IDS);
  }, [canvasId]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      scheduleScanRef.current = null;
      setLostThreadIds(NO_LOST_THREAD_IDS);
      return;
    }

    let hasSettled = false;
    let settleTimeout: number | null = null;

    const scan = (): void => {
      const scanned = scanCanvasCommentAnchors(getEditorRef.current());
      if (!scanned) return;
      if (scanned.hasText) hasHeldTextRef.current = true;
      if (!hasHeldTextRef.current && !hasSettled) return;

      const everAnchored = everAnchoredRef.current;
      scanned.anchoredThreadIds.forEach(threadId => everAnchored.add(threadId));

      const nextLost = new Set<string>();
      everAnchored.forEach(threadId => {
        if (!scanned.anchoredThreadIds.has(threadId)) nextLost.add(threadId);
      });

      setLostThreadIds(current => (isSameThreadIdSet(current, nextLost) ? current : nextLost));
    };

    // Restarted by every document change, so the deadline means "quiet for this long", not
    // "this long after mount". Emptying the canvas therefore settles once the user stops
    // deleting, while a document still loading is never mistaken for an empty one.
    const restartSettleTimer = (): void => {
      hasSettled = false;
      if (settleTimeout !== null) window.clearTimeout(settleTimeout);
      settleTimeout = window.setTimeout(() => {
        settleTimeout = null;
        hasSettled = true;
        scan();
      }, EMPTY_DOCUMENT_SETTLE_MS);
    };

    let debounceTimeout: number | null = null;
    const scheduleScan = (): void => {
      if (debounceTimeout !== null) window.clearTimeout(debounceTimeout);
      debounceTimeout = window.setTimeout(() => {
        debounceTimeout = null;
        scan();
      }, SCAN_DEBOUNCE_MS);
    };

    // A remote collaborator's edit reaches the document without a local change event, so watch
    // the rendered anchors too rather than relying on the editor's onChange alone.
    //
    // Attaching is retried rather than done once: this effect no longer re-runs on every
    // document change, so a container that was not mounted yet at setup would otherwise never
    // be observed.
    let observer: MutationObserver | null = null;
    const ensureObserver = (): void => {
      if (observer || typeof MutationObserver === 'undefined') return;
      const container = containerRef.current;
      if (!container) return;

      observer = new MutationObserver(scheduleScan);
      observer.observe(container, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['data-canvas-comment-thread-id'],
      });
    };
    ensureObserver();

    restartSettleTimer();
    scheduleScan();
    const retryTimeouts = SCAN_RETRY_DELAYS_MS.map(delay =>
      window.setTimeout(() => {
        ensureObserver();
        scan();
      }, delay),
    );

    scheduleScanRef.current = (): void => {
      ensureObserver();
      restartSettleTimer();
      scheduleScan();
    };

    return () => {
      scheduleScanRef.current = null;
      if (debounceTimeout !== null) window.clearTimeout(debounceTimeout);
      if (settleTimeout !== null) window.clearTimeout(settleTimeout);
      retryTimeouts.forEach(timeout => window.clearTimeout(timeout));
      observer?.disconnect();
    };
    // `canvasId` belongs here: without it a canvas switch keeps the previous document's
    // settled state, and the next scan would publish an empty set over the new canvas.
  }, [canvasId, containerRef, enabled]);

  // Document changes only nudge the scan that is already running. Keying the effect above on
  // `refreshKey` instead would tear down and rebuild the MutationObserver, the observer's
  // initial scan and every timer on each keystroke, in both editors.
  useEffect(() => {
    scheduleScanRef.current?.();
  }, [refreshKey]);

  return { lostThreadIds };
};
