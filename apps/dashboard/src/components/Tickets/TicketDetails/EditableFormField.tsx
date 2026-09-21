import React, { useState, useRef, useEffect, useMemo } from 'react';
import { SingleSelect, SelectMenuAlignment } from '@juspay/blend-design-system';
import { LockClose as Lock } from '@xyne/icons';
import { AvatarShape, AvatarSize } from '../../UserAvatar/UserAvatar';
import { FormFieldType, User } from '@xyne/shared';
import type { ReadonlyJSONValue } from '@rocicorp/zero';
import UserAvatar from '../../UserAvatar/UserAvatar';
import { useUsers } from '../../../hooks/useUsers';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useAuth } from '../../../hooks/useAuth';
import { queries } from '../../../zero/queries';
import { MultiSelect } from '../../ui/MultiSelect';
import { SearchUserV2 } from '../../ui/SearchUser/SearchUserV2';
import { TicketFieldSelector } from '../TicketFieldSelector/TicketFieldSelector';
import { looksLikeXyneId } from '../TicketLinkField/ticketLinkUtils';
import { getUserDisplayName } from '../../../utils/userDisplayName';

interface EditableFormFieldProps {
  fieldName: string;
  fieldValue: ReadonlyJSONValue;
  fieldType: FormFieldType;
  fieldEnum?: string[] | undefined; // Options for SELECT fields
  onSave: (newValue: string[]) => void; // Always accept string array
  /** Show the field but refuse edits — the row carries a lock instead of a cursor. */
  readOnly?: boolean;
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

const formatBooleanDisplay = (value: ReadonlyJSONValue): string => {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === 'yes') return 'Yes';
    if (normalized === 'false' || normalized === 'no') return 'No';
  }
  return '';
};

/** Strict boolean edit value: only true/false; unknown inputs clear the field. */
const booleanToEditValue = (value: ReadonlyJSONValue): string => {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === 'yes') return 'true';
    if (normalized === 'false' || normalized === 'no') return 'false';
  }
  return '';
};

const normalizeBooleanSaveValue = (value: string): 'true' | 'false' | null => {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === 'yes') return 'true';
  if (normalized === 'false' || normalized === 'no') return 'false';
  return null;
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

/**
 * The click-to-edit surface of a read-mode row. Locked fields get no handlers and no button
 * semantics at all, so a field that cannot change never advertises that it can.
 */
const ReadModeValue = ({
  readOnly,
  className,
  onEdit,
  trackName,
  trackMetadata,
  children,
}: {
  readOnly: boolean;
  className: string;
  onEdit: () => void;
  trackName: string;
  trackMetadata: string;
  children: React.ReactNode;
}): React.ReactElement => {
  if (readOnly) {
    return <div className={`${className} cursor-default`}>{children}</div>;
  }
  return (
    <div
      role='button'
      tabIndex={0}
      className={`${className} cursor-text hover:bg-muted`}
      onClick={onEdit}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onEdit();
        }
      }}
      data-track-category='TicketDetails'
      data-track-name={trackName}
      data-track-metadata={trackMetadata}
    >
      {children}
    </div>
  );
};

