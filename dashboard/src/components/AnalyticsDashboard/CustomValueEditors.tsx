import React from 'react';
import type { ValueEditorProps } from 'react-querybuilder';
import { queries } from '../../zero/queries';
import { useUserSearch } from '../../hooks/useUsers';
import { EntitySelector } from '../../components/ui/EntitySelector/EntitySelector';
import Input from '../../components/ui/Input/Input';
import { Badge } from '../../components/ui/Badge';
import Avatar from '../../components/ui/Avatar/Avatar';
import { X, Users, LayoutGrid } from 'lucide-react';
import { useCachedQuery } from '../../hooks/useCachedQuery';

function getSelectedItems(value: unknown): Array<{ id: string; name: string }> {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value as Array<{ id: string; name: string }>;
  }
  if (typeof value === 'object' && 'id' in value) {
    return [value as { id: string; name: string }];
  }
  return [];
}

function getOptionFromUser(user: { id: string; name: string; email?: string }) {
  return {
    value: user.id,
    label: user.name,
    ...(user.email && { subtitle: user.email }),
    icon: <Avatar userId={user.id} size='sm' showActiveStatus={false} />,
  };
}

function getOptionFromProject(project: { id: string; name: string }) {
  return {
    value: project.id,
    label: project.name,
    icon: <Users className='w-4 h-4' />,
  };
}

function getOptionFromUserGroup(group: { id: string; name: string }) {
  return {
    value: group.id,
    label: group.name,
    icon: <Users className='w-4 h-4' />,
  };
}

function getOptionFromBoard(board: { id: string; name: string }) {
  return {
    value: board.id,
    label: board.name,
    icon: <LayoutGrid className='w-4 h-4' />,
  };
}

