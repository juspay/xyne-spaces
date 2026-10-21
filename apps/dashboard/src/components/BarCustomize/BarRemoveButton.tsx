import type { MouseEvent, ReactElement } from 'react';
import { MultipleCrossCancelDefault } from '@xyne/icons';
import type { BarItemsStore } from '../../hooks/barItems';
import { cn } from '../../utils/classNames';

interface BarRemoveButtonProps {
  store: BarItemsStore;
  id: string;
  label: string;
  trackCategory: string;
  /** Positions the control inside its `group relative` parent. */
  className?: string;
}

/**
 * The hover "×" on a bar item. Rendered by a `group` parent so it appears only
 * while that item is pointed at; renders nothing for a locked id, which is how
 * "Messages", "New Message" and "Threads" never grow one.
 */
export const BarRemoveButton = ({
  store,
  id,
  label,
  trackCategory,
  className,
}: BarRemoveButtonProps): ReactElement | null => {
  if (store.locked.includes(id)) return null;

  return (
    <button
      type='button'
      aria-label={`Remove ${label}`}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        // The item beneath is a link or a tab trigger; this must not activate it.
        event.preventDefault();
        event.stopPropagation();
        store.remove(id);
      }}
      className={cn(
        'absolute z-[1] flex items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm transition-opacity',
        'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-foreground',
        className,
      )}
      data-track-category={trackCategory}
      data-track-name='RemoveBarItem'
      data-track-metadata={JSON.stringify({ id })}
    >
      <MultipleCrossCancelDefault size={10} />
    </button>
  );
};
