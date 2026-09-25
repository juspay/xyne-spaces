import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { BarItemsStore } from '../../hooks/barItems';
import { cn } from '../../utils/classNames';

// The sorting strategy only decides how items shuffle; the dragged item itself
// would still follow the pointer anywhere. These pin it to the bar's own axis
// (what @dnd-kit/modifiers' restrictToVerticalAxis/HorizontalAxis do, inlined
// rather than adding the package for two one-liners).
const lockToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });
const lockToHorizontalAxis: Modifier = ({ transform }) => ({ ...transform, y: 0 });

interface SortableBarProps {
  store: BarItemsStore;
  /** The ids actually rendered, in order — a subset of the store's list. */
  ids: readonly string[];
  direction: 'vertical' | 'horizontal';
  children: ReactNode;
}

/**
 * Drag-to-reorder for a bar in place. Wraps the rendered items; each one is a
 * `SortableBarItem`. A drop is written straight to the store, so Preferences
 * and every other surface reading it follow immediately.
 */
export const SortableBar = ({
  store,
  ids,
  direction,
  children,
}: SortableBarProps): ReactElement => {
  // A small distance threshold keeps ordinary clicks (open the item, hit its
  // "×") from registering as drags — the whole item is the handle here.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const items = useMemo(() => [...ids], [ids]);

  // The click that follows a drop. dnd-kit stops its propagation at document
  // capture so React handlers never see it — fine for a <button>, but a <Link>
  // then loses its chance to preventDefault and the browser follows the href
  // (the toolbar tiles are anchors). stopPropagation leaves other listeners on
  // the same node alone, so one registered here still runs and can cancel the
  // default. Kept for the same ~50ms window dnd-kit keeps its own.
  const releaseClickGuard = useRef<(() => void) | null>(null);
  const swallowClick = useCallback((event: MouseEvent): void => {
    event.preventDefault();
  }, []);
  const armClickGuard = useCallback((): void => {
    releaseClickGuard.current?.();
    document.addEventListener('click', swallowClick, { capture: true });
    releaseClickGuard.current = (): void => {
      document.removeEventListener('click', swallowClick, { capture: true });
      releaseClickGuard.current = null;
    };
  }, [swallowClick]);
  const disarmClickGuard = useCallback((): void => {
    const release = releaseClickGuard.current;
    if (!release) return;
    window.setTimeout(release, 60);
  }, []);
  useEffect(() => (): void => releaseClickGuard.current?.(), []);

  const handleDragEnd = ({ active, over }: DragEndEvent): void => {
    disarmClickGuard();
    if (!over || active.id === over.id) return;
    // Indices in the store's full list rather than the rendered subset, so
    // entries hidden here (no permission, missing snapshot) keep their place.
    const all = store.get();
    const from = all.indexOf(String(active.id));
    const to = all.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    store.move(from, to);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[direction === 'vertical' ? lockToVerticalAxis : lockToHorizontalAxis]}
      onDragStart={armClickGuard}
      onDragCancel={disarmClickGuard}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={items}
        strategy={
          direction === 'vertical' ? verticalListSortingStrategy : horizontalListSortingStrategy
        }
      >
        {children}
      </SortableContext>
    </DndContext>
  );
};

interface SortableBarItemProps {
  id: string;
  /** Element to render; matches what the bar used before it became sortable. */
  as: 'li' | 'div' | 'span';
  className?: string;
  children: ReactNode;
}

/** One draggable entry of a `SortableBar`. The element itself is the handle. */
export const SortableBarItem = ({
  id,
  as,
  className,
  children,
}: SortableBarItemProps): ReactElement => {
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({ id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  // Only the pointer listeners are spread. dnd-kit's `attributes` would also
  // put role="button"/tabIndex on a wrapper whose child is already the real
  // control, and Preferences covers keyboard reordering.
  return createElement(
    as,
    {
      ref: setNodeRef,
      style,
      className: cn(className, isDragging && 'relative z-10 opacity-70'),
      ...listeners,
    },
    children,
  );
};
