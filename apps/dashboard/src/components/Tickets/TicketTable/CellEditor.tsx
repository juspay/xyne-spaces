import { useMemo, useState } from 'react';
import { EntitySelector } from '../../ui/EntitySelector/EntitySelector';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import {
  PriorityOptions,
  StatusOptions,
  getAssigneeOptions,
  useStageOptions,
} from './TicketTableHelper';
import { DatePicker } from '../../ui/DatePicker/DatePicker';
import {
  AssigneeCellEditorProps,
  DueDateCellEditorProps,
  GenericCellEditorProps,
  PriorityCellEditorProps,
  StageCellEditorProps,
  StatusCellEditorProps,
  TagsCellEditorProps,
} from './TicketTableTypes';
import { TagSelector } from './TagSelector';

export const GenericCellEditor = ({
  value,
  onValueChange,
  stopEditing,
  options,
  placeholder = 'Select...',
  searchPlaceholder = 'Search...',
}: GenericCellEditorProps) => {
  const handleSelect = (val: string | null) => {
    const newValue = val === '' ? null : val;
    onValueChange(newValue);
    // Only auto-close the editor if a value was selected (not cleared)
    if (newValue !== null) {
      setTimeout(() => stopEditing?.(), 50);
    }
  };

  return (
    <div className='h-full flex items-center px-2'>
      <EntitySelector
        options={options}
        selectedValue={value}
        onSelect={handleSelect}
        placeholder={placeholder}
        searchPlaceholder={searchPlaceholder}
        variant='inline'
        isOpen={true}
        onOpenChange={open => !open && stopEditing?.()}
        noBorder={true}
      />
    </div>
  );
};

GenericCellEditor.popup = true;

export const AssigneeCellEditor = ({
  value,
  onValueChange,
  stopEditing,
  users,
  userGroups,
}: AssigneeCellEditorProps) => {
  const options = getAssigneeOptions(users, userGroups || []);

  return (
    <GenericCellEditor
      value={value}
      onValueChange={onValueChange}
      stopEditing={stopEditing}
      options={options}
      placeholder='Assignee'
      searchPlaceholder='Search assignees...'
    />
  );
};

export const StatusCellEditor = ({ value, onValueChange, stopEditing }: StatusCellEditorProps) => (
  <GenericCellEditor
    value={value}
    onValueChange={onValueChange as (value: string | null) => void}
    stopEditing={stopEditing}
    options={StatusOptions}
  />
);

export const PriorityCellEditor = ({
  value,
  onValueChange,
  stopEditing,
}: PriorityCellEditorProps) => (
  <GenericCellEditor
    value={value}
    onValueChange={onValueChange as (value: string | null) => void}
    stopEditing={stopEditing}
    options={PriorityOptions}
  />
);

export const StageCellEditor = ({
  value,
  onValueChange,
  stopEditing,
  stages,
  data,
}: StageCellEditorProps) => {
  const boardId = data?.boardId ?? '';
  const [boardStages] = useCachedQuery(queries.stagesByBoard({ boardId }), {
    enabled: !!boardId && !stages,
  });
  const resolvedStages = useMemo(
    () => stages ?? (boardStages ?? []).map(stage => ({ id: stage.id, name: stage.name })),
    [stages, boardStages],
  );
  const options = useStageOptions(resolvedStages);
  return (
    <GenericCellEditor
      value={value}
      onValueChange={onValueChange as (value: string | null) => void}
      stopEditing={stopEditing}
      options={options}
    />
  );
};

export const TagsCellEditor: React.FC<TagsCellEditorProps> = ({
  value,
  onValueChange,
  availableTags,
  stopEditing,
}) => {
  const selectedTags = Array.isArray(value) ? value : [];

  const handleTagsChange = (newTags: string[]) => {
    onValueChange(newTags);
  };

  return (
    <div className='h-full flex items-center px-2 bg-background'>
      <TagSelector
        availableTags={availableTags}
        selectedTags={selectedTags}
        onTagsChange={handleTagsChange}
        stopEditing={stopEditing}
        inlineTags={true}
      />
    </div>
  );
};

export const DueDateCellEditor = ({ value, onValueChange }: DueDateCellEditorProps) => {
  const [date, setDate] = useState(value ? new Date(value) : null);

  const handleDateSelect = (newDate: Date | null) => {
    setDate(newDate);
    onValueChange(newDate ? newDate.getTime() : null);
  };
  const yesterday = new Date(new Date().setDate(new Date().getDate() - 1));

  return (
    <div className='h-full px-2 flex items-center bg-background border border-blue-500'>
      <DatePicker
        minDate={yesterday}
        selectedDate={date}
        onSelect={handleDateSelect}
        isInitialOpen={true}
      />
    </div>
  );
};
