import type {
  BlockNoteEditor,
  BlockSchema,
  InlineContentSchema,
  StyleSchema,
} from '@blocknote/core';
import { NodeSelection } from '@tiptap/pm/state';
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

/** The selected node, on the selections that have one (ProseMirror's NodeSelection). */
interface SelectedNodeLike {
  textContent: string;
  attrs: Record<string, unknown>;
  type: { name: string };
}

interface TiptapEditorLike {
  state: {
    selection: { from: number; to: number; empty?: boolean; node?: SelectedNodeLike };
    doc: { textBetween: (from: number, to: number, blockSeparator?: string) => string };
  };
  commands: {
    setTextSelection: (range: { from: number; to: number }) => boolean;
  };
}

/**
 * What a comment on a block with no text is anchored to.
 *
 * An embed is a whole block that holds no characters, so there is no quoted
 * text to hang the thread on — and the thread is refused without one. The link
 * it shows is what the reader means by "this", so that is the quote.
 */
const anchorTextForNode = (node: SelectedNodeLike | undefined): string => {
  if (!node) return '';
  if (node.textContent.trim().length > 0) return node.textContent.trim();
  const url: unknown = node.attrs['url'];
  return typeof url === 'string' && url.length > 0 ? url : node.type.name;
};

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

const getSelectionRect = (
  container: HTMLElement | null,
  blockId: string,
  preferBlockRect = false,
): DOMRect | null => {
  const escapedBlockId =
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(blockId)
      : blockId.replace(/["\\]/g, '\\$&');
  const blockElement =
    container?.querySelector<HTMLElement>(`[data-id="${escapedBlockId}"]`) ?? null;

  // A whole-block selection has no text range to measure, and the browser's own
  // selection stays wherever the caret last was — which put the thread there
  // instead of on the block. Pressing the button moves it again, so the block's
  // own rect is the only stable answer.
  if (!preferBlockRect) {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      // The range has to be in the document, not merely inside the one block the
      // cursor is in: a selection spanning two paragraphs has the editor itself
      // as its common ancestor, and requiring the block would throw such a
      // selection back onto the whole block's rect — a long way from the text
      // that was highlighted.
      const container = blockElement?.closest('.bn-editor') ?? blockElement;
      const insideEditor = container?.contains(range.commonAncestorContainer) ?? false;
      if (insideEditor && (rect.width > 0 || rect.height > 0)) return rect;
    }
  }

  const blockRect = blockElement?.getBoundingClientRect() ?? null;
  if (!blockRect) return null;

  // The card opens beside the anchor, so a diagram's full height put it a
  // screen away from the Ask AI / Comment pill that was just pressed. The pill
  // sits on the block's top edge; collapsing the anchor to that edge is what
  // brings the two together.
  if (preferBlockRect) return new DOMRect(blockRect.left, blockRect.top, blockRect.width, 0);
  return blockRect;
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

  const handleCommentAnchorClick = useCallback(
    (thread: CanvasCommentHighlightThread, rect?: DOMRect): void => {
      setIsCommentsOpen(false);
      setActiveCommentBlockId(thread.blockId);
      setActiveCommentThreadId(thread.id);
      setActiveCommentAnchor(null);
      if (rect) {
        setInlineCommentThread({
          mode: 'thread',
          thread,
          rect,
        });
      }
    },
    [],
  );

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
      const anchorText =
        tiptapEditor.state.doc.textBetween(from, to, ' ').trim() ||
        anchorTextForNode(tiptapEditor.state.selection.node);
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
        // A block with no characters — an embed — has nothing to highlight.
        // The thread still belongs to it through its block id, so this reports
        // success rather than refusing the comment outright.
        const highlightable = tiptapEditor.state.doc
          .textBetween(anchor.selectionFrom, anchor.selectionTo, ' ')
          .trim();
        if (!highlightable) return true;
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
      const currentEditor = getEditor();
      const tiptapEditor = currentEditor ? getTiptapEditor(currentEditor) : null;
      const selection = tiptapEditor?.state.selection;
      // instanceof, not the constructor's name: minification renames the class,
      // so a name test is always false in a production build — which silently
      // put this back on the caret, the very thing it exists to avoid.
      const wholeBlockSelected = selection instanceof NodeSelection;
      const rect = getSelectionRect(containerRef.current, blockId, wholeBlockSelected);
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

  const clearActiveCommentAnchor = useCallback((): void => {
    setActiveCommentAnchor(null);
    setActiveCommentThreadId(null);
  }, []);

  /**
   * The draft card has done its job the moment the comment exists.
   *
   * It used to stay open showing the thread it had just created, so every
   * comment left a card sitting over the document until something else was
   * clicked. The comment is on the block, in the highlight and in the panel —
   * there is nothing left for the card to say.
   */
  const finishInlineCommentDraft = useCallback((): void => {
    clearActiveCommentAnchor();
    setInlineCommentThread(null);
  }, [clearActiveCommentAnchor]);

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
    refreshCommentHighlights,
    openCommentsForCurrentBlock,
    focusCommentBlock,
    clearActiveCommentAnchor,
    finishInlineCommentDraft,
    closeInlineCommentThread,
    applyCommentAnchorStyle,
    removeCommentAnchorStyle,
  };
}
