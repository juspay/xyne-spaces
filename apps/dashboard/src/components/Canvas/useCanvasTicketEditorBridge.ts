import type {
  BlockNoteEditor,
  BlockSchema,
  InlineContentSchema,
  StyleSchema,
} from '@blocknote/core';
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

interface TiptapEditorLike {
  state: {
    selection: {
      from: number;
      to: number;
      empty?: boolean;
      $from: { parent: { textContent: string } };
    };
    doc: {
      textBetween: (from: number, to: number, blockSeparator?: string) => string;
      nodesBetween: (
        from: number,
        to: number,
        callback: (node: { marks?: Array<{ type: { name: string } }> }) => void,
      ) => void;
    };
  };
  commands: {
    setTextSelection: (range: { from: number; to: number }) => boolean;
  };
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
      const blockId = editor.getTextCursorPosition().block?.id;
      const tiptapEditor = getTiptapEditor(editor);
      if (!blockId || !tiptapEditor || tiptapEditor.state.selection.empty) {
        toast.error('Select text to create a ticket');
        return;
      }

      const { from, to } = tiptapEditor.state.selection;
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
  }, [channel?.isArchived, getEditor, ready]);

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