export const UserSearchValueEditor: React.FC<{
  value: unknown;
  onChange: (value: unknown) => void;
  multi?: boolean;
}> = ({ value, onChange, multi = false }) => {
  const [searchQuery, setSearchQuery] = React.useState('');
  const searchResults = useUserSearch(searchQuery, 10);
  const selectedItems = getSelectedItems(value);

  const handleRemove = (userId: string): void => {
    if (multi) {
      const newItems = selectedItems.filter(u => u.id !== userId);
      onChange(newItems.length > 0 ? newItems : []);
    } else {
      onChange(null);
    }
  };

  const handleSelect = (userId: string | null): void => {
    if (!userId) {
      onChange(multi ? [] : null);
      return;
    }

    if (multi) {
      if (!selectedItems.some(u => u.id === userId)) {
        const selectedUser = searchResults?.find(u => u.id === userId);
        if (selectedUser) {
          onChange([...selectedItems, { id: selectedUser.id, name: selectedUser.name }]);
        }
      }
    } else {
      const selectedUser = searchResults?.find(u => u.id === userId);
      if (selectedUser) {
        onChange({ id: selectedUser.id, name: selectedUser.name });
      }
    }
    setSearchQuery('');
  };

  return (
    <div className='w-full'>
      {/* Show selected items as badges */}
      {selectedItems.length > 0 && (
        <div className='flex flex-wrap gap-1 mb-2'>
          {selectedItems.map(item => (
            <Badge key={item.id} variant='primary' className='flex items-center gap-1 pr-1'>
              <span className='text-xs'>{item.name}</span>
              <button
                type='button'
                onClick={() => handleRemove(item.id)}
                className='rounded-full p-0.5 hover:bg-background/20 transition-colors'
                data-track-category='ANALYTICS'
                data-track-name='REMOVE_USER_ITEM'
                data-track-metadata={JSON.stringify({ userId: item.id, itemName: item.name })}
              >
                <X className='h-3 w-3' />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {/* EntitySelector for new selection */}
      <EntitySelector
        options={(searchResults || []).map(getOptionFromUser)}
        selectedValue={null}
        onSelect={handleSelect}
        placeholder='Search users...'
        searchPlaceholder='Search by name or email'
        onSearchChange={setSearchQuery}
        isLoading={!searchResults}
      />
    </div>
  );
};

/**
 * Project Search Value Editor
 */
export const ProjectSearchValueEditor: React.FC<{
  value: unknown;
  onChange: (value: unknown) => void;
  multi?: boolean;
}> = ({ value, onChange, multi = false }) => {
  const [searchQuery, setSearchQuery] = React.useState('');
  const [allProjects] = useCachedQuery(queries.getAllProjects());
  const selectedItems = getSelectedItems(value);

  const handleRemove = (projectId: string): void => {
    if (multi) {
      const newItems = selectedItems.filter(p => p.id !== projectId);
      onChange(newItems.length > 0 ? newItems : []);
    } else {
      onChange(null);
    }
  };

  const handleSelect = (projectId: string | null): void => {
    if (!projectId) {
      onChange(multi ? [] : null);
      return;
    }

    if (multi) {
      if (!selectedItems.some(p => p.id === projectId)) {
        const selectedProject = allProjects?.find(p => p.id === projectId);
        if (selectedProject) {
          onChange([...selectedItems, { id: selectedProject.id, name: selectedProject.name }]);
        }
      }
    } else {
      const selectedProject = allProjects?.find(p => p.id === projectId);
      if (selectedProject) {
        onChange({ id: selectedProject.id, name: selectedProject.name });
      }
    }
    setSearchQuery('');
  };

  return (
    <div className='w-full'>
      {/* Show selected items as badges */}
      {selectedItems.length > 0 && (
        <div className='flex flex-wrap gap-1 mb-2'>
          {selectedItems.map(item => (
            <Badge key={item.id} variant='primary' className='flex items-center gap-1 pr-1'>
              <span className='text-xs'>{item.name}</span>
              <button
                type='button'
                onClick={() => handleRemove(item.id)}
                className='rounded-full p-0.5 hover:bg-background/20 transition-colors'
                data-track-category='ANALYTICS'
                data-track-name='REMOVE_PROJECT_ITEM'
                data-track-metadata={JSON.stringify({ projectId: item.id, itemName: item.name })}
              >
                <X className='h-3 w-3' />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {/* EntitySelector for new selection */}
      <EntitySelector
        options={(allProjects || [])
          .filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()))
          .map(getOptionFromProject)}
        selectedValue={null}
        onSelect={handleSelect}
        placeholder='Search projects...'
        searchPlaceholder='Search projects'
        onSearchChange={setSearchQuery}
      />
    </div>
  );
};

/**
 * User Group Search Value Editor
 */
export const UserGroupSearchValueEditor: React.FC<{
  value: unknown;
  onChange: (value: unknown) => void;
}> = ({ value, onChange }) => {
  const [searchQuery, setSearchQuery] = React.useState('');
  const [allUserGroups] = useCachedQuery(queries.getAllUserGroups());
  const selectedItems = getSelectedItems(value);

  const handleRemove = (groupId: string): void => {
    const newItems = selectedItems.filter(g => g.id !== groupId);
    onChange(newItems.length > 0 ? newItems : []);
  };

  const handleSelect = (groupId: string | null): void => {
    if (!groupId) {
      onChange([]);
      return;
    }

    if (!selectedItems.some(g => g.id === groupId)) {
      const selectedGroup = allUserGroups?.find(g => g.id === groupId);
      if (selectedGroup) {
        onChange([...selectedItems, { id: selectedGroup.id, name: selectedGroup.name }]);
      }
    }
    setSearchQuery('');
  };

  return (
    <div className='w-full'>
      {/* Show selected items as badges */}
      {selectedItems.length > 0 && (
        <div className='flex flex-wrap gap-1 mb-2'>
          {selectedItems.map(item => (
            <Badge key={item.id} variant='primary' className='flex items-center gap-1 pr-1'>
              <span className='text-xs'>{item.name}</span>
              <button
                type='button'
                onClick={() => handleRemove(item.id)}
                className='rounded-full p-0.5 hover:bg-background/20 transition-colors'
                data-track-event='BUTTON_CLICK'
                data-track-category='ANALYTICS'
                data-track-name='REMOVE_USER_GROUP_ITEM'
                data-track-metadata={JSON.stringify({ groupId: item.id, itemName: item.name })}
              >
                <X className='h-3 w-3' />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {/* EntitySelector for new selection */}
      <EntitySelector
        options={(allUserGroups || [])
          .filter(g => g.name.toLowerCase().includes(searchQuery.toLowerCase()))
          .map(getOptionFromUserGroup)}
        selectedValue={null}
        onSelect={handleSelect}
        placeholder='Search user groups...'
        searchPlaceholder='Search user groups'
        onSearchChange={setSearchQuery}
      />
    </div>
  );
};

/**
 * Board Search Value Editor
 */
export const BoardSearchValueEditor: React.FC<{
  value: unknown;
  onChange: (value: unknown) => void;
  multi?: boolean;
}> = ({ value, onChange, multi = false }) => {
  const [searchQuery, setSearchQuery] = React.useState('');
  const [allBoards] = useCachedQuery(queries.getAllBoards());
  const selectedItems = getSelectedItems(value);

  const handleRemove = (boardId: string): void => {
    if (multi) {
      const newItems = selectedItems.filter(p => p.id !== boardId);
      onChange(newItems.length > 0 ? newItems : []);
    } else {
      onChange(null);
    }
  };

  const handleSelect = (boardId: string | null): void => {
    if (!boardId) {
      onChange(multi ? [] : null);
      return;
    }

    if (multi) {
      if (!selectedItems.some(p => p.id === boardId)) {
        const selectedBoard = allBoards?.find(p => p.id === boardId);
        if (selectedBoard) {
          onChange([...selectedItems, { id: selectedBoard.id, name: selectedBoard.name }]);
        }
      }
    } else {
      const selectedBoard = allBoards?.find(p => p.id === boardId);
      if (selectedBoard) {
        onChange({ id: selectedBoard.id, name: selectedBoard.name });
      }
    }
    setSearchQuery('');
  };

  return (
    <div className='w-full'>
      {/* Show selected items as badges */}
      {selectedItems.length > 0 && (
        <div className='flex flex-wrap gap-1 mb-2'>
          {selectedItems.map(item => (
            <Badge key={item.id} variant='primary' className='flex items-center gap-1 pr-1'>
              <span className='text-xs'>{item.name}</span>
              <button
                type='button'
                onClick={() => handleRemove(item.id)}
                className='rounded-full p-0.5 hover:bg-background/20 transition-colors'
                data-track-category='ANALYTICS'
                data-track-name='REMOVE_BOARD_ITEM'
                data-track-metadata={JSON.stringify({ boardId: item.id, itemName: item.name })}
              >
                <X className='h-3 w-3' />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {/* EntitySelector for new selection */}
      <EntitySelector
        options={(allBoards || [])
          .filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()))
          .map(getOptionFromBoard)}
        selectedValue={null}
        onSelect={handleSelect}
        placeholder='Search boards...'
        searchPlaceholder='Search boards'
        onSearchChange={setSearchQuery}
      />
    </div>
  );
};

/**
 * Main Custom Value Editor Component
 */
export const CustomValueEditor = (props: ValueEditorProps): React.ReactNode => {
  const field = props.field;
  const operator = props.operator;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const value = props.value;
  const isMultiSelect = operator === 'in' || operator === 'notIn';

  // Wrap handleOnChange to avoid unbound-method warning
  const handleChange = (newValue: unknown): void => {
    props.handleOnChange(newValue);
  };

  // Determine field type dynamically based on field name patterns
  const fieldName = field?.replace('custom.', '') || '';
  const isDateField = fieldName.endsWith('At') || fieldName === 'eta';
  const isUserField = ['createdBy', 'updatedBy', 'assignedTo', 'closedBy'].includes(fieldName);
  const isProjectField = fieldName === 'projectId';
  const isBoardField = fieldName === 'boardId';
  const isUserGroupField = fieldName === 'userGroupId';

  // Check if this is an enum field (has pre-defined values)
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const enumValues = props.values as Array<{ name: string; label: string }> | undefined;

  // Date field
  if (isDateField) {
    // Handle "between" operator with two date inputs
    if (operator === 'between') {
      const values = Array.isArray(value) ? value : [];
      const startDate = values[0]
        ? new Date(values[0] as number | string).toISOString().split('T')[0]
        : '';
      const endDate = values[1]
        ? new Date(values[1] as number | string).toISOString().split('T')[0]
        : '';

      return (
        <div className='flex gap-2'>
          <Input
            type='date'
            value={startDate}
            onChange={e => {
              const newStartDate = e.target.value ? new Date(e.target.value).getTime() : null;
              const existingEndDate = values[1]
                ? new Date(values[1] as number | string).getTime()
                : null;
              handleChange(newStartDate !== null ? [newStartDate, existingEndDate] : []);
            }}
            placeholder='Start date'
          />
          <Input
            type='date'
            value={endDate}
            onChange={e => {
              const existingStartDate = values[0]
                ? new Date(values[0] as number | string).getTime()
                : null;
              const newEndDate = e.target.value ? new Date(e.target.value).getTime() : null;
              handleChange(newEndDate !== null ? [existingStartDate, newEndDate] : []);
            }}
            placeholder='End date'
          />
        </div>
      );
    }

    const valueArray = Array.isArray(value) ? value : null;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const singleValue = valueArray?.[0] ?? value;
    return (
      <Input
        type='date'
        value={
          singleValue ? new Date(singleValue as number | string).toISOString().split('T')[0] : ''
        }
        onChange={e => handleChange(e.target.value ? new Date(e.target.value).getTime() : null)}
      />
    );
  }

  // Enum field with dropdown options
  if (enumValues && enumValues.length > 0) {
    if (isMultiSelect) {
      // For multiselect (in/notIn), show a multi-select UI
      const selectedValues = (Array.isArray(value) ? value : value ? [value] : []) as string[];
      return (
        <div className='flex flex-wrap gap-1'>
          {enumValues.map(opt => {
            const isSelected = selectedValues.includes(opt.name);
            return (
              <button
                key={opt.name}
                type='button'
                onClick={() => {
                  if (isSelected) {
                    handleChange(selectedValues.filter(v => v !== opt.name));
                  } else {
                    handleChange([...selectedValues, opt.name]);
                  }
                }}
                className={`px-2 py-1 text-xs rounded border ${
                  isSelected
                    ? 'bg-blue-100 border-blue-300 text-blue-700'
                    : 'bg-background border-input text-foreground hover:bg-muted'
                }`}
                data-track-category='ANALYTICS'
                data-track-name='Toggle_Enum_Value'
                data-track-metadata={JSON.stringify({ value: opt.name, isSelected })}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      );
    }

    // Single select dropdown
    return (
      <select
        value={(value as string) || ''}
        onChange={e => handleChange(e.target.value || null)}
        className='w-full px-2 py-1 text-sm border rounded bg-background'
        data-track-category='ANALYTICS'
        data-track-name='Select_Filter_Value'
      >
        <option value=''>Select...</option>
        {enumValues.map(opt => (
          <option key={opt.name} value={opt.name}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }

  if (isUserField) {
    return (
      <UserSearchValueEditor
        value={value as unknown}
        onChange={handleChange}
        multi={isMultiSelect}
      />
    );
  }

  if (isProjectField) {
    return (
      <ProjectSearchValueEditor
        value={value as unknown}
        onChange={handleChange}
        multi={isMultiSelect}
      />
    );
  }

  if (isBoardField) {
    return (
      <BoardSearchValueEditor
        value={value as unknown}
        onChange={handleChange}
        multi={isMultiSelect}
      />
    );
  }

  if (isUserGroupField) {
    return <UserGroupSearchValueEditor value={value as unknown} onChange={handleChange} />;
  }

  return (
    <Input
      type='text'
      value={(value as string) ?? ''}
      onChange={e => handleChange(e.target.value)}
      placeholder='Enter value...'
    />
  );
};
