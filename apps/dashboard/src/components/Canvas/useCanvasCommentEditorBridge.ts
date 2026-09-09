import type {
  BlockNoteEditor,
  BlockSchema,
  InlineContentSchema,
  PartialBlock,
  StyleSchema,
} from '@blocknote/core';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { toast } from 'sonner';

import {
  CONTENT_SIZE_EXCEEDED_DESCRIPTION,
  CONTENT_SIZE_MAX_THRESHOLD,
  getContentSizeBytes,
} from '../../utils/canvasContentSize';
import { scrollToHeading } from '../../utils/canvasUtils';
import type { CanvasCommentAnchor } from './CanvasCommentsPanel/CanvasCommentsPanel';
import { useCanvasCommentAnchors } from './useCanvasCommentAnchors';
import {
  useCanvasCommentHighlights,
  type CanvasCommentHighlightThread,
} from './useCanvasCommentHighlights';

type CanvasEditorLike = BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>;

interface UseCanvasCommentEditorBridgeOptions {
  canvasId?: string | undefined;
  containerRef: RefObject<HTMLDivElement | null>;
  getEditor: () => CanvasEditorLike | null;
  initialBlockIdToFocus?: string | undefined;
  initialCommentThreadId?: string | undefined;
  onOpenCommentCountChange?: ((count: number) => void) | undefined;
  ready?: boolean;
}

export type CanvasInlineCommentThreadState =
  | {
      mode: 'thread';
      thread: CanvasCommentHighlightThread;
      rect: DOMRect;
    }
  | {
      mode: 'create';
      blockId: string;
      rect: DOMRect;
      anchor: CanvasCommentAnchor;
    }
  | null;

interface TiptapEditorLike {
  state: {
    selection: { from: number; to: number; empty?: boolean };
    doc: { textBetween: (from: number, to: number, blockSeparator?: string) => string };
  };
  commands: {
    setTextSelection: (range: { from: number; to: number }) => boolean;
  };
  view?: {
    posAtDOM: (node: Node, offset: number) => number;
  };
}

const getTiptapEditor = (editor: CanvasEditorLike): TiptapEditorLike | null =>
  ((editor as unknown as { _tiptapEditor?: unknown })._tiptapEditor as
    | TiptapEditorLike
    | undefined) ?? null;

const closeFormattingToolbar = (editor: CanvasEditorLike): void => {
  try {
    const toolbar = editor.extensions.get('formattingToolbar') as
      | { store?: { setState?: (value: boolean) => void } }
      | undefined;
    toolbar?.store?.setState?.(false);
  } catch {
    // Optional extension — the draft card still opens without it.
  }
};

