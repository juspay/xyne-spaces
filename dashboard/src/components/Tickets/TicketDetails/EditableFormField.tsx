import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  SingleSelect,
  SelectMenuAlignment,
  AvatarShape,
  AvatarSize,
} from '@juspay/blend-design-system';
import { FormFieldType, User } from '@xyne/shared';
import type { ReadonlyJSONValue } from '@rocicorp/zero';
import UserAvatar from '../../UserAvatar/UserAvatar';
import { useUsers } from '../../../hooks/useUsers';
import { MultiSelect } from '../../ui/MultiSelect';
import { SearchUserV2 } from '../../ui/SearchUser/SearchUserV2';

interface EditableFormFieldProps {
  fieldName: string;
  fieldValue: ReadonlyJSONValue;
  fieldType: FormFieldType;
  fieldEnum?: string[] | undefined; // Options for SELECT fields
  onSave: (newValue: string[]) => void; // Always accept string array
}

// Helper to convert JSON value to string for display
const jsonToString = (value: ReadonlyJSONValue): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return (value as string[]).join(', ');
  return '';
};

// Helper to extract array from JSON value for MULTI_SELECT
const jsonToArray = (value: ReadonlyJSONValue): string[] => {
  if (Array.isArray(value)) {
    // Ensure all items are strings and filter out empty strings
    return value.map(v => String(v)).filter(v => v.length > 0);
  }
  if (typeof value === 'string') {
    try {
      //eslint-disable-next-line  @typescript-eslint/no-unsafe-assignment
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(v => String(v)).filter(v => v.length > 0) : [];
    } catch {
      return [];
    }
  }
  return [];
};

