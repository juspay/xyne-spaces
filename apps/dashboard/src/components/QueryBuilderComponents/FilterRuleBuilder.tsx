import React, { useCallback, useState } from 'react';
import { X, Plus, Users, LayoutGrid, Folder, Hash } from 'lucide-react';
import { Button } from '../ui/Button';
import { DatePicker } from '../ui/DatePicker/DatePicker';
import { EntitySelector } from '../ui/EntitySelector/EntitySelector';
import { useUsers, useUserSearch } from '../../hooks/useUsers';
import { useUserGroups } from '../../hooks/useUserGroup';
import { useAllChannels } from '../../hooks/useChannels';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import Avatar from '../ui/Avatar/Avatar';
import Input from '../ui/Input/Input';
import {
  FilterGroup,
  FilterCondition,
  ComparisonOperator,
  generateId,
  isFilterCondition,
} from '../../utils/queryBuilder';
import type { FieldConfig } from '../../routes/QueryBuilderScreen/QueryBuilderScreen.utils';
import { transformValueForOperator } from '../../routes/QueryBuilderScreen/QueryBuilderScreen.utils';
import { detectFieldType } from '../../utils/queryBuilderFieldMappings';
import { getUserDisplayName, isUserDeactivated } from '../../utils/userDisplayName';

// Local types for dropdown items
interface BoardItem {
  id: string;
  name: string;
}

interface ProjectItem {
  id: string;
  name: string;
}

interface ChannelItem {
  id: string;
  name: string;
  channelName?: string;
}

interface FilterRuleBuilderProps {
  filters: FilterGroup | null;
  onChange: (filters: FilterGroup) => void;
  fields: FieldConfig[];
}

// Generic hook to get selected items from value
const useSelectedIds = (value: unknown): string[] => {
  return React.useMemo(() => {
    if (!value) return [];
    if (Array.isArray(value)) return value as string[];
    return [value as string];
  }, [value]);
};

// User Select Editor with proper single/multi-select
const UserSelectEditor: React.FC<{
  value: unknown;
  onChange: (value: unknown) => void;
  operator: string;
}> = ({ value, onChange, operator }) => {
  const isMultiSelect = operator === 'in' || operator === 'notIn';
  const [searchQuery, setSearchQuery] = useState('');
  const users = useUsers();
  const searchedUsers = useUserSearch(searchQuery, 20);

  const selectedIds = useSelectedIds(value);

  // Use searched users when there's a query, otherwise show all users
  const displayUsers = searchQuery.trim() ? searchedUsers : users;

  const handleToggle = (userId: string) => {
    const isSelected = selectedIds.includes(userId);
    let newIds: string[];

    if (isMultiSelect) {
      newIds = isSelected ? selectedIds.filter(id => id !== userId) : [...selectedIds, userId];
    } else {
      // Single select: toggle off if already selected, otherwise select this one
      newIds = isSelected ? [] : [userId];
    }

    onChange(isMultiSelect ? newIds : newIds[0] || '');
  };

  // Single select: show dropdown with search
  if (!isMultiSelect) {
    const options = (displayUsers || []).map(u => ({
      value: u.id,
      label: getUserDisplayName(u),
      icon: <Avatar userId={u.id} size='sm' showActiveStatus={false} />,
      subtitle: u.email,
      isDeactivated: isUserDeactivated(u),
    }));

    return (
      <div className='flex-1'>
        <EntitySelector
          options={options}
          selectedValue={selectedIds[0] || null}
          onSelect={val => onChange(val || '')}
          placeholder='Select user...'
          searchPlaceholder='Search users...'
          onSearchChange={setSearchQuery}
          showSearch={true}
          width='100%'
        />
      </div>
    );
  }

  // Multi select: show checkbox grid with search
  return (
    <div className='flex-1'>
      <div className='mb-2'>
        <Input
          type='text'
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder='Search users...'
          className='w-full'
        />
      </div>
      <div className='flex flex-wrap gap-2 max-h-40 overflow-y-auto p-1 border rounded'>
        {(displayUsers || []).map(user => {
          const isSelected = selectedIds.includes(user.id);
          const isDeactivated = isUserDeactivated(user);
          return (
            <label
              key={user.id}
              className={`flex items-center gap-2 text-sm px-2 py-1 border rounded cursor-pointer transition-colors ${
                isSelected
                  ? 'bg-blue-50 border-blue-300 text-blue-700'
                  : 'bg-white border-gray-200 hover:bg-gray-50'
              }`}
            >
              <input
                type='checkbox'
                checked={isSelected}
                onChange={() => handleToggle(user.id)}
                className='w-4 h-4'
                data-track-category='QueryBuilder'
                data-track-name='ToggleUserSelection'
              />
              <Avatar userId={user.id} size='sm' showActiveStatus={false} />
              <span className={isDeactivated ? 'text-gray-400' : ''}>
                {getUserDisplayName(user)}
              </span>
            </label>
          );
        })}
        {(!displayUsers || displayUsers.length === 0) && (
          <div className='text-sm text-gray-500 p-2'>No users found</div>
        )}
      </div>
    </div>
  );
};