const getSelectionRect = (container: HTMLElement | null, blockId: string): DOMRect | null => {
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0) {
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) return rect;
  }

  const escapedBlockId =
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(blockId)
      : blockId.replace(/["\\]/g, '\\$&');
  return (
    container
      ?.querySelector<HTMLElement>(`[data-id="${escapedBlockId}"]`)
      ?.getBoundingClientRect() ?? null
  );
};

const escapeSelectorValue = (value: string): string =>
  typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(value)
    : value.replace(/["\\]/g, '\\$&');

const getCommentThreadRect = (
  container: HTMLElement | null,
  blockId: string,
  threadId: string,
): DOMRect | null => {
  if (!container) return null;
  const escapedThreadId = escapeSelectorValue(threadId);
  const escapedBlockId = escapeSelectorValue(blockId);
  return (
    container
      .querySelector<HTMLElement>(`[data-canvas-comment-thread-id="${escapedThreadId}"]`)
      ?.getBoundingClientRect() ??
    container
      .querySelector<HTMLElement>(`[data-id="${escapedBlockId}"]`)
      ?.getBoundingClientRect() ??
    null
  );
};

/**
 * Puts the caret at the first character of the commented text rather than at the top of its
 * block, by mapping the rendered anchor back to a document position. Returns false when the
 * anchor is not rendered, so the caller can fall back to the block.
 */
const focusCommentAnchorStart = (
  editor: CanvasEditorLike,
  container: HTMLElement | null,
  threadId: string,
): boolean => {
  if (!container) return false;

  const anchorElement = container.querySelector<HTMLElement>(
    `[data-canvas-comment-thread-id="${escapeSelectorValue(threadId)}"]`,
  );
  if (!anchorElement) return false;

  const tiptapEditor = getTiptapEditor(editor);
  const view = tiptapEditor?.view;
  if (!tiptapEditor || !view) return false;

  try {
    const position = view.posAtDOM(anchorElement, 0);
    if (typeof position !== 'number' || Number.isNaN(position) || position < 0) return false;

    tiptapEditor.commands.setTextSelection({ from: position, to: position });
    (editor as unknown as { focus?: () => void }).focus?.();
    anchorElement.scrollIntoView({ block: 'center' });
    return true;
  } catch {
    return false;
  }
};

const INLINE_COMMENT_INTERACTIVE_SELECTOR = [
  '[data-canvas-inline-comment-thread="true"]',
  // The comments panel is part of the same surface: browsing it, or the rail syncing its
  // scroll to the document, must not count as scrolling away from the card.
  '[data-canvas-comments-panel="true"]',
  '[data-overlay-portal]',
  '[data-radix-popper-content-wrapper]',
  '[data-testid="user-search-results"]',
  '.EmojiPickerReact',
  '.epr-main',
].join(',');

export function useCanvasCommentEditorBridge({
  canvasId,
  containerRef,
  getEditor,
  initialBlockIdToFocus,
  initialCommentThreadId,
  onOpenCommentCountChange,
  ready = true,
}: UseCanvasCommentEditorBridgeOptions) {
  const [isCommentsOpen, setIsCommentsOpen] = useState(false);
  const [activeCommentBlockId, setActiveCommentBlockId] = useState<string | null>(null);
  const [activeCommentThreadId, setActiveCommentThreadId] = useState<string | null>(null);
  const [activeCommentAnchor, setActiveCommentAnchor] = useState<CanvasCommentAnchor | null>(null);
  const [inlineCommentThread, setInlineCommentThread] =
    useState<CanvasInlineCommentThreadState>(null);
  const [commentThreads, setCommentThreads] = useState<CanvasCommentHighlightThread[]>([]);
  const [commentHighlightVersion, setCommentHighlightVersion] = useState(0);
  const openedInitialThreadKeyRef = useRef<string | null>(null);

  /** Read by the anchor-click handler, which must not be rebuilt when the panel opens. */
  const isCommentsOpenRef = useRef(isCommentsOpen);
  isCommentsOpenRef.current = isCommentsOpen;

  const refreshCommentHighlights = useCallback(() => {
    setCommentHighlightVersion(version => version + 1);
  }, []);

  const handleCommentAnchorClick = useCallback(
    (thread: CanvasCommentHighlightThread, rect?: DOMRect): void => {
      // The panel stays open — clicking an anchor selects a thread, it does not dismiss the list.
      setActiveCommentBlockId(thread.blockId);
      setActiveCommentThreadId(thread.id);
      setActiveCommentAnchor(null);
      // The floating card is the panel's stand-in. With the panel open the rail already shows
      // this thread and `activeThreadId` highlights it, so also floating a card over the
      // document would render the same thread twice.
      if (rect && !isCommentsOpenRef.current) {
        setInlineCommentThread({
          mode: 'thread',
          thread,
          rect,
        });
      }
    },
    [],
  );

  // The anchor mark is part of the document, so it dies with the text it wraps and comes back
  // with an undo. Everything that shows a comment hides these ids and shows the rest — a
  // thread is dropped only once its mark has been watched disappearing, never merely for
  // lacking one. See useCanvasCommentAnchors.
  const { lostThreadIds: lostCommentThreadIds } = useCanvasCommentAnchors({
    canvasId,
    containerRef,
    getEditor,
    enabled: ready && Boolean(canvasId),
    refreshKey: commentHighlightVersion,
  });

  useCanvasCommentHighlights({
    canvasId,
    containerRef,
    enabled: ready && Boolean(canvasId),
    refreshKey: commentHighlightVersion,
    activeThreadId: activeCommentThreadId,
    lostThreadIds: lostCommentThreadIds,
    onAnchorClick: handleCommentAnchorClick,
    onOpenCountChange: onOpenCommentCountChange,
    onThreadsChange: setCommentThreads,
  });

  // A card left open over text that just got deleted has nothing to point at.
  useEffect(() => {
    if (!activeCommentThreadId) return;
    if (!lostCommentThreadIds.has(activeCommentThreadId)) return;
    setInlineCommentThread(null);
    setActiveCommentThreadId(null);
  }, [activeCommentThreadId, lostCommentThreadIds]);

  useEffect(() => {
    setInlineCommentThread(current => {
      if (!current || current.mode !== 'thread') return current;
      const latestThread = commentThreads.find(thread => thread.id === current.thread.id);
      if (!latestThread || latestThread === current.thread) return current;
      return {
        ...current,
        thread: latestThread,
      };
    });
  }, [commentThreads]);

  useEffect(() => {
    if (!inlineCommentThread) return;

    // Both paths must also drop the active thread. Its badge is hidden with
    // `pointer-events: none` while active, so leaving the id set after the card closes would
    // leave an invisible, unclickable badge behind and the next click would do nothing.
    const dismissInlineThread = (): void => {
      setInlineCommentThread(null);
      setActiveCommentThreadId(null);
    };

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(INLINE_COMMENT_INTERACTIVE_SELECTOR)) return;
      dismissInlineThread();
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        dismissInlineThread();
      }
    };

    // Scrolling the document dismisses the card, but scrolling inside it (a long thread)
    // must not. Capture phase is required — scroll events do not bubble.
    const handleScroll = (event: Event): void => {
      const target = event.target;
      if (target instanceof Element && target.closest(INLINE_COMMENT_INTERACTIVE_SELECTOR)) return;
      dismissInlineThread();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('scroll', handleScroll, true);
    };
  }, [inlineCommentThread]);

  useEffect(() => {
    const editor = getEditor();
    if (!ready || !editor || !initialBlockIdToFocus || !containerRef.current) return;

    try {
      editor.setTextCursorPosition(initialBlockIdToFocus, 'start');
      scrollToHeading(initialBlockIdToFocus, containerRef.current);
    } catch {
      scrollToHeading(initialBlockIdToFocus, containerRef.current);
    }
  }, [containerRef, getEditor, initialBlockIdToFocus, ready]);

  useEffect(() => {
    if (!ready || !initialBlockIdToFocus || !initialCommentThreadId) return;
    const initialThreadKey = `${initialBlockIdToFocus}:${initialCommentThreadId}`;
    if (openedInitialThreadKeyRef.current === initialThreadKey) return;

    setIsCommentsOpen(false);
    setActiveCommentBlockId(initialBlockIdToFocus);
    setActiveCommentThreadId(initialCommentThreadId);
    setActiveCommentAnchor(null);

    const openInlineThread = (): void => {
      const thread = commentThreads.find(candidate => candidate.id === initialCommentThreadId);
      if (!thread) return;
      const rect = getCommentThreadRect(
        containerRef.current,
        initialBlockIdToFocus,
        initialCommentThreadId,
      );
      if (!rect) return;
      openedInitialThreadKeyRef.current = initialThreadKey;
      setInlineCommentThread({
        mode: 'thread',
        thread,
        rect,
      });
    };

    openInlineThread();
    const timeout = window.setTimeout(openInlineThread, 300);
    return () => window.clearTimeout(timeout);
  }, [commentThreads, containerRef, initialBlockIdToFocus, initialCommentThreadId, ready]);

  const getCurrentBlockId = useCallback((): string | null => {
    const editor = getEditor();
    if (!editor) return null;
    try {
      return editor.getTextCursorPosition().block?.id ?? null;
    } catch {
      return null;
    }
  }, [getEditor]);

  const getCurrentCommentAnchor = useCallback((): CanvasCommentAnchor | null => {
    const editor = getEditor();
    if (!editor) return null;
    try {
      const block = editor.getTextCursorPosition().block;
      const blockId = block?.id;
      const tiptapEditor = getTiptapEditor(editor);

      if (!blockId || !tiptapEditor || tiptapEditor.state.selection.empty) return null;

      const { from, to } = tiptapEditor.state.selection;
      const anchorText = tiptapEditor.state.doc.textBetween(from, to, ' ').trim();
      if (!anchorText) return null;

      return {
        blockId,
        anchorText,
        selectionFrom: from,
        selectionTo: to,
      };
    } catch {
      return null;
    }
  }, [getEditor]);

  /**
   * Writes the anchor mark for a new thread. Returning false aborts the thread, and every such
   * path reports its own reason — the caller stays silent rather than guessing at one.
   */
  const applyCommentAnchorStyle = useCallback(
    (threadId: string, anchor: CanvasCommentAnchor): boolean => {
      const editor = getEditor();
      if (
        !editor ||
        typeof anchor.selectionFrom !== 'number' ||
        typeof anchor.selectionTo !== 'number'
      ) {
        toast.error('Unable to attach comment to selected text');
        return false;
      }
      // The anchor is a mark in the document, so it only survives a reload if the document
      // saves. Past the size ceiling the editor stops saving, which would leave a thread row
      // with no anchor — a comment that vanishes on the next load with nothing said. Refuse
      // it up front instead.
      const sizeBytes = getContentSizeBytes(editor.document as PartialBlock[]);
      if (sizeBytes >= CONTENT_SIZE_MAX_THRESHOLD) {
        toast.error('Content Too Large', {
          description: CONTENT_SIZE_EXCEEDED_DESCRIPTION(sizeBytes),
        });
        return false;
      }

      try {
        const tiptapEditor = getTiptapEditor(editor);
        if (!tiptapEditor) {
          toast.error('Unable to attach comment to selected text');
          return false;
        }
        tiptapEditor.commands.setTextSelection({
          from: anchor.selectionFrom,
          to: anchor.selectionTo,
        });
        editor.addStyles({ canvasCommentThread: threadId } as never);
        tiptapEditor.commands.setTextSelection({
          from: anchor.selectionTo,
          to: anchor.selectionTo,
        });
        refreshCommentHighlights();
        return true;
      } catch {
        toast.error('Unable to attach comment to selected text');
        return false;
      }
    },
    [getEditor, refreshCommentHighlights],
  );

  const removeCommentAnchorStyle = useCallback(
    (anchor: CanvasCommentAnchor): void => {
      const editor = getEditor();
      if (
        !editor ||
        typeof anchor.selectionFrom !== 'number' ||
        typeof anchor.selectionTo !== 'number'
      ) {
        return;
      }
      try {
        const tiptapEditor = getTiptapEditor(editor);
        if (!tiptapEditor) return;
        tiptapEditor.commands.setTextSelection({
          from: anchor.selectionFrom,
          to: anchor.selectionTo,
        });
        editor.removeStyles({ canvasCommentThread: '' } as never);
        refreshCommentHighlights();
      } catch {
        // Best-effort cleanup; the marker is hidden if no thread exists.
      }
    },
    [getEditor, refreshCommentHighlights],
  );

  const openCommentsForCurrentBlock = useCallback((): void => {
    const blockId = getCurrentBlockId();
    const anchor = getCurrentCommentAnchor();
    if (!blockId) {
      toast.error('Place the cursor in a canvas block first');
      return;
    }

    setActiveCommentBlockId(blockId);
    setActiveCommentThreadId(null);
    if (anchor?.blockId === blockId) {
      const rect = getSelectionRect(containerRef.current, blockId);
      setIsCommentsOpen(false);
      setActiveCommentAnchor(anchor);
      if (rect) {
        const editor = getEditor();
        if (editor) closeFormattingToolbar(editor);
        setInlineCommentThread({
          mode: 'create',
          blockId,
          rect,
          anchor,
        });
      }
      return;
    }

    setInlineCommentThread(null);
    setActiveCommentAnchor(null);
    toast.error('Select text to add a comment');
  }, [containerRef, getCurrentBlockId, getCurrentCommentAnchor, getEditor]);

  const focusCommentBlock = useCallback(
    (blockId: string, threadId?: string): void => {
      setActiveCommentBlockId(blockId);
      setActiveCommentThreadId(threadId ?? null);
      setActiveCommentAnchor(null);
      const editor = getEditor();
      if (!editor) return;

      // Prefer the commented text itself; fall back to the block when it is not rendered.
      if (threadId && focusCommentAnchorStart(editor, containerRef.current, threadId)) return;

      try {
        editor.setTextCursorPosition(blockId, 'start');
        (editor as unknown as { focus?: () => void }).focus?.();
      } catch {
        // The block may be unavailable for legacy/read-only loads; scroll still gives context.
      }
      scrollToHeading(blockId, containerRef.current);
    },
    [containerRef, getEditor],
  );

  const clearActiveCommentAnchor = useCallback((): void => {
    setActiveCommentAnchor(null);
    setActiveCommentThreadId(null);
  }, []);

  const closeInlineCommentThread = useCallback((): void => {
    setInlineCommentThread(null);
    setActiveCommentThreadId(null);
  }, []);

  return {
    isCommentsOpen,
    setIsCommentsOpen,
    inlineCommentThread,
    activeCommentBlockId,
    activeCommentThreadId,
    activeCommentAnchor,
    lostCommentThreadIds,
    refreshCommentHighlights,
    openCommentsForCurrentBlock,
    focusCommentBlock,
    clearActiveCommentAnchor,
    closeInlineCommentThread,
    applyCommentAnchorStyle,
    removeCommentAnchorStyle,
  };
}
