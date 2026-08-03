import type {
  BlockNoteEditor,
  BlockSchema,
  InlineContentSchema,
  StyleSchema,
} from '@blocknote/core';
import { useCallback, useEffect, useState, type RefObject } from 'react';
import { toast } from 'sonner';

import { scrollToHeading } from '../../utils/canvasUtils';
import type { CanvasCommentAnchor } from './CanvasCommentsPanel/CanvasCommentsPanel';
import { useCanvasCommentHighlights } from './useCanvasCommentHighlights';

type CanvasEditorLike = BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>;

interface UseCanvasCommentEditorBridgeOptions {
  canvasId?: string | undefined;
  containerRef: RefObject<HTMLDivElement | null>;
  getEditor: () => CanvasEditorLike | null;
  initialBlockIdToFocus?: string | undefined;
  initialCommentThreadId?: string | undefined;
  ready?: boolean;
}

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

export function useCanvasCommentEditorBridge({
  canvasId,
  containerRef,
  getEditor,
  initialBlockIdToFocus,
  initialCommentThreadId,
  ready = true,
}: UseCanvasCommentEditorBridgeOptions) {
  const [isCommentsOpen, setIsCommentsOpen] = useState(false);
  const [activeCommentBlockId, setActiveCommentBlockId] = useState<string | null>(null);
  const [activeCommentThreadId, setActiveCommentThreadId] = useState<string | null>(null);
  const [activeCommentAnchor, setActiveCommentAnchor] = useState<CanvasCommentAnchor | null>(null);
  const [commentHighlightVersion, setCommentHighlightVersion] = useState(0);

  const refreshCommentHighlights = useCallback(() => {
    setCommentHighlightVersion(version => version + 1);
  }, []);

  const handleCommentAnchorClick = useCallback((thread: { id: string; blockId: string }): void => {
    setIsCommentsOpen(true);
    setActiveCommentBlockId(thread.blockId);
    setActiveCommentThreadId(thread.id);
    setActiveCommentAnchor(null);
  }, []);

  useCanvasCommentHighlights({
    canvasId,
    containerRef,
    enabled: ready && Boolean(canvasId),
    refreshKey: commentHighlightVersion,
    onAnchorClick: handleCommentAnchorClick,
  });

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
    setIsCommentsOpen(true);
    setActiveCommentBlockId(initialBlockIdToFocus);
    setActiveCommentThreadId(initialCommentThreadId);
    setActiveCommentAnchor(null);
  }, [initialBlockIdToFocus, initialCommentThreadId, ready]);

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
    setIsCommentsOpen(true);
    if (!blockId) {
      toast.error('Place the cursor in a canvas block first');
      return;
    }
    setActiveCommentBlockId(blockId);
    setActiveCommentThreadId(null);
    setActiveCommentAnchor(anchor?.blockId === blockId ? anchor : null);
  }, [getCurrentBlockId, getCurrentCommentAnchor]);

  const focusCommentBlock = useCallback(
    (blockId: string): void => {
      setActiveCommentBlockId(blockId);
      setActiveCommentThreadId(null);
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

  return {
    isCommentsOpen,
    setIsCommentsOpen,
    activeCommentBlockId,
    activeCommentThreadId,
    activeCommentAnchor,
    refreshCommentHighlights,
    openCommentsForCurrentBlock,
    focusCommentBlock,
    applyCommentAnchorStyle,
    removeCommentAnchorStyle,
  };
}