export const EditableFormField: React.FC<EditableFormFieldProps> = ({
  fieldName,
  fieldValue,
  fieldType,
  fieldEnum,
  onSave,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(
    fieldType === FormFieldType.MULTI_SELECT
      ? jsonToArray(fieldValue).join(', ')
      : jsonToString(fieldValue),
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // Reset edit value when field value changes externally
  useEffect(() => {
    const newVal =
      fieldType === FormFieldType.MULTI_SELECT
        ? jsonToArray(fieldValue).join(', ')
        : jsonToString(fieldValue);
    setEditValue(newVal);
  }, [fieldValue, fieldType]);

  const inputRef = useRef<HTMLInputElement | HTMLSelectElement>(null);

  // Auto-focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      if (inputRef.current instanceof HTMLInputElement) {
        inputRef.current.select();
      }
    }
  }, [isEditing]);

  const handleSave = (newValue?: string): void => {
    const valueToSave = newValue ?? editValue;

    if (fieldType === FormFieldType.MULTI_SELECT && valueToSave) {
      // Split comma-separated values back to array
      const arrayValue = valueToSave
        .split(',')
        .map(v => v.trim())
        .filter(Boolean);
      onSave(arrayValue);
    } else if (valueToSave && jsonToString(fieldValue) !== valueToSave) {
      // Wrap single value in array for consistency
      onSave([valueToSave]);
    }
    setIsEditing(false);
  };

  const handleCancel = (): void => {
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  // Format display value for read mode
  const displayValue =
    fieldType === FormFieldType.MULTI_SELECT
      ? jsonToArray(fieldValue).join(', ')
      : jsonToString(fieldValue);

  // For USER field, fetch user details for display
  const selectedUserIds = useMemo(() => {
    if (fieldType === FormFieldType.USER) {
      return jsonToArray(fieldValue);
    }
    return [];
  }, [fieldValue, fieldType]);

  // Fetch user search results for edit mode
  const usersSearchResults = useUsers();

  // Create a map for O(1) user lookups by ID
  const userMap = useMemo<Map<string, User>>(() => {
    if (!usersSearchResults) return new Map();
    return new Map(usersSearchResults.map(user => [user.id, user]));
  }, [usersSearchResults]);

  const selectedUsers = useMemo(() => {
    return selectedUserIds
      .map(userId => userMap.get(userId))
      .filter((user): user is User => user !== undefined);
  }, [selectedUserIds, userMap]);

  if (isEditing) {
    if (fieldType === FormFieldType.BOOLEAN) {
      const booleanOptions = [
        { label: 'Yes', value: 'true' },
        { label: 'No', value: 'false' },
      ];

      return (
        <div className='flex items-center gap-2 w-full'>
          <span
            className='text-sm text-gray-500 w-[120px] flex-shrink-0 truncate overflow-hidden'
            title={fieldName}
          >
            {fieldName}
          </span>
          <div className='flex-1'>
            <SingleSelect
              placeholder={`Select ${fieldName.toLowerCase()}`}
              items={[{ items: booleanOptions }]}
              selected={editValue}
              onSelect={selected => {
                setEditValue(selected || '');
                if (selected && selected !== fieldValue) {
                  onSave([selected]);
                  setIsEditing(false);
                }
              }}
              alignment={SelectMenuAlignment.START}
            />
          </div>
        </div>
      );
    }

    if (fieldType === FormFieldType.DATE) {
      return (
        <div className='flex items-center gap-2 w-full'>
          <span
            className='text-sm text-gray-500 w-[120px] flex-shrink-0 truncate overflow-hidden'
            title={fieldName}
          >
            {fieldName}
          </span>
          <div className='flex-1'>
            <input
              ref={inputRef as React.RefObject<HTMLInputElement>}
              type='date'
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              onBlur={() => handleSave()}
              onKeyDown={handleKeyDown}
              className='w-full text-sm text-gray-900 border border-gray-300 rounded px-2 py-1 outline-none focus:border-blue-500'
              data-track-category='Tickets'
              data-track-name='EditDateField'
              data-track-metadata={JSON.stringify({ fieldName })}
            />
          </div>
        </div>
      );
    }

    if (fieldType === FormFieldType.SINGLE_SELECT && fieldEnum) {
      const selectOptions = fieldEnum.map(opt => ({ label: opt, value: opt }));

      return (
        <div className='flex items-center gap-2 w-full'>
          <span
            className='text-sm text-gray-500 w-[120px] flex-shrink-0 truncate overflow-hidden'
            title={fieldName}
          >
            {fieldName}
          </span>
          <div className='flex-1'>
            <SingleSelect
              placeholder={`Select ${fieldName.toLowerCase()}`}
              items={[{ items: selectOptions }]}
              selected={editValue}
              onSelect={selected => {
                setEditValue(selected || '');
                if (selected && selected !== fieldValue) {
                  onSave([selected]);
                  setIsEditing(false);
                }
              }}
              alignment={SelectMenuAlignment.START}
            />
          </div>
        </div>
      );
    }

    // MULTI_SELECT with fieldEnum - display as MultiSelect
    if (fieldType === FormFieldType.MULTI_SELECT && fieldEnum) {
      const selectedValues = jsonToArray(fieldValue);

      return (
        <div className='flex items-center gap-2 w-full'>
          <span
            className='text-sm text-gray-500 w-[120px] flex-shrink-0 truncate overflow-hidden'
            title={fieldName}
          >
            {fieldName}
          </span>
          <div className='flex-1'>
            <MultiSelect
              placeholder={`Select ${fieldName.toLowerCase()}`}
              options={fieldEnum.map(opt => ({
                label: opt,
                value: opt,
              }))}
              selectedValues={selectedValues}
              onChange={newValues => {
                onSave(newValues);
              }}
            />
          </div>
        </div>
      );
    }

    // USER field - SearchUserV2 with user options
    if (fieldType === FormFieldType.USER) {
      return (
        <div className='flex items-start gap-2 w-full'>
          <span
            className='text-sm text-gray-500 w-[120px] flex-shrink-0 truncate overflow-hidden'
            title={fieldName}
          >
            {fieldName}
          </span>
          <div className='flex-1 border border-gray-300 rounded outline-none focus:border-blue-500 focus-within:border-blue-500'>
            <SearchUserV2
              options={usersSearchResults || []}
              selectedUsers={selectedUsers}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onSelect={selected => {
                onSave(selected.map(u => u.id));
              }}
              isOpen={isSearchOpen}
              setIsOpen={setIsSearchOpen}
            />
          </div>
        </div>
      );
    }

    // STRING or NUMBER fields (fallback for MULTI_SELECT without fieldEnum)
    return (
      <div className='flex items-center gap-2 w-full'>
        <span
          className='text-sm text-gray-500 w-[120px] flex-shrink-0 truncate overflow-hidden'
          title={fieldName}
        >
          {fieldName}
        </span>
        <div className='flex-1'>
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            type={fieldType === FormFieldType.NUMBER ? 'number' : 'text'}
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={() => handleSave()}
            onKeyDown={handleKeyDown}
            className='w-full text-sm text-gray-900 border border-gray-300 rounded px-2 py-1 outline-none focus:border-blue-500'
            data-track-category='Tickets'
            data-track-name='EditTextField'
            data-track-metadata={JSON.stringify({ fieldName, fieldType })}
          />
        </div>
      </div>
    );
  }

  // Read mode
  if (fieldType === FormFieldType.USER) {
    // Display users with avatars and names
    return (
      <div className='flex items-start gap-2 w-full'>
        <span
          className='text-sm text-gray-500 w-[120px] flex-shrink-0 pt-0.5 truncate overflow-hidden'
          title={fieldName}
        >
          {fieldName}
        </span>
        <div
          role='button'
          tabIndex={0}
          className='flex-1 flex flex-wrap gap-2 cursor-text hover:bg-gray-100 rounded px-1 py-0.5 -mx-1'
          onClick={() => setIsEditing(true)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setIsEditing(true);
            }
          }}
          data-track-category='TicketDetails'
          data-track-name='EditUserField'
          data-track-metadata={JSON.stringify({
            fieldName,
            fieldType,
            fieldValue,
            selectedUserIds,
          })}
        >
          {selectedUsers.length > 0 ? (
            selectedUsers.map(user => (
              <div
                key={user.id}
                className='flex items-center gap-1.5 bg-gray-50 rounded-full px-2 py-0.5 border border-gray-200'
              >
                <UserAvatar userId={user.id} size={AvatarSize.SM} shape={AvatarShape.CIRCULAR} />
                <span className='text-sm text-[#525866]'>{user.name || 'Unknown'}</span>
              </div>
            ))
          ) : (
            <span className='text-sm text-gray-400'>—</span>
          )}
        </div>
      </div>
    );
  }

  // Read mode for other field types
  return (
    <div className='flex items-center gap-2 w-full'>
      <span
        className='text-sm text-gray-500 w-[120px] flex-shrink-0 truncate overflow-hidden'
        title={fieldName}
      >
        {fieldName}
      </span>
      <div
        role='button'
        tabIndex={0}
        className='flex-1 text-sm text-[#525866] break-all cursor-text hover:bg-gray-100 rounded px-1 py-0.5 -mx-1'
        onClick={() => setIsEditing(true)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsEditing(true);
          }
        }}
        data-track-category='TicketDetails'
        data-track-name='EditField'
        data-track-metadata={JSON.stringify({ fieldName, fieldType, fieldValue })}
      >
        {displayValue || '—'}
      </div>
    </div>
  );
};
