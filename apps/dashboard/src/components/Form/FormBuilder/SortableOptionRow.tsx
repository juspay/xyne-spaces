import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, X } from 'lucide-react';
import { Button } from '../../ui/Button/Button';
import { cn } from '../../../utils/classNames';

interface SortableOptionRowProps {
  id: string;
  value: string;
  placeholder: string;
  disabled: boolean;
  error?: string | undefined;
  /** Branch toggle chip, rendered between the input and the remove button. */
  chip?: ReactNode;
  /** Branch panel — moves with the row while dragging. */
  children?: ReactNode;
  onChange: (value: string) => void;
  onRemove: () => void;
  trackingCategory: string;
}

/**
 * One option of a select field. The grip is the only drag handle so the text input keeps
 * caret placement and text selection.
 */
export const SortableOptionRow = ({
  id,
  value,
  placeholder,
  disabled,
  error,
  chip,
  children,
  onChange,
  onRemove,
  trackingCategory,
}: SortableOptionRowProps): ReactElement => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });

  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} className={cn(isDragging && 'relative z-10 opacity-70')}>
      <div
        className={cn(
          'flex items-center gap-[8px] border rounded-[8px] px-[8px] h-[34px] bg-background',
          error ? 'border-destructive' : 'border-border',
        )}
      >
        <button
          type='button'
          {...attributes}
          {...listeners}
          disabled={disabled}
          aria-label='Reorder option'
          className='flex shrink-0 cursor-grab items-center text-muted-foreground outline-none active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50 focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring'
        >
          <GripVertical size={14} />
        </button>
        <input
          type='text'
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          className='min-w-0 flex-1 text-[13px] text-foreground bg-transparent border-0 focus:outline-none focus:ring-0 p-0 disabled:cursor-not-allowed disabled:opacity-50'
          data-track-category={trackingCategory}
          data-track-name='edit_option'
        />
        {chip}
        <Button
          onClick={onRemove}
          disabled={disabled}
          variant='ghost'
          size='iconSm'
          aria-label='Remove option'
          className='text-muted-foreground hover:text-red-500'
          data-track-category={trackingCategory}
          data-track-name='delete_form_field_option'
        >
          <X size={14} />
        </Button>
      </div>
      {error && <p className='mt-[2px] px-[6px] text-[11px] text-destructive'>{error}</p>}
      {children}
    </div>
  );
};
