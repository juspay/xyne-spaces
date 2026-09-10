import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { DeleteDustbin02, DragableSixDots } from '@xyne/icons';
import type { CSSProperties, ReactElement } from 'react';
import { cn } from '../../../utils/classNames';

interface SortableFieldOptionProps {
  id: string;
  value: string;
  placeholder: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onRemove: () => void;
  trackMetadata: string;
}

/**
 * One row of a SELECT field's option list: grip on the left, inline-editable
 * value, trash on the right. The grip is the only drag handle so the text input
 * stays clickable — dnd-kit listeners on the whole row would swallow caret
 * placement and text selection.
 */
const SortableFieldOption = ({
  id,
  value,
  placeholder,
  disabled,
  onChange,
  onRemove,
  trackMetadata,
}: SortableFieldOptionProps): ReactElement => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex h-11 w-full items-center gap-2 rounded-[12px] border border-border bg-card px-2 py-3 transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[2px] focus-within:ring-ring/10',
        isDragging && 'relative z-10 opacity-70 shadow-md',
      )}
    >
      <button
        type='button'
        {...attributes}
        {...listeners}
        disabled={disabled}
        aria-label='Reorder option'
        className='flex size-4 shrink-0 cursor-grab items-center justify-center text-muted-foreground outline-none active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50 focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring'
      >
        <DragableSixDots className='size-4' />
      </button>
      <input
        type='text'
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className='min-w-0 flex-1 bg-transparent text-sm font-[450] leading-[1.2] text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50'
        data-track-category='Forms'
        data-track-name='EditFieldOption'
        data-track-metadata={trackMetadata}
      />
      <button
        type='button'
        onClick={onRemove}
        disabled={disabled}
        aria-label='Remove option'
        className='flex size-4 shrink-0 items-center justify-center text-destructive outline-none transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring'
        data-track-category='Forms'
        data-track-name='RemoveFieldOption'
        data-track-metadata={trackMetadata}
      >
        <DeleteDustbin02 className='size-4' />
      </button>
    </div>
  );
};

export default SortableFieldOption;
