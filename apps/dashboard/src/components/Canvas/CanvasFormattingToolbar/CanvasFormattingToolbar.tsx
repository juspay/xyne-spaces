import {
  BasicTextStyleButton,
  BlockTypeSelect,
  ColorStyleButton,
  CreateLinkButton,
  type FormattingToolbarProps,
  TextAlignButton,
  useComponentsContext,
} from '@blocknote/react';
import { MessageSquarePlus } from 'lucide-react';
import type { FC, ReactElement } from 'react';
import { useCallback } from 'react';

type CanvasFormattingToolbarOptions = {
  canvasId?: string;
  canvasTitle?: string;
  canComment?: boolean;
  onAskAI?: () => void;
};

function CanvasToolbarAttachedActions({
  onAddComment,
  canvasId,
  canComment = true,
  onAskAI,
}: {
  onAddComment: () => void;
} & CanvasFormattingToolbarOptions): ReactElement {
  const handleAskAI = useCallback((): void => {
    onAskAI?.();
  }, [onAskAI]);

  return (
    <div className='canvas-formatting-menu__attached-actions'>
      <button
        type='button'
        className={`canvas-formatting-menu__attached-button canvas-formatting-menu__attached-button--left ${
          canComment ? '' : 'canvas-formatting-menu__attached-button--single'
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
          className='canvas-formatting-menu__attached-button canvas-formatting-menu__attached-button--right'
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

    if (!Components) return null;

    return (
      <Components.FormattingToolbar.Root
        className={`bn-toolbar bn-formatting-toolbar canvas-formatting-menu ${
          canComment ? '' : 'canvas-formatting-menu--ask-only'
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
