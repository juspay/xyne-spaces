import {
  BasicTextStyleButton,
  BlockTypeSelect,
  ColorStyleButton,
  CreateLinkButton,
  type FormattingToolbarProps,
  TextAlignButton,
  useBlockNoteEditor,
  useComponentsContext,
} from '@blocknote/react';
import { TextSelection, type Selection } from '@tiptap/pm/state';
import { MessageSquarePlus, Ticket } from 'lucide-react';
import type { FC, ReactElement } from 'react';
import { useCallback, useEffect, useRef } from 'react';
import { xyneAIActor, type SelectionInfo } from '../../../machines/xyneAIMachine';

/**
 * Whether cells of a table are selected.
 *
 * Structural rather than `instanceof CellSelection`: prosemirror-tables is
 * loaded once by BlockNote and again through @tiptap/pm, and a class compared
 * across two copies of a module never matches.
 */
const isCellSelection = (selection: Selection): boolean => '$anchorCell' in selection;

type CanvasFormattingToolbarOptions = {
  canvasId?: string;
  canvasTitle?: string;
  canComment?: boolean;
  /**
   * Text to hand Ask AI when there is no DOM selection to read. A selected
   * diagram or equation is an object, not highlighted text, so its own source
   * is what Ask AI is being asked about.
   */
  selectionText?: string;
  canCreateTicket?: boolean;
  onCreateTicket?: (selectedText: string) => void;
};

export function CanvasToolbarAttachedActions({
  onAddComment,
  canvasId,
  canvasTitle,
  canComment = true,
  selectionText,
  canCreateTicket = false,
  onCreateTicket,
}: {
  onAddComment: () => void;
} & CanvasFormattingToolbarOptions): ReactElement {
  const selectedTextRef = useRef('');
  const editor = useBlockNoteEditor();

  useEffect(() => {
    const updateSelectedText = (): void => {
      const selectedText = window.getSelection()?.toString().trim() ?? '';
      if (selectedText) {
        selectedTextRef.current = selectedText;
      }
    };

    updateSelectedText();
    document.addEventListener('selectionchange', updateSelectedText);
    return (): void => document.removeEventListener('selectionchange', updateSelectedText);
  }, []);

  /**
   * What the reader has picked out, as the AI should read it.
   *
   * The document's own selection is the source of truth rather than the
   * browser's: selecting cells in a table leaves the DOM selection inside a
   * single cell, so a table went to Ask AI as one cell of it, and selecting a
   * whole block leaves no DOM range at all. Anything wider than one paragraph
   * goes as markdown, which is the only form that keeps a table's rows and
   * columns and a code block's fence intact.
   */
  const readSelection = useCallback((): string => {
    const state = editor?._tiptapEditor?.view?.state;
    if (!state || state.selection.empty) return '';

    const { selection } = state;
    const withinOneTextblock =
      selection instanceof TextSelection &&
      selection.$from.parent === selection.$to.parent &&
      selection.$from.parent.isTextblock;

    if (!withinOneTextblock) {
      try {
        // Cells are selected by rectangle, not by range, and the slice cut from
        // that range collapses to a single cell — which is why a table used to
        // arrive as one of its cells. Picking cells out of a table means the
        // table, so the whole block is what goes.
        const blocks = isCellSelection(selection)
          ? [editor.getTextCursorPosition().block]
          : editor.getSelectionCutBlocks().blocks;
        const markdown = editor
          .blocksToMarkdownLossy(blocks as Parameters<typeof editor.blocksToMarkdownLossy>[0])
          .trim();
        if (markdown) return markdown;
      } catch {
        // Custom blocks without a markdown form fall through to their text.
      }
    }

    return state.doc.textBetween(selection.from, selection.to, '\n', ' ').trim();
  }, [editor]);

  const handleAskAI = useCallback((): void => {
    if (!canvasId) return;

    const selectedText =
      selectionText ||
      readSelection() ||
      window.getSelection()?.toString().trim() ||
      selectedTextRef.current;
    if (!selectedText) return;

    const preview = selectedText.length > 50 ? `${selectedText.substring(0, 50)}...` : selectedText;
    const selectionInfo: SelectionInfo = {
      text: selectedText,
      preview,
      canvasId,
      ...(canvasTitle && { canvasTitle }),
    };

    xyneAIActor.send({
      type: 'OPEN',
      canvasInfo: {
        canvasId,
        ...(canvasTitle && { title: canvasTitle }),
      },
      selectionInfo,
    });

    window.getSelection()?.removeAllRanges();
  }, [selectionText, readSelection, canvasId, canvasTitle]);

  const handleCreateTicket = useCallback((): void => {
    const selectedText = window.getSelection()?.toString().trim() || selectedTextRef.current;
    if (!selectedText) return;
    onCreateTicket?.(selectedText);
  }, [onCreateTicket]);

  const hasSecondaryAction = canComment || canCreateTicket;

  return (
    <div className='canvas-formatting-menu__attached-actions'>
      <button
        type='button'
        className={`canvas-formatting-menu__attached-button canvas-formatting-menu__attached-button--left ${
          hasSecondaryAction ? '' : 'canvas-formatting-menu__attached-button--single'
        }`}
        onMouseDown={event => event.preventDefault()}
        onClick={handleAskAI}
        disabled={!canvasId}
        data-track-category='CANVAS'
        data-track-name='Selection_Ask_AI'
        data-track-metadata={JSON.stringify({ canvasId })}
      >
        <img alt='AI' width='14' height='14' src='/svgs/icons/ai-bot-gradient-star.svg' />
        <span>Ask AI</span>
      </button>
      {canComment && (
        <button
          type='button'
          className={`canvas-formatting-menu__attached-button ${
            canCreateTicket
              ? 'canvas-formatting-menu__attached-button--middle'
              : 'canvas-formatting-menu__attached-button--right'
          }`}
          onMouseDown={event => event.preventDefault()}
          onClick={onAddComment}
          data-track-category='CANVAS'
          data-track-name='Selection_Add_Comment'
          data-track-metadata={JSON.stringify({ canvasId })}
        >
          <MessageSquarePlus className='size-3.5' aria-hidden='true' />
          <span>Comment</span>
        </button>
      )}
      {canCreateTicket && (
        <button
          type='button'
          className='canvas-formatting-menu__attached-button canvas-formatting-menu__attached-button--right'
          onMouseDown={event => event.preventDefault()}
          onClick={handleCreateTicket}
          data-track-category='CANVAS'
          data-track-name='Selection_Create_Ticket'
          data-track-metadata={JSON.stringify({ canvasId })}
        >
          <Ticket className='size-3.5' aria-hidden='true' />
          <span>Ticket</span>
        </button>
      )}
    </div>
  );
}