// UserGroup Select Editor
const UserGroupSelectEditor: React.FC<{
  value: unknown;
  onChange: (value: unknown) => void;
  operator: string;
}> = ({ value, onChange, operator }) => {
  const isMultiSelect = operator === 'in' || operator === 'notIn';
  const [searchQuery, setSearchQuery] = useState('');
  const allGroups = useUserGroups();

  const selectedIds = useSelectedIds(value);

  // Filter groups by search
  const filteredGroups = React.useMemo(() => {
    if (!allGroups) return [];
    if (!searchQuery.trim()) return allGroups;
    const search = searchQuery.toLowerCase();
    return allGroups.filter(
      g => g.name.toLowerCase().includes(search) || g.alias?.toLowerCase().includes(search),
    );
  }, [allGroups, searchQuery]);

  const handleToggle = (groupId: string) => {
    const isSelected = selectedIds.includes(groupId);
    let newIds: string[];

    if (isMultiSelect) {
      newIds = isSelected ? selectedIds.filter(id => id !== groupId) : [...selectedIds, groupId];
    } else {
      newIds = isSelected ? [] : [groupId];
    }

    onChange(isMultiSelect ? newIds : newIds[0] || '');
  };

  // Single select: dropdown
  if (!isMultiSelect) {
    const options = (filteredGroups || []).map(g => ({
      value: g.id,
      label: g.name,
      icon: <Users className='w-4 h-4 text-gray-500' />,
      subtitle: g.alias ? `@${g.alias}` : '',
    }));

    return (
      <div className='flex-1'>
        <EntitySelector
          options={options}
          selectedValue={selectedIds[0] || null}
          onSelect={val => onChange(val || '')}
          placeholder='Select user group...'
          searchPlaceholder='Search groups...'
          onSearchChange={setSearchQuery}
          showSearch={true}
          width='100%'
        />
      </div>
    );
  }

  // Multi select: checkbox grid
  return (
    <div className='flex-1'>
      <div className='mb-2'>
        <Input
          type='text'
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder='Search groups...'
          className='w-full'
        />
      </div>
      <div className='flex flex-wrap gap-2 max-h-40 overflow-y-auto p-1 border rounded'>
        {(filteredGroups || []).map(group => {
          const isSelected = selectedIds.includes(group.id);
          return (
            <label
              key={group.id}
              className={`flex items-center gap-2 text-sm px-2 py-1 border rounded cursor-pointer transition-colors ${
                isSelected
                  ? 'bg-blue-50 border-blue-300 text-blue-700'
                  : 'bg-white border-gray-200 hover:bg-gray-50'
              }`}
            >
              <input
                type='checkbox'
                checked={isSelected}
                onChange={() => handleToggle(group.id)}
                className='w-4 h-4'
                data-track-category='QueryBuilder'
                data-track-name='ToggleUserGroupSelection'
              />
              <Users className='w-4 h-4 text-gray-500' />
              <span>{group.name}</span>
              {group.alias && <span className='text-xs text-gray-500'>@{group.alias}</span>}
            </label>
          );
        })}
        {(!filteredGroups || filteredGroups.length === 0) && (
          <div className='text-sm text-gray-500 p-2'>No groups found</div>
        )}
      </div>
    </div>
  );
};

