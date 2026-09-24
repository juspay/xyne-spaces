import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { DragableSixDots, MultipleCrossCancelDefault } from '@xyne/icons';
import { cn } from '../../../utils/classNames';

interface SortableBarRowProps {
  id: string;
  icon: ReactNode;
  label: string;
  /** Second line, e.g. "App" for an artifact app. */
  hint?: string | undefined;
  /** Locked rows can be reordered but not removed. */
  locked: boolean;
  onRemove: () => void;
  trackCategory: string;
}

/**
 * One row of a bar's "shown" list: grip on the left, icon + label, remove on
 * the right. The grip is the only drag handle — dnd-kit listeners on the whole
 * row would swallow the remove button's click.
 */
export const SortableBarRow = ({
  id,
  icon,
  label,
  hint,
  locked,
  onRemove,
  trackCategory,
}: SortableBarRowProps): ReactElement => {
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
        'flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-2 pr-3',
        isDragging && 'relative z-10 opacity-70 shadow-md',
      )}
    >
      <button
        type='button'
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${label}`}
        className='flex size-6 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-ring'
        data-track-category={trackCategory}
        data-track-name='ReorderBarItem'
      >
        <DragableSixDots className='size-4' />
      </button>
      <div className='flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground'>
        {icon}
      </div>
      <div className='min-w-0 flex-1'>
        <p className='truncate text-sm font-medium text-foreground'>{label}</p>
        {hint && <p className='truncate text-xs text-muted-foreground'>{hint}</p>}
      </div>
      {locked ? (
        <span className='shrink-0 text-xs text-muted-foreground'>Always shown</span>
      ) : (
        <button
          type='button'
          onClick={onRemove}
          aria-label={`Remove ${label}`}
          className='flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
          data-track-category={trackCategory}
          data-track-name='RemoveBarItem'
          data-track-metadata={JSON.stringify({ id })}
        >
          <MultipleCrossCancelDefault size={14} />
        </button>
      )}
    </div>
  );
};
