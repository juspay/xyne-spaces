import {
  BasicTextStyleButton,
  BlockTypeSelect,
  ColorStyleButton,
  CreateLinkButton,
  type FormattingToolbarProps,
  useComponentsContext,
} from '@blocknote/react';
import { MessageSquarePlus } from 'lucide-react';
import type { FC, ReactElement } from 'react';
import { useCallback, useEffect, useRef } from 'react';
import { xyneAIActor, type SelectionInfo } from '../../../machines/xyneAIMachine';

const SELECTION_PREVIEW_LIMIT = 50;
const MIN_SELECTION_LENGTH = 3;

type CanvasFormattingToolbarOptions = {
  canvasId?: string;
  canvasTitle?: string;
  canComment?: boolean;
};

/**
 * The two primary actions on a text selection. Kept in its own component so the
 * selection-tracking effect does not re-run when formatting state changes.
 */
function CanvasToolbarActions({
  onAddComment,
  canvasId,
  canvasTitle,
  canComment = true,
}: { onAddComment: () => void } & CanvasFormattingToolbarOptions): ReactElement {
  const selectedTextRef = useRef('');

  useEffect(() => {
    const capture = (): void => {
      const text = window.getSelection()?.toString().trim() ?? '';
      // Only remember a real selection — clicking the button collapses the
      // selection, and the last meaningful one is what we want to send.
      if (text.length >= MIN_SELECTION_LENGTH) selectedTextRef.current = text;
    };
    capture();
    document.addEventListener('selectionchange', capture);
    return (): void => document.removeEventListener('selectionchange', capture);
  }, []);

  const handleEditWithAI = useCallback((): void => {
    if (!canvasId) return;
    const live = window.getSelection()?.toString().trim() ?? '';
    const selectedText = live.length >= MIN_SELECTION_LENGTH ? live : selectedTextRef.current;
    if (selectedText.length < MIN_SELECTION_LENGTH) return;

    const preview =
      selectedText.length > SELECTION_PREVIEW_LIMIT
        ? `${selectedText.substring(0, SELECTION_PREVIEW_LIMIT)}...`
        : selectedText;

    const selectionInfo: SelectionInfo = {
      text: selectedText,
      preview,
      canvasId,
      ...(canvasTitle && { canvasTitle }),
    };

    xyneAIActor.send({
      type: 'OPEN',
      canvasInfo: { canvasId, ...(canvasTitle && { title: canvasTitle }) },
      selectionInfo,
    });

    selectedTextRef.current = '';
    window.getSelection()?.removeAllRanges();
  }, [canvasId, canvasTitle]);

  return (
    <>
      {canComment && (
        <button
          type='button'
          className='canvas-selection-menu__action'
          onMouseDown={event => event.preventDefault()}
          onClick={onAddComment}
          data-track-category='CANVAS'
          data-track-name='Selection_Add_Comment'
          data-track-metadata={JSON.stringify({ canvasId: canvasId ?? null })}
        >
          <MessageSquarePlus className='size-4' aria-hidden='true' />
          <span>Comment</span>
        </button>
      )}
      <button
        type='button'
        className='canvas-selection-menu__action canvas-selection-menu__action--ai'
        onMouseDown={event => event.preventDefault()}
        onClick={handleEditWithAI}
        disabled={!canvasId}
        data-track-category='CANVAS'
        data-track-name='Selection_Edit_With_AI'
        data-track-metadata={JSON.stringify({ canvasId: canvasId ?? null })}
      >
        <img
          alt=''
          aria-hidden='true'
          width='15'
          height='15'
          src='/svgs/icons/ai-bot-gradient-star.svg'
        />
        <span>Edit with AI</span>
      </button>
    </>
  );
}

/**
 * Canvas selection menu: a single horizontal pill. Formatting stays as compact
 * icons on the left so the editor keeps its controls, and the two labelled
 * actions sit on the right where the eye lands last.
 */
export const createCanvasFormattingToolbar = (
  onAddComment: () => void,
  options: CanvasFormattingToolbarOptions = {},
): FC<FormattingToolbarProps> => {
  const CanvasFormattingToolbar = ({
    blockTypeSelectItems,
  }: FormattingToolbarProps): ReactElement | null => {
    const Components = useComponentsContext();
    const canComment = options.canComment ?? true;
    // Read-only surfaces get the AI action only — there is nothing to format.
    const canFormat = canComment;

    if (!Components) return null;

    return (
      <Components.FormattingToolbar.Root className='bn-toolbar bn-formatting-toolbar canvas-selection-menu'>
        {canFormat && (
          <>
            <div className='canvas-selection-menu__type'>
              <BlockTypeSelect {...(blockTypeSelectItems ? { items: blockTypeSelectItems } : {})} />
            </div>
            <span className='canvas-selection-menu__divider' aria-hidden='true' />
            <div className='canvas-selection-menu__format'>
              <BasicTextStyleButton basicTextStyle='bold' />
              <BasicTextStyleButton basicTextStyle='italic' />
              <BasicTextStyleButton basicTextStyle='underline' />
              <BasicTextStyleButton basicTextStyle='strike' />
              <BasicTextStyleButton basicTextStyle='code' />
              <CreateLinkButton />
              <ColorStyleButton />
            </div>
            <span className='canvas-selection-menu__divider' aria-hidden='true' />
          </>
        )}
        <CanvasToolbarActions onAddComment={onAddComment} {...options} />
      </Components.FormattingToolbar.Root>
    );
  };

  return CanvasFormattingToolbar;
};
