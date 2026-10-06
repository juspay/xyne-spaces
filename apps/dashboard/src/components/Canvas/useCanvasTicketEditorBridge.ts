import type {
  BlockNoteEditor,
  BlockSchema,
  InlineContentSchema,
  StyleSchema,
} from '@blocknote/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import { useCallback, useEffect, useState, type RefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { useChannel } from '../../hooks/useChannels';
import { useRouteContext } from '../../hooks/useRouteContext';
import { getCanvasMentionDisplayText } from '../../utils/canvasMentionUtils';
import { standaloneNavigate } from '../../utils/electronApp';
import { CANVAS_TICKET_SELECTOR } from './CanvasTicketStyleSpec/CanvasTicketStyleSpec';

type CanvasEditorLike = BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>;

export interface CanvasTicketAnchor {
  blockId: string;
  anchorText: string;
  blockText: string;
  blockContentSignature: string;
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
  activeTicketAction: 'create' | 'link' | null;
  isTicketChannelArchived: boolean;
  openTicketForCurrentSelection: () => void;
  openTicketLinkForCurrentSelection: () => void;
  closeTicketModal: () => void;
  handleTicketCreated: (ticket: { id: string }) => void;
}

interface TiptapEditorLike {
  state: EditorState;
  view: { dispatch: (transaction: Transaction) => void };
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

const rangeHasLink = (editor: TiptapEditorLike, from: number, to: number): boolean => {
  let hasLink = false;
  editor.state.doc.nodesBetween(from, to, node => {
    if (node.marks?.some(mark => mark.type.name === 'link')) {
      hasLink = true;
    }
  });
  return hasLink;
};

const isMentionNode = (node: ProseMirrorNode): boolean => node.type.name === 'mention';

const blockHasUnsupportedInlineContent = (block: ProseMirrorNode): boolean => {
  let hasUnsupportedInlineContent = false;
  block.descendants(node => {
    if (node.isInline && !node.isText && !isMentionNode(node)) {
      hasUnsupportedInlineContent = true;
      return false;
    }
    return true;
  });
  return hasUnsupportedInlineContent;
};

const getPlainTextBlockContent = (block: ProseMirrorNode): string => {
  let content = '';
  block.forEach(node => {
    if (node.isText) {
      content += node.text ?? '';
      return;
    }
    if (isMentionNode(node)) {
      const displayName = getCanvasMentionDisplayText(node.attrs);
      content += displayName ? `@${displayName}` : '@mention';
    }
  });
  return content;
};

const getBlockContentSignature = (block: ProseMirrorNode): string =>
  JSON.stringify(block.content.toJSON());

const replaceBlockWithTicketText = (
  editor: TiptapEditorLike,
  block: ProseMirrorNode,
  from: number,
  to: number,
  ticketId: string,
): boolean => {
  const plainText = getPlainTextBlockContent(block);
  const ticketMarkType = editor.state.schema.marks['canvasTicket'];
  if (!plainText || !ticketMarkType) return false;

  const transaction = editor.state.tr.replaceWith(from, to, editor.state.schema.text(plainText));
  const end = from + plainText.length;
  transaction.addMark(from, end, ticketMarkType.create({ stringValue: ticketId }));
  transaction.setSelection(TextSelection.create(transaction.doc, end));
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
  const [activeTicketAction, setActiveTicketAction] = useState<'create' | 'link' | null>(null);

  useEffect(() => {
    setActiveTicketAnchor(null);
    setActiveTicketAction(null);
  }, [channelId]);

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

  const openTicketActionForCurrentSelection = useCallback(
    (action: 'create' | 'link'): void => {
      if (!ready) return;
      if (channel?.isArchived) {
        toast.error('Tickets cannot be linked in an archived channel');
        return;
      }

      const editor = getEditor();
      if (!editor) return;

      try {
        const currentBlock = editor.getTextCursorPosition().block;
        const blockId = currentBlock?.id;
        const tiptapEditor = getTiptapEditor(editor);
        if (!blockId || !tiptapEditor || tiptapEditor.state.selection.empty) {
          toast.error('Select text to use with a ticket');
          return;
        }

        const { $from, $to } = tiptapEditor.state.selection;
        const selectedBlocks = editor.getSelection()?.blocks;
        if (tiptapEditor.state.selection instanceof CellSelection) {
          toast.error('Select text within a single table cell to use with a ticket');
          return;
        }
        if (
          !$from.sameParent($to) ||
          (selectedBlocks?.length ?? 0) > 1 ||
          domSelectionSpansMultipleBlocks(containerRef.current)
        ) {
          toast.error('Select text within a single block to use with a ticket');
          return;
        }

        const { from, to } = tiptapEditor.state.selection;
        const blockFrom = $from.start();
        const blockTo = $from.end();
        if (rangeHasLink(tiptapEditor, blockFrom, blockTo)) {
          toast.error('Ticket styles cannot be applied to linked text');
          return;
        }
        if (blockHasUnsupportedInlineContent($from.parent)) {
          toast.error(
            'Tickets cannot be created or linked from blocks containing unsupported inline items',
          );
          return;
        }
        if (rangeHasCodeStyle(tiptapEditor, from, to)) {
          toast.error('Ticket styles cannot be applied to code-formatted text');
          return;
        }

        const anchorText = tiptapEditor.state.doc.textBetween(from, to, ' ').trim();
        if (!anchorText) {
          toast.error('Select text to use with a ticket');
          return;
        }
        if (rangeHasTicketStyle(tiptapEditor, from, to)) {
          toast.error('Selected text is already linked to a ticket');
          return;
        }
        if (rangeHasTicketStyle(tiptapEditor, blockFrom, blockTo)) {
          toast.error('This block is already linked to a ticket');
          return;
        }
        const blockText = getPlainTextBlockContent($from.parent).trim();

        setActiveTicketAnchor({
          blockId,
          anchorText,
          blockText: blockText || anchorText,
          blockContentSignature: getBlockContentSignature($from.parent),
          selectionFrom: from,
          selectionTo: to,
        });
        setActiveTicketAction(action);
      } catch {
        toast.error('Unable to use the selected canvas text');
      }
    },
    [channel?.isArchived, containerRef, getEditor, ready],
  );

  const openTicketForCurrentSelection = useCallback((): void => {
    openTicketActionForCurrentSelection('create');
  }, [openTicketActionForCurrentSelection]);

  const openTicketLinkForCurrentSelection = useCallback((): void => {
    openTicketActionForCurrentSelection('link');
  }, [openTicketActionForCurrentSelection]);

  const closeTicketModal = useCallback((): void => {
    setActiveTicketAnchor(null);
    setActiveTicketAction(null);
  }, []);

  const handleTicketCreated = useCallback(
    (ticket: { id: string }): void => {
      const anchor = activeTicketAnchor;
      const editor = getEditor();
      const tiptapEditor = editor ? getTiptapEditor(editor) : null;
      let styleApplied = false;

      if (anchor && editor && tiptapEditor && !tiptapEditor.state.selection.empty) {
        try {
          const { from, to, $from, $to } = tiptapEditor.state.selection;
          const currentBlockId = editor.getTextCursorPosition().block?.id;
          const currentText = tiptapEditor.state.doc.textBetween(from, to, ' ').trim();
          const blockFrom = $from.start();
          const blockTo = $from.end();

          if (
            currentBlockId === anchor.blockId &&
            $from.sameParent($to) &&
            currentText === anchor.anchorText &&
            getBlockContentSignature($from.parent) === anchor.blockContentSignature &&
            !rangeHasTicketStyle(tiptapEditor, blockFrom, blockTo)
          ) {
            styleApplied = replaceBlockWithTicketText(
              tiptapEditor,
              $from.parent,
              blockFrom,
              blockTo,
              ticket.id,
            );
          }
        } catch {
          styleApplied = false;
        }
      }

      setActiveTicketAnchor(null);
      setActiveTicketAction(null);
      if (!styleApplied) {
        toast.warning(
          activeTicketAction === 'create'
            ? 'Ticket created, but the selected canvas text changed and was not linked'
            : 'The selected canvas text changed and the ticket was not linked',
        );
      }
    },
    [activeTicketAction, activeTicketAnchor, getEditor],
  );

  return {
    activeTicketAnchor,
    activeTicketAction,
    isTicketChannelArchived: channel?.isArchived === true,
    openTicketForCurrentSelection,
    openTicketLinkForCurrentSelection,
    closeTicketModal,
    handleTicketCreated,
  };
}