// Board Select Editor
const BoardSelectEditor: React.FC<{
  value: unknown;
  onChange: (value: unknown) => void;
  operator: string;
}> = ({ value, onChange, operator }) => {
  const isMultiSelect = operator === 'in' || operator === 'notIn';
  const [searchQuery, setSearchQuery] = useState('');
  const [allBoards] = useCachedQuery(queries.getAllBoardsList());

  const selectedIds = useSelectedIds(value);

  const boards = React.useMemo(
    () =>
      (allBoards || []).map((b: BoardItem) => ({
        id: b.id,
        name: b.name,
      })),
    [allBoards],
  );

  // Filter boards by search
  const filteredBoards = React.useMemo(() => {
    if (!searchQuery.trim()) return boards;
    const search = searchQuery.toLowerCase();
    return boards.filter(b => b.name.toLowerCase().includes(search));
  }, [boards, searchQuery]);

  const handleToggle = (boardId: string) => {
    const isSelected = selectedIds.includes(boardId);
    let newIds: string[];

    if (isMultiSelect) {
      newIds = isSelected ? selectedIds.filter(id => id !== boardId) : [...selectedIds, boardId];
    } else {
      newIds = isSelected ? [] : [boardId];
    }

    onChange(isMultiSelect ? newIds : newIds[0] || '');
  };

  // Single select: dropdown
  if (!isMultiSelect) {
    const options = filteredBoards.map(b => ({
      value: b.id,
      label: b.name,
      icon: <LayoutGrid className='w-4 h-4 text-gray-500' />,
    }));

    return (
      <div className='flex-1'>
        <EntitySelector
          options={options}
          selectedValue={selectedIds[0] || null}
          onSelect={val => onChange(val || '')}
          placeholder='Select board...'
          searchPlaceholder='Search boards...'
          onSearchChange={setSearchQuery}
          showSearch={true}
          width='100%'
        />
      </div>
    );
  }

  // Multi select: checkbox grid
  return (
    <div className='flex-1'>
      <div className='mb-2'>
        <Input
          type='text'
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder='Search boards...'
          className='w-full'
        />
      </div>
      <div className='flex flex-wrap gap-2 max-h-40 overflow-y-auto p-1 border rounded'>
        {filteredBoards.map(board => {
          const isSelected = selectedIds.includes(board.id);
          return (
            <label
              key={board.id}
              className={`flex items-center gap-2 text-sm px-2 py-1 border rounded cursor-pointer transition-colors ${
                isSelected
                  ? 'bg-blue-50 border-blue-300 text-blue-700'
                  : 'bg-white border-gray-200 hover:bg-gray-50'
              }`}
            >
              <input
                type='checkbox'
                checked={isSelected}
                onChange={() => handleToggle(board.id)}
                className='w-4 h-4'
                data-track-category='QueryBuilder'
                data-track-name='ToggleBoardSelection'
              />
              <LayoutGrid className='w-4 h-4 text-gray-500' />
              <span>{board.name}</span>
            </label>
          );
        })}
        {filteredBoards.length === 0 && (
          <div className='text-sm text-gray-500 p-2'>No boards found</div>
        )}
      </div>
    </div>
  );
};

