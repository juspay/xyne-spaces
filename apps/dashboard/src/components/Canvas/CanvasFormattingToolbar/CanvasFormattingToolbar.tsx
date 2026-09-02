import {
  BasicTextStyleButton,
  BlockTypeSelect,
  ColorStyleButton,
  CreateLinkButton,
  type FormattingToolbarProps,
  TextAlignButton,
  useComponentsContext,
} from '@blocknote/react';
import { MessageSquarePlus, Ticket } from 'lucide-react';
import type { FC, ReactElement } from 'react';
import { useCallback, useEffect, useRef } from 'react';
import { xyneAIActor, type SelectionInfo } from '../../../machines/xyneAIMachine';

type CanvasFormattingToolbarOptions = {
  canvasId?: string;
  canvasTitle?: string;
  canComment?: boolean;
  canCreateTicket?: boolean;
  onCreateTicket?: (selectedText: string) => void;
};

function CanvasToolbarAttachedActions({
  onAddComment,
  canvasId,
  canvasTitle,
  canComment = true,
  canCreateTicket = false,
  onCreateTicket,
}: {
  onAddComment: () => void;
} & CanvasFormattingToolbarOptions): ReactElement {
  const selectedTextRef = useRef('');

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

  const handleAskAI = useCallback((): void => {
    if (!canvasId) return;

    const selectedText = window.getSelection()?.toString().trim() || selectedTextRef.current;
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
  }, [canvasId, canvasTitle]);

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