export const EditableFormField: React.FC<EditableFormFieldProps> = ({
  fieldName,
  fieldValue,
  fieldType,
  fieldEnum,
  onSave,
  readOnly = false,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const beginEdit = (): void => {
    if (readOnly) return;
    setIsEditing(true);
  };
  const [editValue, setEditValue] = useState(
    fieldType === FormFieldType.MULTI_SELECT
      ? jsonToArray(fieldValue).join(', ')
      : fieldType === FormFieldType.BOOLEAN
        ? booleanToEditValue(fieldValue)
        : jsonToString(fieldValue),
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // Reset edit value when field value changes externally
  useEffect(() => {
    const newVal =
      fieldType === FormFieldType.MULTI_SELECT
        ? jsonToArray(fieldValue).join(', ')
        : fieldType === FormFieldType.BOOLEAN
          ? booleanToEditValue(fieldValue)
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

    if (fieldType === FormFieldType.BOOLEAN) {
      const normalized = normalizeBooleanSaveValue(valueToSave);
      if (normalized === null) {
        setIsEditing(false);
        return;
      }
      if (booleanToEditValue(fieldValue) !== normalized) {
        onSave([normalized]);
      }
      setIsEditing(false);
      return;
    }

    if (fieldType === FormFieldType.MULTI_SELECT && valueToSave) {
      // Split comma-separated values back to array
      const arrayValue = valueToSave
        .split(',')
        .map(v => v.trim())
        .filter(Boolean);
      onSave(arrayValue);
    } else if (
      fieldType !== FormFieldType.MULTI_SELECT &&
      jsonToString(fieldValue) !== valueToSave
    ) {
      // Single-value field: send [] when cleared so the field can be unset, not just edited.
      // The previous `valueToSave &&` guard treated an empty input as falsy and silently
      // dropped the clear, so a set value (e.g. the release version) could never be removed.
      onSave(valueToSave ? [valueToSave] : []);
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
    fieldType === FormFieldType.BOOLEAN
      ? formatBooleanDisplay(fieldValue)
      : fieldType === FormFieldType.MULTI_SELECT
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

  // For TICKET field, resolve the selected ticket for display. Values are
  // xyneIds; legacy stored values (ticket uuids) still resolve by id.
  const selectedTicketValue = useMemo(() => {
    if (fieldType === FormFieldType.TICKET) {
      return jsonToString(fieldValue);
    }
    return '';
  }, [fieldValue, fieldType]);

  const { user } = useAuth();
  const workspaceId = user?.workspaceId ?? '';
  const selectedValueIsXyneId = looksLikeXyneId(selectedTicketValue);
  const [selectedTicketById] = useCachedQuery(
    queries.ticketRowById({ ticketId: !selectedValueIsXyneId ? selectedTicketValue : '' }),
    { enabled: Boolean(selectedTicketValue) && !selectedValueIsXyneId },
  );
  const [selectedTicketByXyneId] = useCachedQuery(
    queries.ticketByXyneIdV3({
      xyneId: selectedValueIsXyneId ? selectedTicketValue : '',
      workspaceId,
    }),
    { enabled: selectedValueIsXyneId && Boolean(workspaceId) },
  );
  const selectedTicket = selectedValueIsXyneId ? selectedTicketByXyneId : selectedTicketById;

  if (isEditing) {
    if (fieldType === FormFieldType.BOOLEAN) {
      const booleanOptions = [
        { label: 'Yes', value: 'true' },
        { label: 'No', value: 'false' },
      ];

      return (
        <div className='flex items-center gap-2 w-full'>
          <span
            className='text-sm text-muted-foreground w-[186px] flex-shrink-0 overflow-x-auto whitespace-nowrap'
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
            className='text-sm text-muted-foreground w-[186px] flex-shrink-0 overflow-x-auto whitespace-nowrap'
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
              className='w-full text-sm text-foreground bg-background border border-input rounded px-2 py-1 outline-none focus:border-blue-500'
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
            className='text-sm text-muted-foreground w-[186px] flex-shrink-0 overflow-x-auto whitespace-nowrap'
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
              enableSearch
              searchPlaceholder='Search...'
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
            className='text-sm text-muted-foreground w-[186px] flex-shrink-0 overflow-x-auto whitespace-nowrap'
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
            className='text-sm text-muted-foreground w-[186px] flex-shrink-0 overflow-x-auto whitespace-nowrap'
            title={fieldName}
          >
            {fieldName}
          </span>
          <div className='flex-1 bg-background border border-input rounded outline-none focus:border-blue-500 focus-within:border-blue-500'>
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

    // TICKET field - TicketFieldSelector with vespa search
    if (fieldType === FormFieldType.TICKET) {
      return (
        <div className='flex items-start gap-2 w-full'>
          <span
            className='text-sm text-muted-foreground w-[186px] flex-shrink-0 overflow-x-auto whitespace-nowrap'
            title={fieldName}
          >
            {fieldName}
          </span>
          <div className='flex-1 bg-background border border-input rounded outline-none focus:border-blue-500 focus-within:border-blue-500'>
            <TicketFieldSelector
              selectedValue={selectedTicketValue || null}
              onSelect={ticketXyneId => {
                onSave(ticketXyneId ? [ticketXyneId] : []);
              }}
            />
          </div>
        </div>
      );
    }

    // STRING or NUMBER fields (fallback for MULTI_SELECT without fieldEnum)
    return (
      <div className='flex items-center gap-2 w-full'>
        <span
          className='text-sm text-muted-foreground w-[186px] flex-shrink-0 overflow-x-auto whitespace-nowrap'
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
            className='w-full text-sm text-foreground bg-background border border-input rounded px-2 py-1 outline-none focus:border-blue-500'
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
      <div className='grid min-h-[36px] w-full grid-cols-[186px_1fr] items-center gap-[14px] rounded-lg py-[5px] pr-[10px] transition-colors hover:bg-muted/40'>
        <span
          className='flex items-center gap-1.5 truncate whitespace-nowrap text-[13px] text-muted-foreground'
          title={readOnly ? `${fieldName} — read-only` : fieldName}
        >
          <span className='truncate'>{fieldName}</span>
          {readOnly && <Lock size={11} className='shrink-0 text-muted-foreground/70' />}
        </span>
        <ReadModeValue
          readOnly={readOnly}
          className='flex flex-1 flex-wrap gap-2 rounded px-1 py-0.5'
          onEdit={beginEdit}
          trackName='EditUserField'
          trackMetadata={JSON.stringify({ fieldName, fieldType, fieldValue, selectedUserIds })}
        >
          {selectedUsers.length > 0 ? (
            selectedUsers.map(user => (
              <div
                key={user.id}
                className='flex items-center gap-1.5 rounded-full border border-border bg-muted px-2 py-0.5'
              >
                <UserAvatar userId={user.id} size={AvatarSize.SM} shape={AvatarShape.CIRCULAR} />
                <span className='text-[13px] text-foreground'>{getUserDisplayName(user)}</span>
              </div>
            ))
          ) : (
            <span className='text-[13px] text-muted-foreground/60'>Empty</span>
          )}
        </ReadModeValue>
      </div>
    );
  }

  // Read mode for TICKET field - display the linked ticket's title
  if (fieldType === FormFieldType.TICKET) {
    const ticketLabel = selectedTicket
      ? selectedTicket.title || selectedTicket.xyneId || selectedTicket.id
      : selectedTicketValue;

    return (
      <div className='grid min-h-[36px] w-full grid-cols-[186px_1fr] items-center gap-[14px] rounded-lg py-[5px] pr-[10px] transition-colors hover:bg-muted/40'>
        <span
          className='flex items-center gap-1.5 truncate whitespace-nowrap text-[13px] text-muted-foreground'
          title={readOnly ? `${fieldName} — read-only` : fieldName}
        >
          <span className='truncate'>{fieldName}</span>
          {readOnly && <Lock size={11} className='shrink-0 text-muted-foreground/70' />}
        </span>
        <ReadModeValue
          readOnly={readOnly}
          className='min-w-0 break-words rounded px-1 py-0.5 text-[13px]'
          onEdit={beginEdit}
          trackName='EditTicketField'
          trackMetadata={JSON.stringify({ fieldName, fieldType, fieldValue })}
        >
          {ticketLabel ? (
            <span className='font-medium text-foreground'>{ticketLabel}</span>
          ) : (
            <span className='text-muted-foreground/60'>Empty</span>
          )}
        </ReadModeValue>
      </div>
    );
  }

  // Read mode for other field types
  return (
    <div className='grid min-h-[36px] w-full grid-cols-[186px_1fr] items-center gap-[14px] rounded-lg py-[5px] pr-[10px] transition-colors hover:bg-muted/40'>
      <span
        className='flex items-center gap-1.5 truncate whitespace-nowrap text-[13px] text-muted-foreground'
        title={readOnly ? `${fieldName} — read-only` : fieldName}
      >
        <span className='truncate'>{fieldName}</span>
        {readOnly && <Lock size={11} className='shrink-0 text-muted-foreground/70' />}
      </span>
      <ReadModeValue
        readOnly={readOnly}
        className='min-w-0 break-words rounded px-1 py-0.5 text-[13px]'
        onEdit={beginEdit}
        trackName='EditField'
        trackMetadata={JSON.stringify({ fieldName, fieldType, fieldValue })}
      >
        {displayValue ? (
          <span className='font-medium text-foreground'>{displayValue}</span>
        ) : (
          <span className='text-muted-foreground/60'>Empty</span>
        )}
      </ReadModeValue>
    </div>
  );
};
