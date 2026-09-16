import { useEffect, useRef, type ReactElement } from 'react';
import Input from '../ui/Input';
import { cn } from '../../utils/classNames';
import type { Canvas } from './Canvas.types';
import { CanvasLabelManager } from './CanvasLabelManager';
import { SectionEmojiPicker } from '../Chat/SectionEmojiPicker';
import { Plus } from 'lucide-react';

const UNTITLED_CANVAS_TITLE = 'Untitled Canvas';

interface CanvasEditorHeaderProps {
  canvas: Canvas;
  workspaceId?: string | undefined;
  title: string;
  canEdit: boolean;
  focusTitleOnMount?: boolean;
  onTitleChange: (title: string) => void;
  onTitleSave: () => void;
  onTitleAutoFocused?: () => void;
  titleIcon?: string | null;
  onTitleIconChange?: (icon: string) => void;
}

export const CanvasEditorHeader = ({
  canvas,
  workspaceId,
  title,
  canEdit,
  focusTitleOnMount = false,
  onTitleChange,
  onTitleSave,
  onTitleAutoFocused,
  titleIcon,
  onTitleIconChange,
}: CanvasEditorHeaderProps): ReactElement => {
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const displayTitle = title === UNTITLED_CANVAS_TITLE ? '' : title;

  useEffect(() => {
    if (!focusTitleOnMount || !canEdit) return;

    let settleTimeout: number | undefined;
    const frame = window.requestAnimationFrame(() => {
      const input = titleInputRef.current;
      input?.focus({ preventScroll: true });
      input?.select();

      settleTimeout = window.setTimeout(() => {
        const currentInput = titleInputRef.current;
        if (currentInput && document.activeElement !== currentInput) {
          currentInput.focus({ preventScroll: true });
        }
        onTitleAutoFocused?.();
      }, 100);
    });

    return (): void => {
      window.cancelAnimationFrame(frame);
      if (settleTimeout !== undefined) {
        window.clearTimeout(settleTimeout);
      }
    };
  }, [canEdit, canvas.id, focusTitleOnMount, onTitleAutoFocused]);

  return (
    // .canvas-surface blocks the context menu, which the title input needs.
    <div
      className='group/canvas-editor-title relative min-w-0 bg-transparent'
      onContextMenu={event => event.stopPropagation()}
    >
      <CanvasLabelManager
        canvas={canvas}
        workspaceId={workspaceId}
        canEdit={canEdit}
        revealTriggerOnParentHover
      />

      <div className='flex min-w-0 items-center gap-2'>
        {onTitleIconChange && (
          <SectionEmojiPicker
            value={titleIcon ?? null}
            disabled={!canEdit}
            onChange={onTitleIconChange}
            trackCategory='CANVAS'
            trackName='OPEN_CANVAS_TITLE_ICON_PICKER'
            ariaLabel={titleIcon ? 'Change canvas icon' : 'Add canvas icon'}
            triggerClassName='size-10'
            iconClassName='text-2xl md:text-[28px]'
            fallbackIcon={<Plus className='size-4' />}
            allowCustomEmojis={false}
          />
        )}
        <h1 className='m-0 min-w-0 flex-1' data-testid='canvas-page-title-heading'>
          <Input
            ref={titleInputRef}
            value={displayTitle}
            onChange={event => onTitleChange(event.target.value)}
            onBlur={onTitleSave}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
            readOnly={!canEdit}
            placeholder='Add page title'
            aria-label='Canvas title'
            data-testid='canvas-page-title-input'
            className={cn(
              'h-auto min-w-0 border-none bg-transparent px-0 py-0 text-3xl font-bold leading-tight text-foreground shadow-none placeholder:text-muted-foreground/80 focus:ring-0 focus-visible:border-none focus-visible:ring-0 md:text-[40px] md:leading-[48px]',
              !canEdit && 'cursor-default',
            )}
          />
        </h1>
      </div>
    </div>
  );
};
