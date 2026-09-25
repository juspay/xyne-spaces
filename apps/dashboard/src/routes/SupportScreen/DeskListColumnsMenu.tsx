import type { CSSProperties, ReactElement } from 'react';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CheckTickSingle as Check, Circle, DragableSixDots } from '@xyne/icons';
import { cn } from '../../utils/classNames';
import { getIconForFieldType } from '../../components/Tickets/TicketFilters/fieldTypeIcons';
import type { TicketListColumnDefinition } from '../../components/Tickets/TicketListView/ticketListColumns';
import type { ResolvedDisplayFormField } from '../../utils/board/resolveDisplayFormFields';

interface DeskListColumnsMenuProps {
  columns: readonly TicketListColumnDefinition[];
  dynamicFieldByKey: ReadonlyMap<string, ResolvedDisplayFormField>;
  selectedKeys: ReadonlySet<string>;
  onToggle: (key: string, visible: boolean) => void;
  onMove: (fromKey: string, toKey: string) => void;
}

interface SortableColumnRowProps {
  column: TicketListColumnDefinition;
  field: ResolvedDisplayFormField | undefined;
  isSelected: boolean;
  onToggle: (key: string, visible: boolean) => void;
}

// The grip is the only drag handle, so clicking the row still toggles the column.
const SortableColumnRow = ({
  column,
  field,
  isSelected,
  onToggle,
}: SortableColumnRowProps): ReactElement => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: column.key,
  });
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition };
  const Icon = field ? getIconForFieldType(field.fieldType) : Circle;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center gap-1 pl-1 pr-4 text-sm hover:bg-muted',
        isDragging && 'relative z-10 bg-muted shadow-md',
      )}
    >
      <button
        type='button'
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${column.label}`}
        className='flex size-6 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-ring'
        data-track-category='Support'
        data-track-name='ReorderListColumn'
      >
        <DragableSixDots className='size-3.5' />
      </button>
      {column.key !== 'subject' ? (
        <button
          type='button'
          onClick={() => onToggle(column.key, !isSelected)}
          className='flex min-w-0 flex-1 items-center justify-between py-2'
          data-track-category='Support'
          data-track-name='ToggleListColumn'
          data-track-metadata={JSON.stringify({
            column: column.key,
            ...(field ? { fieldName: field.fieldName } : {}),
            visible: !isSelected,
          })}
        >
          <span className='flex min-w-0 items-center gap-3'>
            <Icon className='w-4 h-4 shrink-0' />
            <span className='truncate'>{column.label}</span>
          </span>
          {isSelected && <Check className='w-4 h-4 text-primary shrink-0' />}
        </button>
      ) : (
        <span className='flex min-w-0 flex-1 items-center gap-3 py-2'>
          <Icon className='w-4 h-4 shrink-0' />
          <span className='truncate'>{column.label}</span>
        </span>
      )}
    </div>
  );
};

export const DeskListColumnsMenu = ({
  columns,
  dynamicFieldByKey,
  selectedKeys,
  onToggle,
  onMove,
}: DeskListColumnsMenuProps): ReactElement => {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = ({ active, over }: DragEndEvent): void => {
    if (!over || active.id === over.id) return;
    onMove(String(active.id), String(over.id));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext
        items={columns.map(column => column.key)}
        strategy={verticalListSortingStrategy}
      >
        {columns.map(column => (
          <SortableColumnRow
            key={column.key}
            column={column}
            field={dynamicFieldByKey.get(column.key)}
            isSelected={selectedKeys.has(column.key)}
            onToggle={onToggle}
          />
        ))}
      </SortableContext>
    </DndContext>
  );
};
