import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { User } from '@xyne/shared';
import { FormFieldType } from '@xyne/shared';
import { useUsers } from '../../../hooks/useUsers';
import { SearchUserV2 } from '../../ui/SearchUser/SearchUserV2';
import { getTimestampValue } from '../../../utils/board/dynamicFieldFilters';
import type { ResolvedDisplayFormField } from '../../../utils/board/resolveDisplayFormFields';
import { GenericCellEditor } from './CellEditor';
import { TagSelector } from './TagSelector';
import type { EntityOption } from './TicketTableTypes';
import { toStringArray } from './dynamicFieldValues';

export interface DynamicFieldCellEditorProps {
  value: string | string[] | undefined;
  onValueChange: (value: string | string[]) => void;
  stopEditing?: (() => void) | undefined;
  field: ResolvedDisplayFormField;
}

const optionDot = <span className='size-1.5 rounded-full bg-xyne-purple-400' />;

const BOOLEAN_OPTIONS: EntityOption[] = [
  { value: 'true', label: 'Yes', icon: optionDot },
  { value: 'false', label: 'No', icon: optionDot },
];

/** Stored booleans are 'true'/'false' strings; tolerate the legacy 'yes'/'no' spelling. */
const toBooleanOptionValue = (raw: string | undefined): string | null => {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === 'true' || normalized === 'yes') return 'true';
  if (normalized === 'false' || normalized === 'no') return 'false';
  return null;
};

const pad = (value: number): string => String(value).padStart(2, '0');

const toDateInputValue = (raw: string | undefined): string => {
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const timestamp = getTimestampValue(raw);
  if (timestamp === null) return '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const DateFieldEditor = ({
  value,
  onValueChange,
  stopEditing,
  field,
}: DynamicFieldCellEditorProps): React.ReactElement => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className='h-full flex items-center px-2 bg-background'>
      <input
        ref={inputRef}
        type='date'
        value={toDateInputValue(toStringArray(value)[0])}
        onChange={e => onValueChange(e.target.value)}
        onBlur={() => stopEditing?.()}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            stopEditing?.();
          }
        }}
        className='w-full text-sm text-foreground bg-background border border-input rounded px-2 py-1 outline-none focus:border-blue-500'
        data-track-category='Tickets'
        data-track-name='EditDynamicField'
        data-track-metadata={JSON.stringify({
          fieldName: field.fieldName,
          fieldType: field.fieldType,
        })}
      />
    </div>
  );
};

const UserFieldEditor = ({
  value,
  onValueChange,
  stopEditing,
}: DynamicFieldCellEditorProps): React.ReactElement => {
  const users = useUsers();
  const [searchQuery, setSearchQuery] = useState('');
  const [isOpen, setIsOpen] = useState(true);

  // Stored ids may carry the `user:` prefix used elsewhere for assignees.
  const selectedIds = useMemo(
    () => toStringArray(value).map(id => id.replace(/^user:/, '')),
    [value],
  );
  const selectedUsers = useMemo(() => {
    const byId = new Map((users ?? []).map(user => [user.id, user]));
    return selectedIds
      .map(id => byId.get(id))
      .filter((user): user is (typeof users)[number] => user !== undefined);
  }, [selectedIds, users]);

  return (
    <div className='h-full flex items-center px-2 bg-background'>
      <div className='flex-1 bg-background border border-input rounded focus-within:border-blue-500'>
        <SearchUserV2
          options={users ?? []}
          selectedUsers={selectedUsers as User[]}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSelect={selected => onValueChange(selected.map(user => user.id))}
          isOpen={isOpen}
          setIsOpen={open => {
            setIsOpen(open);
            if (!open) stopEditing?.();
          }}
        />
      </div>
    </div>
  );
};

export const DynamicFieldCellEditor = (
  props: DynamicFieldCellEditorProps,
): React.ReactElement | null => {
  const { value, onValueChange, stopEditing, field } = props;
  const enumValues = useMemo(
    () => (field.fieldEnum ?? []).map(option => option.value),
    [field.fieldEnum],
  );

  if (field.fieldType === FormFieldType.USER) {
    return <UserFieldEditor {...props} />;
  }

  if (field.fieldType === FormFieldType.MULTI_SELECT) {
    return (
      <div className='h-full flex items-center px-2 bg-background'>
        <TagSelector
          availableTags={enumValues}
          selectedTags={toStringArray(value)}
          onTagsChange={onValueChange}
          {...(stopEditing ? { stopEditing } : {})}
          inlineTags={true}
          allowCreate={enumValues.length === 0}
        />
      </div>
    );
  }

  if (field.fieldType === FormFieldType.DATE) {
    return <DateFieldEditor {...props} />;
  }

  const isBoolean = field.fieldType === FormFieldType.BOOLEAN;
  const current = toStringArray(value)[0];
  return (
    <GenericCellEditor
      value={isBoolean ? toBooleanOptionValue(current) : (current ?? null)}
      onValueChange={next => onValueChange(next ?? '')}
      stopEditing={stopEditing}
      options={
        isBoolean
          ? BOOLEAN_OPTIONS
          : enumValues.map(option => ({ value: option, label: option, icon: optionDot }))
      }
      placeholder={field.fieldName}
      searchPlaceholder={`Search ${field.fieldName.toLowerCase()}...`}
    />
  );
};