// Project Select Editor
const ProjectSelectEditor: React.FC<{
  value: unknown;
  onChange: (value: unknown) => void;
  operator: string;
}> = ({ value, onChange, operator }) => {
  const isMultiSelect = operator === 'in' || operator === 'notIn';
  const [searchQuery, setSearchQuery] = useState('');
  const [allProjects] = useCachedQuery(queries.getAllProjects());

  const selectedIds = useSelectedIds(value);

  const projects = React.useMemo(
    () =>
      (allProjects || []).map((p: ProjectItem) => ({
        id: p.id,
        name: p.name,
      })),
    [allProjects],
  );

  // Filter projects by search
  const filteredProjects = React.useMemo(() => {
    if (!searchQuery.trim()) return projects;
    const search = searchQuery.toLowerCase();
    return projects.filter(p => p.name.toLowerCase().includes(search));
  }, [projects, searchQuery]);

  const handleToggle = (projectId: string) => {
    const isSelected = selectedIds.includes(projectId);
    let newIds: string[];

    if (isMultiSelect) {
      newIds = isSelected
        ? selectedIds.filter(id => id !== projectId)
        : [...selectedIds, projectId];
    } else {
      newIds = isSelected ? [] : [projectId];
    }

    onChange(isMultiSelect ? newIds : newIds[0] || '');
  };

  // Single select: dropdown
  if (!isMultiSelect) {
    const options = filteredProjects.map(p => ({
      value: p.id,
      label: p.name,
      icon: <Folder className='w-4 h-4 text-gray-500' />,
    }));

    return (
      <div className='flex-1'>
        <EntitySelector
          options={options}
          selectedValue={selectedIds[0] || null}
          onSelect={val => onChange(val || '')}
          placeholder='Select project...'
          searchPlaceholder='Search projects...'
          onSearchChange={setSearchQuery}
          showSearch={true}
          width='100%'
        />
      </div>
    );
  }

  // Multi select: checkbox grid
  return (
    <div className='flex-1'>
      <div className='mb-2'>
        <Input
          type='text'
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder='Search projects...'
          className='w-full'
        />
      </div>
      <div className='flex flex-wrap gap-2 max-h-40 overflow-y-auto p-1 border rounded'>
        {filteredProjects.map(project => {
          const isSelected = selectedIds.includes(project.id);
          return (
            <label
              key={project.id}
              className={`flex items-center gap-2 text-sm px-2 py-1 border rounded cursor-pointer transition-colors ${
                isSelected
                  ? 'bg-blue-50 border-blue-300 text-blue-700'
                  : 'bg-white border-gray-200 hover:bg-gray-50'
              }`}
            >
              <input
                type='checkbox'
                checked={isSelected}
                onChange={() => handleToggle(project.id)}
                className='w-4 h-4'
                data-track-category='QueryBuilder'
                data-track-name='ToggleProjectSelection'
              />
              <Folder className='w-4 h-4 text-gray-500' />
              <span>{project.name}</span>
            </label>
          );
        })}
        {filteredProjects.length === 0 && (
          <div className='text-sm text-gray-500 p-2'>No projects found</div>
        )}
      </div>
    </div>
  );
};

// Channel Select Editor
const ChannelSelectEditor: React.FC<{
  value: unknown;
  onChange: (value: unknown) => void;
  operator: string;
}> = ({ value, onChange, operator }) => {
  const isMultiSelect = operator === 'in' || operator === 'notIn';
  const [searchQuery, setSearchQuery] = useState('');
  const allChannels = useAllChannels();

  const selectedIds = useSelectedIds(value);

  const channels = React.useMemo(
    () =>
      (allChannels || []).map((c: ChannelItem) => ({
        id: c.id,
        name: c.name || c.channelName || 'Unnamed Channel',
      })),
    [allChannels],
  );

  // Filter channels by search
  const filteredChannels = React.useMemo(() => {
    if (!searchQuery.trim()) return channels;
    const search = searchQuery.toLowerCase();
    return channels.filter(c => c.name.toLowerCase().includes(search));
  }, [channels, searchQuery]);

  const handleToggle = (channelId: string) => {
    const isSelected = selectedIds.includes(channelId);
    let newIds: string[];

    if (isMultiSelect) {
      newIds = isSelected
        ? selectedIds.filter(id => id !== channelId)
        : [...selectedIds, channelId];
    } else {
      newIds = isSelected ? [] : [channelId];
    }

    onChange(isMultiSelect ? newIds : newIds[0] || '');
  };

  // Single select: dropdown
  if (!isMultiSelect) {
    const options = filteredChannels.map(c => ({
      value: c.id,
      label: c.name,
      icon: <Hash className='w-4 h-4 text-gray-500' />,
    }));

    return (
      <div className='flex-1'>
        <EntitySelector
          options={options}
          selectedValue={selectedIds[0] || null}
          onSelect={val => onChange(val || '')}
          placeholder='Select channel...'
          searchPlaceholder='Search channels...'
          onSearchChange={setSearchQuery}
          showSearch={true}
          width='100%'
        />
      </div>
    );
  }

  // Multi select: checkbox grid
  return (
    <div className='flex-1'>
      <div className='mb-2'>
        <Input
          type='text'
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder='Search channels...'
          className='w-full'
        />
      </div>
      <div className='flex flex-wrap gap-2 max-h-40 overflow-y-auto p-1 border rounded'>
        {filteredChannels.map(channel => {
          const isSelected = selectedIds.includes(channel.id);
          return (
            <label
              key={channel.id}
              className={`flex items-center gap-2 text-sm px-2 py-1 border rounded cursor-pointer transition-colors ${
                isSelected
                  ? 'bg-blue-50 border-blue-300 text-blue-700'
                  : 'bg-white border-gray-200 hover:bg-gray-50'
              }`}
            >
              <input
                type='checkbox'
                checked={isSelected}
                onChange={() => handleToggle(channel.id)}
                className='w-4 h-4'
                data-track-category='QueryBuilder'
                data-track-name='ToggleChannelSelection'
              />
              <Hash className='w-4 h-4 text-gray-500' />
              <span>{channel.name}</span>
            </label>
          );
        })}
        {filteredChannels.length === 0 && (
          <div className='text-sm text-gray-500 p-2'>No channels found</div>
        )}
      </div>
    </div>
  );
};

