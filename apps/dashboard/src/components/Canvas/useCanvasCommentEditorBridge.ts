import type {
  BlockNoteEditor,
  BlockSchema,
  InlineContentSchema,
  StyleSchema,
} from '@blocknote/core';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { toast } from 'sonner';

import { scrollToHeading } from '../../utils/canvasUtils';
import type { CanvasCommentAnchor } from './CanvasCommentsPanel/CanvasCommentsPanel';
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
}

const getTiptapEditor = (editor: CanvasEditorLike): TiptapEditorLike | null =>
  ((editor as unknown as { _tiptapEditor?: unknown })._tiptapEditor as
    | TiptapEditorLike
    | undefined) ?? null;

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

const INLINE_COMMENT_INTERACTIVE_SELECTOR = [
  '[data-canvas-inline-comment-thread="true"]',
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

  const refreshCommentHighlights = useCallback(() => {
    setCommentHighlightVersion(version => version + 1);
  }, []);

  // Clicking anchored text opens that thread's card in the rail. The floating
  // popover is now only used for composing a brand-new comment.
  const handleCommentAnchorClick = useCallback((thread: CanvasCommentHighlightThread): void => {
    setActiveCommentBlockId(thread.blockId);
    setActiveCommentThreadId(thread.id);
    setActiveCommentAnchor(null);
    setInlineCommentThread(null);
  }, []);

  useCanvasCommentHighlights({
    canvasId,
    containerRef,
    enabled: ready && Boolean(canvasId),
    refreshKey: commentHighlightVersion,
    activeThreadId: activeCommentThreadId,
    onAnchorClick: handleCommentAnchorClick,
    onOpenCountChange: onOpenCommentCountChange,
    onThreadsChange: setCommentThreads,
  });

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

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(INLINE_COMMENT_INTERACTIVE_SELECTOR)) return;
      setInlineCommentThread(null);
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setInlineCommentThread(null);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
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

    // The rail renders the thread; activating it is enough to open and light it.
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

  const applyCommentAnchorStyle = useCallback(
    (threadId: string, anchor: CanvasCommentAnchor): boolean => {
      const editor = getEditor();
      if (
        !editor ||
        typeof anchor.selectionFrom !== 'number' ||
        typeof anchor.selectionTo !== 'number'
      ) {
        return false;
      }
      try {
        const tiptapEditor = getTiptapEditor(editor);
        if (!tiptapEditor) return false;
        tiptapEditor.commands.setTextSelection({
          from: anchor.selectionFrom,
          to: anchor.selectionTo,
        });
        editor.addStyles({ canvasCommentThread: threadId } as never);
        refreshCommentHighlights();
        return true;
      } catch {
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
  }, [containerRef, getCurrentBlockId, getCurrentCommentAnchor]);

  const focusCommentBlock = useCallback(
    (blockId: string, threadId?: string): void => {
      setActiveCommentBlockId(blockId);
      // Keep the thread active so its card and highlight stay lit after the jump.
      setActiveCommentThreadId(threadId ?? null);
      setActiveCommentAnchor(null);
      const editor = getEditor();
      if (!editor) return;
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
    commentThreads,
    setActiveCommentThreadId,
    inlineCommentThread,
    activeCommentBlockId,
    activeCommentThreadId,
    activeCommentAnchor,
    refreshCommentHighlights,
    openCommentsForCurrentBlock,
    focusCommentBlock,
    clearActiveCommentAnchor,
    closeInlineCommentThread,
    applyCommentAnchorStyle,
    removeCommentAnchorStyle,
  };
}
