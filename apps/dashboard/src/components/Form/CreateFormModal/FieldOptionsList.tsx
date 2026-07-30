import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { PlusDefault } from '@xyne/icons';
import type { FieldEnumOption } from '@xyne/shared';
import type { ReactElement } from 'react';
import SortableFieldOption from './SortableFieldOption';

interface FieldOptionsListProps {
  fieldIndex: number;
  options: FieldEnumOption[];
  disabled: boolean;
  onChangeOption: (optionIndex: number, value: string) => void;
  onRemoveOption: (optionIndex: number) => void;
  onAddOption: () => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
}

/**
 * Editable option list for a SELECT field. Owns its own DndContext so each
 * field's options reorder independently of the other fields on the form.
 */
const FieldOptionsList = ({
  fieldIndex,
  options,
  disabled,
  onChangeOption,
  onRemoveOption,
  onAddOption,
  onReorder,
}: FieldOptionsListProps): ReactElement => {
  // 5px activation distance so a click on the grip that never moves still
  // reaches the button rather than starting a drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const from = options.findIndex(option => option.id === active.id);
    const to = options.findIndex(option => option.id === over.id);
    if (from === -1 || to === -1) return;

    onReorder(from, to);
  };

  return (
    <div className='flex w-full flex-col gap-3'>
      {options.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext
            items={options.map(option => option.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className='flex w-full flex-col gap-2'>
              {options.map((option, optionIndex) => (
                <SortableFieldOption
                  key={option.id}
                  id={option.id}
                  value={option.value}
                  placeholder={`Option ${optionIndex + 1}`}
                  disabled={disabled}
                  onChange={value => onChangeOption(optionIndex, value)}
                  onRemove={() => onRemoveOption(optionIndex)}
                  trackMetadata={JSON.stringify({ fieldIndex, optionIndex })}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
      <button
        type='button'
        onClick={onAddOption}
        disabled={disabled}
        className='flex w-fit items-center gap-2 rounded-[12px] border border-border bg-card px-3 py-2.5 text-sm font-[450] leading-[1.2] text-foreground outline-none transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-ring'
        data-track-category='Forms'
        data-track-name='AddFieldOption'
        data-track-metadata={JSON.stringify({ fieldIndex })}
      >
        <PlusDefault className='size-4' />
        Add Option
      </button>
    </div>
  );
};

export default FieldOptionsList;