export const createCanvasFormattingToolbar = (
  onAddComment: () => void,
  options: CanvasFormattingToolbarOptions = {},
): FC<FormattingToolbarProps> => {
  const CanvasFormattingToolbar = ({
    blockTypeSelectItems,
  }: FormattingToolbarProps): ReactElement | null => {
    const Components = useComponentsContext();
    const canComment = options.canComment ?? true;
    const canCreateTicket = options.canCreateTicket ?? false;
    const hasEditorActions = canComment || canCreateTicket;

    if (!Components) return null;

    return (
      <Components.FormattingToolbar.Root
        className={`bn-toolbar bn-formatting-toolbar canvas-formatting-menu ${
          hasEditorActions ? '' : 'canvas-formatting-menu--ask-only'
        }`}
      >
        {canComment && (
          <>
            <div className='canvas-formatting-menu__type-row'>
              <BlockTypeSelect {...(blockTypeSelectItems ? { items: blockTypeSelectItems } : {})} />
            </div>
            <div className='canvas-formatting-menu__format-grid'>
              <ColorStyleButton />
              <BasicTextStyleButton basicTextStyle='bold' />
              <BasicTextStyleButton basicTextStyle='italic' />
              <BasicTextStyleButton basicTextStyle='underline' />
              <BasicTextStyleButton basicTextStyle='strike' />
              <CreateLinkButton />
              <BasicTextStyleButton basicTextStyle='code' />
              <TextAlignButton textAlignment='left' />
              <TextAlignButton textAlignment='center' />
              <TextAlignButton textAlignment='right' />
            </div>
          </>
        )}
        <CanvasToolbarAttachedActions onAddComment={onAddComment} {...options} />
      </Components.FormattingToolbar.Root>
    );
  };

  return CanvasFormattingToolbar;
};
