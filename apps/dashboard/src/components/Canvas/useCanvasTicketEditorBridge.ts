import type {
  BlockNoteEditor,
  BlockSchema,
  InlineContentSchema,
  StyleSchema,
} from '@blocknote/core';
import { CellSelection } from '@tiptap/pm/tables';
import { useCallback, useEffect, useState, type RefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { useChannel } from '../../hooks/useChannels';
import { useRouteContext } from '../../hooks/useRouteContext';
import { standaloneNavigate } from '../../utils/electronApp';
import { CANVAS_TICKET_SELECTOR } from './CanvasTicketStyleSpec/CanvasTicketStyleSpec';

type CanvasEditorLike = BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>;

export interface CanvasTicketAnchor {
  blockId: string;
  anchorText: string;
  blockText: string;
  selectionFrom: number;
  selectionTo: number;
}

interface UseCanvasTicketEditorBridgeOptions {
  channelId?: string | undefined;
  containerRef: RefObject<HTMLElement | null>;
  getEditor: () => CanvasEditorLike | null;
  ready?: boolean;
}

interface UseCanvasTicketEditorBridgeResult {
  activeTicketAnchor: CanvasTicketAnchor | null;
  isTicketChannelArchived: boolean;
  openTicketForCurrentSelection: () => void;
  closeTicketModal: () => void;
  handleTicketCreated: (ticket: { id: string }) => void;
}

interface ResolvedSelectionPositionLike {
  parent: { textContent: string };
  sameParent: (other: ResolvedSelectionPositionLike) => boolean;
}

interface TiptapEditorLike {
  state: {
    selection: {
      from: number;
      to: number;
      empty?: boolean;
      $from: ResolvedSelectionPositionLike;
      $to: ResolvedSelectionPositionLike;
    };
    doc: {
      textBetween: (from: number, to: number, blockSeparator?: string) => string;
      descendants: (
        callback: (
          node: {
            isText?: boolean;
            text?: string | null;
            nodeSize: number;
            marks?: Array<{ type: { name: string }; attrs?: { stringValue?: string } }>;
          },
          position: number,
        ) => void,
      ) => void;
      nodesBetween: (
        from: number,
        to: number,
        callback: (node: { marks?: Array<{ type: { name: string } }> }) => void,
      ) => void;
    };
    schema: { marks: { canvasTicket?: unknown } };
    tr: {
      removeMark: (from: number, to: number, markType: unknown) => TiptapEditorLike['state']['tr'];
      setMeta: (key: string, value: unknown) => TiptapEditorLike['state']['tr'];
    };
  };
  view: { dispatch: (transaction: TiptapEditorLike['state']['tr']) => void };
  commands: {
    setTextSelection: (range: { from: number; to: number }) => boolean;
  };
}

interface TicketMarkedTextSnapshot {
  text: string;
  ranges: Array<{ from: number; to: number }>;
}

const getTiptapEditor = (editor: CanvasEditorLike): TiptapEditorLike | null =>
  ((editor as unknown as { _tiptapEditor?: unknown })._tiptapEditor as
    | TiptapEditorLike
    | undefined) ?? null;

const rangeHasTicketStyle = (editor: TiptapEditorLike, from: number, to: number): boolean => {
  let hasTicketStyle = false;
  editor.state.doc.nodesBetween(from, to, node => {
    if (node.marks?.some(mark => mark.type.name === 'canvasTicket')) {
      hasTicketStyle = true;
    }
  });
  return hasTicketStyle;
};

const rangeHasCodeStyle = (editor: TiptapEditorLike, from: number, to: number): boolean => {
  let hasCodeStyle = false;
  editor.state.doc.nodesBetween(from, to, node => {
    if (node.marks?.some(mark => mark.type.name === 'code')) {
      hasCodeStyle = true;
    }
  });
  return hasCodeStyle;
};

const getTicketMarkedTextSnapshots = (
  editor: TiptapEditorLike,
): Map<string, TicketMarkedTextSnapshot> => {
  const snapshots = new Map<string, TicketMarkedTextSnapshot>();

  editor.state.doc.descendants((node, position) => {
    if (!node.isText || !node.text) return;
    const ticketMark = node.marks?.find(mark => mark.type.name === 'canvasTicket');
    const ticketId = ticketMark?.attrs?.stringValue;
    if (!ticketId) return;

    const existing = snapshots.get(ticketId) ?? { text: '', ranges: [] };
    existing.text += node.text;
    const from = position;
    const to = position + node.nodeSize;
    const previousRange = existing.ranges.at(-1);
    if (previousRange?.to === from) {
      previousRange.to = to;
    } else {
      existing.ranges.push({ from, to });
    }
    snapshots.set(ticketId, existing);
  });

  return snapshots;
};

const removeChangedTicketStyles = (
  editor: TiptapEditorLike,
  previousSnapshots: Map<string, TicketMarkedTextSnapshot>,
  currentSnapshots: Map<string, TicketMarkedTextSnapshot>,
): boolean => {
  const ticketMarkType = editor.state.schema.marks.canvasTicket;
  if (!ticketMarkType) return false;

  const rangesToUnlink: Array<{ from: number; to: number }> = [];
  for (const [ticketId, currentSnapshot] of currentSnapshots) {
    const previousSnapshot = previousSnapshots.get(ticketId);
    if (previousSnapshot && previousSnapshot.text !== currentSnapshot.text) {
      rangesToUnlink.push(...currentSnapshot.ranges);
    }
  }
  if (rangesToUnlink.length === 0) return false;

  let transaction = editor.state.tr;
  for (const range of rangesToUnlink) {
    transaction = transaction.removeMark(range.from, range.to, ticketMarkType);
  }
  transaction.setMeta('addToHistory', false);
  editor.view.dispatch(transaction);
  return true;
};

const getClosestCanvasBlock = (node: Node | null): HTMLElement | null => {
  const element = node instanceof Element ? node : node?.parentElement;
  return element?.closest<HTMLElement>('.bn-block-content[data-content-type]') ?? null;
};

const domSelectionSpansMultipleBlocks = (container: HTMLElement | null): boolean => {
  const selection = window.getSelection();
  if (!container || !selection || selection.rangeCount === 0) return false;

  const anchorBlock = getClosestCanvasBlock(selection.anchorNode);
  const focusBlock = getClosestCanvasBlock(selection.focusNode);
  if (!anchorBlock || !focusBlock) return false;
  if (!container.contains(anchorBlock) || !container.contains(focusBlock)) return false;

  return anchorBlock !== focusBlock;
};

export function useCanvasTicketEditorBridge({
  channelId,
  containerRef,
  getEditor,
  ready = true,
}: UseCanvasTicketEditorBridgeOptions): UseCanvasTicketEditorBridgeResult {
  const navigate = useNavigate();
  const { baseRoute } = useRouteContext();
  const channel = useChannel(channelId ?? '');
  const [activeTicketAnchor, setActiveTicketAnchor] = useState<CanvasTicketAnchor | null>(null);

  useEffect(() => {
    setActiveTicketAnchor(null);
  }, [channelId]);

  useEffect(() => {
    if (!ready) return;
    const editor = getEditor();
    const tiptapEditor = editor ? getTiptapEditor(editor) : null;
    if (!editor || !tiptapEditor) return;

    let previousSnapshots = getTicketMarkedTextSnapshots(tiptapEditor);
    const unsubscribe = editor.onChange(() => {
      const currentSnapshots = getTicketMarkedTextSnapshots(tiptapEditor);
      const removedStyle = removeChangedTicketStyles(
        tiptapEditor,
        previousSnapshots,
        currentSnapshots,
      );
      previousSnapshots = removedStyle
        ? getTicketMarkedTextSnapshots(tiptapEditor)
        : currentSnapshots;
    });

    return unsubscribe;
  }, [getEditor, ready]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const getTicketAnchor = (target: EventTarget | null): HTMLElement | null => {
      if (!(target instanceof Element)) return null;
      const anchor = target.closest<HTMLElement>(CANVAS_TICKET_SELECTOR);
      if (!anchor || !container.contains(anchor)) return null;
      if (anchor.dataset['canvasTicketAccess'] !== 'available') return null;
      return anchor;
    };

    const openTicket = (anchor: HTMLElement): void => {
      const ticketId = anchor.dataset['canvasTicketId'];
      const ticketChannelId = anchor.dataset['canvasTicketChannelId'];
      const conversationId = anchor.dataset['canvasTicketConversationId'];
      if (!ticketId || !ticketChannelId) {
        toast.error('Ticket details are still loading. Please try again.');
        return;
      }

      const searchParams = new URLSearchParams({
        tab: 'tickets',
        ticketId,
        ...(conversationId ? { conversationId } : {}),
      });
      standaloneNavigate(
        navigate,
        `${baseRoute}/${encodeURIComponent(ticketChannelId)}?${searchParams.toString()}`,
      );
    };

    const handleClick = (event: MouseEvent): void => {
      const anchor = getTicketAnchor(event.target);
      if (!anchor) return;
      event.preventDefault();
      event.stopPropagation();
      openTicket(anchor);
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const anchor = getTicketAnchor(event.target);
      if (!anchor) return;
      event.preventDefault();
      event.stopPropagation();
      openTicket(anchor);
    };

    container.addEventListener('click', handleClick);
    container.addEventListener('keydown', handleKeyDown);
    return (): void => {
      container.removeEventListener('click', handleClick);
      container.removeEventListener('keydown', handleKeyDown);
    };
  }, [baseRoute, containerRef, navigate]);

  const openTicketForCurrentSelection = useCallback((): void => {
    if (!ready) return;
    if (channel?.isArchived) {
      toast.error('Tickets cannot be created in an archived channel');
      return;
    }

    const editor = getEditor();
    if (!editor) return;

    try {
      const currentBlock = editor.getTextCursorPosition().block;
      const blockId = currentBlock?.id;
      const tiptapEditor = getTiptapEditor(editor);
      if (!blockId || !tiptapEditor || tiptapEditor.state.selection.empty) {
        toast.error('Select text to create a ticket');
        return;
      }

      const { $from, $to } = tiptapEditor.state.selection;
      const selectedBlocks = editor.getSelection()?.blocks;
      if (tiptapEditor.state.selection instanceof CellSelection) {
        toast.error('Select text within a single table cell to create a ticket');
        return;
      }
      if (
        !$from.sameParent($to) ||
        (selectedBlocks?.length ?? 0) > 1 ||
        domSelectionSpansMultipleBlocks(containerRef.current)
      ) {
        toast.error('Select text within a single block to create a ticket');
        return;
      }

      const { from, to } = tiptapEditor.state.selection;
      if (rangeHasCodeStyle(tiptapEditor, from, to)) {
        toast.error('Tickets cannot be created from code-formatted text');
        return;
      }

      const anchorText = tiptapEditor.state.doc.textBetween(from, to, ' ').trim();
      if (!anchorText) {
        toast.error('Select text to create a ticket');
        return;
      }
      if (rangeHasTicketStyle(tiptapEditor, from, to)) {
        toast.error('Selected text is already linked to a ticket');
        return;
      }
      const blockText = tiptapEditor.state.selection.$from.parent.textContent.trim();

      setActiveTicketAnchor({
        blockId,
        anchorText,
        blockText: blockText || anchorText,
        selectionFrom: from,
        selectionTo: to,
      });
    } catch {
      toast.error('Unable to use the selected canvas text');
    }
  }, [channel?.isArchived, containerRef, getEditor, ready]);

  const closeTicketModal = useCallback((): void => {
    setActiveTicketAnchor(null);
  }, []);

  const handleTicketCreated = useCallback(
    (ticket: { id: string }): void => {
      const anchor = activeTicketAnchor;
      const editor = getEditor();
      const tiptapEditor = editor ? getTiptapEditor(editor) : null;
      let styleApplied = false;

      if (anchor && editor && tiptapEditor && !tiptapEditor.state.selection.empty) {
        try {
          const { from, to } = tiptapEditor.state.selection;
          const currentBlockId = editor.getTextCursorPosition().block?.id;
          const currentText = tiptapEditor.state.doc.textBetween(from, to, ' ').trim();

          if (
            currentBlockId === anchor.blockId &&
            currentText === anchor.anchorText &&
            !rangeHasTicketStyle(tiptapEditor, from, to)
          ) {
            editor.addStyles({ canvasTicket: ticket.id } as never);
            tiptapEditor.commands.setTextSelection({ from: to, to });
            styleApplied = true;
          }
        } catch {
          styleApplied = false;
        }
      }

      setActiveTicketAnchor(null);
      if (!styleApplied) {
        toast.warning('Ticket created, but the selected canvas text changed and was not linked');
      }
    },
    [activeTicketAnchor, getEditor],
  );

  return {
    activeTicketAnchor,
    isTicketChannelArchived: channel?.isArchived === true,
    openTicketForCurrentSelection,
    closeTicketModal,
    handleTicketCreated,
  };
}