export const FilterRuleBuilder: React.FC<FilterRuleBuilderProps> = ({
  filters,
  onChange,
  fields,
}): React.ReactElement => {
  const updateCondition = useCallback(
    (conditionId: string, updates: Partial<FilterCondition>): void => {
      if (!filters) return;

      const updateInGroup = (group: FilterGroup): FilterGroup => {
        return {
          ...group,
          conditions: group.conditions.map((item: FilterCondition | FilterGroup) => {
            if (isFilterCondition(item) && item.id === conditionId) {
              return { ...item, ...updates };
            }
            if (!isFilterCondition(item)) {
              return updateInGroup(item);
            }
            return item;
          }),
        };
      };

      onChange(updateInGroup(filters));
    },
    [filters, onChange],
  );

  const removeCondition = useCallback(
    (conditionId: string): void => {
      if (!filters) return;

      const removeFromGroup = (group: FilterGroup): FilterGroup => {
        return {
          ...group,
          conditions: group.conditions
            .filter(
              (item: FilterCondition | FilterGroup) =>
                !isFilterCondition(item) || item.id !== conditionId,
            )
            .map((item: FilterCondition | FilterGroup) =>
              !isFilterCondition(item) ? removeFromGroup(item) : item,
            ),
        };
      };

      const updated = removeFromGroup(filters);
      onChange(updated);
    },
    [filters, onChange],
  );

  const addCondition = useCallback((): void => {
    if (!filters) return;

    const newCondition: FilterCondition = {
      id: generateId('cond'),
      field: fields[0]?.name || '',
      operator: 'equals' as ComparisonOperator,
      value: '',
    };

    onChange({
      ...filters,
      conditions: [...filters.conditions, newCondition],
    });
  }, [filters, onChange, fields]);

  const setCombinator = useCallback(
    (combinator: 'AND' | 'OR'): void => {
      if (!filters) return;
      onChange({ ...filters, combinator });
    },
    [filters, onChange],
  );

  if (!filters) {
    return <div className='text-sm text-gray-500'>No filters configured</div>;
  }

  const getFieldConfig = (fieldName: string): FieldConfig | undefined => {
    return fields.find(f => f.name === fieldName);
  };

  const getIdFieldType = (fieldName: string) => {
    return detectFieldType(fieldName);
  };

  const renderValueEditor = (
    condition: FilterCondition,
    fieldConfig: FieldConfig | undefined,
  ): React.ReactElement => {
    if (!fieldConfig) {
      return (
        <input
          type='text'
          value={String(condition.value)}
          onChange={e =>
            updateCondition(condition.id, {
              value: transformValueForOperator(condition.operator, e.target.value),
            })
          }
          placeholder='Value'
          className='flex-1 px-2 py-1 text-sm border rounded'
          data-track-category='QueryBuilder'
          data-track-name='EnterValue'
        />
      );
    }

    const idFieldType = getIdFieldType(condition.field);

    // Use custom entity editors for ID fields
    if (idFieldType === 'user') {
      return (
        <UserSelectEditor
          value={condition.value}
          onChange={value => updateCondition(condition.id, { value })}
          operator={condition.operator}
        />
      );
    }

    if (idFieldType === 'userGroup') {
      return (
        <UserGroupSelectEditor
          value={condition.value}
          onChange={value => updateCondition(condition.id, { value })}
          operator={condition.operator}
        />
      );
    }

    if (idFieldType === 'board') {
      return (
        <BoardSelectEditor
          value={condition.value}
          onChange={value => updateCondition(condition.id, { value })}
          operator={condition.operator}
        />
      );
    }

    if (idFieldType === 'project') {
      return (
        <ProjectSelectEditor
          value={condition.value}
          onChange={value => updateCondition(condition.id, { value })}
          operator={condition.operator}
        />
      );
    }

    if (idFieldType === 'channel') {
      return (
        <ChannelSelectEditor
          value={condition.value}
          onChange={value => updateCondition(condition.id, { value })}
          operator={condition.operator}
        />
      );
    }

    // Handle ENUM/select fields with values property
    if (fieldConfig.values && fieldConfig.values.length > 0) {
      const isMultiSelect = condition.operator === 'in' || condition.operator === 'notIn';

      if (isMultiSelect) {
        const selectedValues: string[] = (
          Array.isArray(condition.value)
            ? (condition.value as string[])
            : typeof condition.value === 'string'
              ? [condition.value]
              : []
        ).filter(v => v !== '');

        return (
          <div className='flex-1 flex flex-wrap gap-2'>
            {fieldConfig.values.map(v => (
              <label
                key={v.name}
                className='flex items-center gap-2 text-sm px-2 py-1 bg-white border rounded cursor-pointer hover:bg-gray-50'
              >
                <input
                  type='checkbox'
                  checked={selectedValues.includes(v.name)}
                  onChange={e => {
                    const newValues = e.target.checked
                      ? [...selectedValues, v.name]
                      : selectedValues.filter(val => val !== v.name);
                    updateCondition(condition.id, {
                      value: newValues.length > 0 ? newValues : [],
                    });
                  }}
                  data-track-category='QueryBuilder'
                  data-track-name='SelectEnumValue'
                  className='w-4 h-4'
                />
                <span className='text-foreground whitespace-nowrap'>{v.label || v.name}</span>
              </label>
            ))}
          </div>
        );
      }

      return (
        <select
          value={String(condition.value)}
          onChange={e =>
            updateCondition(condition.id, {
              value: e.target.value,
            })
          }
          className='flex-1 px-3 py-2 text-sm border rounded bg-white text-foreground'
          data-track-category='QueryBuilder'
          data-track-name='SelectEnumValue'
        >
          <option value=''>Select value</option>
          {fieldConfig.values.map(v => (
            <option key={v.name} value={v.name}>
              {v.label || v.name}
            </option>
          ))}
        </select>
      );
    }

    // Date picker for date type fields
    if (fieldConfig.valueEditorType === 'date') {
      // For between operator, show two date pickers
      if (condition.operator === 'between') {
        const dateRange = Array.isArray(condition.value) ? condition.value : ['', ''];
        const startDate = dateRange[0]
          ? typeof dateRange[0] === 'string'
            ? new Date(dateRange[0])
            : dateRange[0] instanceof Date
              ? dateRange[0]
              : null
          : null;
        const endDate = dateRange[1]
          ? typeof dateRange[1] === 'string'
            ? new Date(dateRange[1])
            : dateRange[1] instanceof Date
              ? dateRange[1]
              : null
          : null;

        return (
          <div className='flex gap-2 items-center flex-1'>
            <DatePicker
              selectedDate={startDate}
              onSelect={date =>
                updateCondition(condition.id, {
                  value: [date ? date.toISOString() : '', dateRange[1] || ''],
                })
              }
              placeholder='Start date'
            />
            <span className='text-sm text-gray-500'>to</span>
            <DatePicker
              selectedDate={endDate}
              onSelect={date =>
                updateCondition(condition.id, {
                  value: [dateRange[0] || '', date ? date.toISOString() : ''],
                })
              }
              placeholder='End date'
            />
          </div>
        );
      }

      // Single date picker for other operators
      const dateValue = condition.value
        ? typeof condition.value === 'string'
          ? new Date(condition.value)
          : condition.value instanceof Date
            ? condition.value
            : null
        : null;

      return (
        <DatePicker
          selectedDate={dateValue}
          onSelect={date =>
            updateCondition(condition.id, {
              value: date ? date.toISOString() : '',
            })
          }
          placeholder='Select date'
          inputClassName='flex-1'
        />
      );
    }

    // Fallback for ID fields without values or other text fields
    return (
      <input
        type='text'
        value={String(condition.value)}
        onChange={e =>
          updateCondition(condition.id, {
            value: transformValueForOperator(condition.operator, e.target.value),
          })
        }
        placeholder='Value'
        className='flex-1 px-2 py-1 text-sm border rounded'
        data-track-category='QueryBuilder'
        data-track-name='EnterValue'
      />
    );
  };

  const renderCondition = (condition: FilterCondition): React.ReactElement => {
    const fieldConfig = getFieldConfig(condition.field);
    const operators = fieldConfig?.operators || [];

    return (
      <div key={condition.id} className='flex gap-2 items-center p-2 bg-gray-50 rounded'>
        <EntitySelector
          options={fields.map(f => ({
            value: f.name,
            label: f.label,
            icon: null,
          }))}
          selectedValue={condition.field || null}
          onSelect={value => {
            if (value) {
              updateCondition(condition.id, {
                field: value,
                operator:
                  (getFieldConfig(value)?.operators[0]?.name as ComparisonOperator) || 'equals',
                value: '',
              });
            }
          }}
          placeholder='Select field...'
          searchPlaceholder='Search fields...'
          showSearch={true}
          width='100%'
        />

        <EntitySelector
          options={operators.map((op: { name: string; label: string }) => ({
            value: op.name,
            label: op.label,
            icon: null,
          }))}
          selectedValue={condition.operator || null}
          onSelect={value => {
            if (value) {
              const nextOperator = value as ComparisonOperator;
              const isMultiNext = nextOperator === 'in' || nextOperator === 'notIn';
              const wasMultiPrev = condition.operator === 'in' || condition.operator === 'notIn';
              updateCondition(condition.id, {
                operator: nextOperator,
                ...(isMultiNext !== wasMultiPrev ? { value: isMultiNext ? [] : '' } : {}),
              });
            }
          }}
          placeholder='Select operator...'
          searchPlaceholder='Search operators...'
          showSearch={true}
          width='auto'
        />

        {renderValueEditor(condition, fieldConfig)}

        <Button
          variant='ghost'
          size='iconSm'
          onClick={() => removeCondition(condition.id)}
          data-track-category='QueryBuilder'
          data-track-name='REMOVE_FILTER_CONDITION'
          className='text-red-600 hover:bg-red-50'
        >
          <X className='w-4 h-4' />
        </Button>
      </div>
    );
  };

  return (
    <div className='flex flex-col gap-3'>
      {/* Combinator toggle */}
      <div className='flex gap-2'>
        <button
          onClick={() => setCombinator('AND')}
          className={`px-3 py-1 text-sm rounded font-medium transition-colors ${
            filters.combinator === 'AND'
              ? 'bg-blue-500 text-white'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          }`}
          data-track-category='QueryBuilder'
          data-track-name='SetCombinatorAND'
        >
          AND
        </button>
        <button
          onClick={() => setCombinator('OR')}
          className={`px-3 py-1 text-sm rounded font-medium transition-colors ${
            filters.combinator === 'OR'
              ? 'bg-blue-500 text-white'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          }`}
          data-track-category='QueryBuilder'
          data-track-name='SetCombinatorOR'
        >
          OR
        </button>
      </div>

      {/* Conditions */}
      <div className='flex flex-col gap-2'>
        {filters.conditions.map((item: FilterCondition | FilterGroup) =>
          isFilterCondition(item) ? renderCondition(item) : <div key={item.id}>Nested groups</div>,
        )}
      </div>

      {/* Add condition button */}
      <Button
        variant='outline'
        size='sm'
        onClick={addCondition}
        data-track-category='QueryBuilder'
        data-track-name='ADD_FILTER_CONDITION'
        className='w-full'
      >
        <Plus className='w-4 h-4 mr-2' />
        Add Condition
      </Button>
    </div>
  );
};
