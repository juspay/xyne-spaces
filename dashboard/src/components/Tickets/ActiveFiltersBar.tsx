import React from 'react';
import { X, Users, GitBranch } from 'lucide-react';
import Avatar from '../ui/Avatar/Avatar';
import { useWorkflowTypes } from '../../hooks/useWorkflowTypes';
import type { User } from '@xyne/shared';
interface ActiveFiltersBarProps {
  createdByUsers: User[];
  assignedToUsers: User[];
  workflowTypeFilter: string[];
  onRemoveCreatedBy: (user: User) => void;
  onRemoveAssignedTo: (user: User) => void;
  onRemoveWorkflowType: (value: string) => void;
  onClearAll: () => void;
}

/* ── Stacked avatars (overlapping, max 3 visible) ── */
const AvatarStack: React.FC<{ users: User[] }> = ({ users }) => {
  const visible = users.slice(0, 3);
  return (
    <div data-id='avatar-stack' className='flex items-center -space-x-1'>
      {visible.map(user => (
        <Avatar
          key={user.id}
          userId={user.id}
          size='xs'
          rounded
          showActiveStatus={false}
          className='ring-1 ring-border'
        />
      ))}
    </div>
  );
};

/* ── Grouped user filter pill ── */
const UserFilterPill: React.FC<{
  label: string;
  users: User[];
  onClear: () => void;
}> = ({ label, users, onClear }) => {
  if (users.length === 0) return null;

  const countLabel =
    users.length === 1 ? (users[0]?.name ?? '1 user') : `${users.length} ${label.toLowerCase()}s`;

  return (
    <span
      data-id={`filter-pill-${label.toLowerCase()}`}
      className='inline-flex h-7 items-center rounded-full border border-border divide-x divide-border text-sm'
    >
      <span data-id='filter-pill-label' className='flex items-center gap-1.5 px-2.5'>
        <Users className='size-3.5 text-muted-foreground flex-shrink-0' />
        <span className='font-medium text-foreground'>{label}</span>
      </span>
      <span data-id='filter-pill-value' className='flex items-center gap-1.5 px-2.5'>
        <AvatarStack users={users} />
        <span className='text-foreground'>{countLabel}</span>
      </span>
      <button
        type='button'
        data-id='filter-pill-clear'
        data-track-category='Tickets'
        data-track-name='ClearFilterPill'
        onClick={onClear}
        className='flex items-center justify-center h-full px-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-r-full'
        aria-label={`Clear ${label} filter`}
      >
        <X className='size-3' />
      </button>
    </span>
  );
};

/* ── Workflow type filter pill ── */
const WorkflowTypePill: React.FC<{
  selectedValues: string[];
  onRemove: (value: string) => void;
  onClearAll: () => void;
}> = ({ selectedValues, onRemove, onClearAll }) => {
  const { workflowTypes } = useWorkflowTypes();

  if (selectedValues.length === 0) return null;

  const labels = selectedValues.map(v => {
    const wf = workflowTypes.find(w => w.id === v);
    return { value: v, label: wf?.label ?? v };
  });

  if (labels.length === 1 && labels[0]) {
    return (
      <span
        data-id='filter-pill-workflow'
        className='inline-flex h-7 items-center rounded-full border border-border divide-x divide-border text-sm'
      >
        <span data-id='filter-pill-label' className='flex items-center gap-1.5 px-2.5'>
          <GitBranch className='size-3.5 text-muted-foreground flex-shrink-0' />
          <span className='font-medium text-foreground'>Workflow</span>
        </span>
        <span data-id='filter-pill-mode' className='flex items-center px-2.5 text-muted-foreground'>
          is
        </span>
        <span data-id='filter-pill-value' className='flex items-center px-2.5 text-foreground'>
          {labels[0].label}
        </span>
        <button
          type='button'
          data-id='filter-pill-clear'
          data-track-category='Tickets'
          data-track-name='ClearFilterPill'
          onClick={() => onRemove(labels[0]!.value)}
          className='flex items-center justify-center h-full px-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-r-full'
        >
          <X className='size-3' />
        </button>
      </span>
    );
  }

  return (
    <span
      data-id='filter-pill-workflow'
      className='inline-flex h-7 items-center rounded-full border border-border divide-x divide-border text-sm'
    >
      <span data-id='filter-pill-label' className='flex items-center gap-1.5 px-2.5'>
        <GitBranch className='size-3.5 text-muted-foreground flex-shrink-0' />
        <span className='font-medium text-foreground'>Workflow</span>
      </span>
      <span data-id='filter-pill-mode' className='flex items-center px-2.5 text-muted-foreground'>
        is any of
      </span>
      <span data-id='filter-pill-value' className='flex items-center px-2.5 text-foreground'>
        {labels.length} types
      </span>
      <button
        type='button'
        data-id='filter-pill-clear'
        data-track-category='Tickets'
        data-track-name='ClearFilterPill'
        onClick={onClearAll}
        className='flex items-center justify-center h-full px-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-r-full'
      >
        <X className='size-3' />
      </button>
    </span>
  );
};

/* ── Bar ── */
const ActiveFiltersBar: React.FC<ActiveFiltersBarProps> = ({
  createdByUsers,
  assignedToUsers,
  workflowTypeFilter,
  onRemoveCreatedBy,
  onRemoveAssignedTo,
  onRemoveWorkflowType,
  onClearAll,
}) => {
  const hasFilters =
    createdByUsers.length > 0 || assignedToUsers.length > 0 || workflowTypeFilter.length > 0;
  if (!hasFilters) return null;

  const clearAssignees = () => {
    assignedToUsers.forEach(u => onRemoveAssignedTo(u));
  };

  const clearCreators = () => {
    createdByUsers.forEach(u => onRemoveCreatedBy(u));
  };

  const clearWorkflowTypes = () => {
    workflowTypeFilter.forEach(v => onRemoveWorkflowType(v));
  };

  return (
    <div
      data-id='ticket-header-active-filters'
      className='flex items-center justify-between gap-4 px-6'
    >
      <div
        data-id='ticket-header-active-filters-pills'
        className='flex items-center flex-wrap gap-2'
      >
        <UserFilterPill label='Assignee' users={assignedToUsers} onClear={clearAssignees} />
        <UserFilterPill label='Creator' users={createdByUsers} onClear={clearCreators} />
        <WorkflowTypePill
          selectedValues={workflowTypeFilter}
          onRemove={onRemoveWorkflowType}
          onClearAll={clearWorkflowTypes}
        />
      </div>

      <button
        type='button'
        data-id='ticket-header-active-filters-clear'
        data-track-category='Tickets'
        data-track-name='ClearAllFilters'
        onClick={onClearAll}
        className='text-sm text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap flex-shrink-0'
      >
        Clear
      </button>
    </div>
  );
};

export default ActiveFiltersBar;
