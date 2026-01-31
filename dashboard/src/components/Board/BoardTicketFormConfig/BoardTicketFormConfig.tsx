import { ReactElement } from 'react';
import { Switch } from '../../ui/Switch';

export interface TicketFormConfig {
  userGroupsOnly?: {
    enabled: boolean;
    mandatory?: boolean;
  };
  dueDate?: {
    enabled: boolean;
    mandatory?: boolean;
  };
  todo?: {
    enabled: boolean;
    mandatory?: boolean;
  };
  workflows?: {
    enabled: boolean;
    mandatory?: boolean;
  };
  labels?: {
    enabled: boolean;
    mandatory?: boolean;
  };
  merchantId?: {
    enabled: boolean;
    mandatory?: boolean;
  };
}

export interface BoardMetadata {
  ticketFormConfig?: TicketFormConfig;
}

interface BoardTicketFormConfigProps {
  config: Required<TicketFormConfig>;
  onChange: (config: Required<TicketFormConfig>) => void;
  disabled?: boolean;
}

export const DEFAULT_CONFIG: Required<TicketFormConfig> = {
  userGroupsOnly: { enabled: false, mandatory: false },
  dueDate: { enabled: true, mandatory: false },
  todo: { enabled: true, mandatory: false },
  workflows: { enabled: true, mandatory: false },
  labels: { enabled: true, mandatory: false },
  merchantId: { enabled: false, mandatory: false },
};

export const BoardTicketFormConfig = ({
  config,
  onChange,
  disabled = false,
}: BoardTicketFormConfigProps): ReactElement => {
  const handleToggle = (field: keyof TicketFormConfig, property: 'enabled' | 'mandatory'): void => {
    onChange({
      ...config,
      [field]: {
        ...config[field],
        [property]: !config[field][property],
      },
    });
  };

  return (
    <div className='space-y-4'>
      <div>
        <h3 className='text-sm font-medium text-gray-900 mb-1'>Ticket Form Configuration</h3>
        <p className='text-xs text-gray-500'>
          Configure which fields are shown when creating/editing tickets on this board
        </p>
      </div>

      <div className='space-y-3 bg-gray-50 border border-gray-200 rounded-lg p-4'>
        {/* User Groups Only */}
        <div className='py-2'>
          <div className='flex items-center justify-between mb-2'>
            <div className='flex-1'>
              <label htmlFor='userGroupsOnly' className='text-sm font-medium text-gray-700'>
                Show Only User Groups in Assignee
              </label>
              <p className='text-xs text-gray-500 mt-0.5'>
                When enabled, assignee dropdown will only show user groups (hide individual users)
              </p>
            </div>
            <Switch
              id='userGroupsOnly'
              checked={config.userGroupsOnly.enabled}
              onCheckedChange={() => handleToggle('userGroupsOnly', 'enabled')}
              disabled={disabled}
            />
          </div>
          {config.userGroupsOnly.enabled && (
            <div className='flex items-center justify-between ml-4 pl-4 border-l-2 border-gray-300'>
              <label htmlFor='userGroupsOnly-mandatory' className='text-xs text-gray-600'>
                Make mandatory
              </label>
              <Switch
                id='userGroupsOnly-mandatory'
                checked={config.userGroupsOnly.mandatory ?? false}
                onCheckedChange={() => handleToggle('userGroupsOnly', 'mandatory')}
                disabled={disabled}
              />
            </div>
          )}
        </div>

        {/* Due Date */}
        <div className='py-2 border-t border-gray-200'>
          <div className='flex items-center justify-between mb-2'>
            <div className='flex-1'>
              <label htmlFor='dueDate' className='text-sm font-medium text-gray-700'>
                Due Date Field
              </label>
              <p className='text-xs text-gray-500 mt-0.5'>
                Show/hide due date field in ticket form
              </p>
            </div>
            <Switch
              id='dueDate'
              checked={config.dueDate.enabled}
              onCheckedChange={() => handleToggle('dueDate', 'enabled')}
              disabled={disabled}
            />
          </div>
          {config.dueDate.enabled && (
            <div className='flex items-center justify-between ml-4 pl-4 border-l-2 border-gray-300'>
              <label htmlFor='dueDate-mandatory' className='text-xs text-gray-600'>
                Make mandatory
              </label>
              <Switch
                id='dueDate-mandatory'
                checked={config.dueDate.mandatory ?? false}
                onCheckedChange={() => handleToggle('dueDate', 'mandatory')}
                disabled={disabled}
              />
            </div>
          )}
        </div>

        {/* Todo/Checklist */}
        <div className='py-2 border-t border-gray-200'>
          <div className='flex items-center justify-between mb-2'>
            <div className='flex-1'>
              <label htmlFor='todo' className='text-sm font-medium text-gray-700'>
                Todo/Checklist Field
              </label>
              <p className='text-xs text-gray-500 mt-0.5'>
                Show/hide todo/checklist field in ticket form
              </p>
            </div>
            <Switch
              id='todo'
              checked={config.todo.enabled}
              onCheckedChange={() => handleToggle('todo', 'enabled')}
              disabled={disabled}
            />
          </div>
          {config.todo.enabled && (
            <div className='flex items-center justify-between ml-4 pl-4 border-l-2 border-gray-300'>
              <label htmlFor='todo-mandatory' className='text-xs text-gray-600'>
                Make mandatory
              </label>
              <Switch
                id='todo-mandatory'
                checked={config.todo.mandatory ?? false}
                onCheckedChange={() => handleToggle('todo', 'mandatory')}
                disabled={disabled}
              />
            </div>
          )}
        </div>

        {/* Workflows */}
        <div className='py-2 border-t border-gray-200'>
          <div className='flex items-center justify-between mb-2'>
            <div className='flex-1'>
              <label htmlFor='workflows' className='text-sm font-medium text-gray-700'>
                Workflows Field
              </label>
              <p className='text-xs text-gray-500 mt-0.5'>
                Show/hide workflows field in ticket form
              </p>
            </div>
            <Switch
              id='workflows'
              checked={config.workflows.enabled}
              onCheckedChange={() => handleToggle('workflows', 'enabled')}
              disabled={disabled}
            />
          </div>
          {config.workflows.enabled && (
            <div className='flex items-center justify-between ml-4 pl-4 border-l-2 border-gray-300'>
              <label htmlFor='workflows-mandatory' className='text-xs text-gray-600'>
                Make mandatory
              </label>
              <Switch
                id='workflows-mandatory'
                checked={config.workflows.mandatory ?? false}
                onCheckedChange={() => handleToggle('workflows', 'mandatory')}
                disabled={disabled}
              />
            </div>
          )}
        </div>

        {/* Labels */}
        <div className='py-2 border-t border-gray-200'>
          <div className='flex items-center justify-between mb-2'>
            <div className='flex-1'>
              <label htmlFor='labels' className='text-sm font-medium text-gray-700'>
                Labels/Tags Field
              </label>
              <p className='text-xs text-gray-500 mt-0.5'>
                Show/hide labels/tags field in ticket form
              </p>
            </div>
            <Switch
              id='labels'
              checked={config.labels.enabled}
              onCheckedChange={() => handleToggle('labels', 'enabled')}
              disabled={disabled}
            />
          </div>
          {config.labels.enabled && (
            <div className='flex items-center justify-between ml-4 pl-4 border-l-2 border-gray-300'>
              <label htmlFor='labels-mandatory' className='text-xs text-gray-600'>
                Make mandatory
              </label>
              <Switch
                id='labels-mandatory'
                checked={config.labels.mandatory ?? false}
                onCheckedChange={() => handleToggle('labels', 'mandatory')}
                disabled={disabled}
              />
            </div>
          )}
        </div>

        {/* Merchant ID */}
        <div className='py-2 border-t border-gray-200'>
          <div className='flex items-center justify-between mb-2'>
            <div className='flex-1'>
              <label htmlFor='merchantId' className='text-sm font-medium text-gray-700'>
                Merchant ID Field
              </label>
              <p className='text-xs text-gray-500 mt-0.5'>
                Show/hide merchant ID field in ticket form
              </p>
            </div>
            <Switch
              id='merchantId'
              checked={config.merchantId.enabled}
              onCheckedChange={() => handleToggle('merchantId', 'enabled')}
              disabled={disabled}
            />
          </div>
          {config.merchantId.enabled && (
            <div className='flex items-center justify-between ml-4 pl-4 border-l-2 border-gray-300'>
              <label htmlFor='merchantId-mandatory' className='text-xs text-gray-600'>
                Make mandatory
              </label>
              <Switch
                id='merchantId-mandatory'
                checked={config.merchantId.mandatory ?? false}
                onCheckedChange={() => handleToggle('merchantId', 'mandatory')}
                disabled={disabled}
              />
            </div>
          )}
        </div>
      </div>

      <div className='bg-blue-50 border border-blue-200 rounded-lg p-3'>
        <p className='text-xs text-blue-800'>
          <strong>Note:</strong> Board, Priority, and Stage are compulsory fields and cannot be
          toggled.
        </p>
      </div>
    </div>
  );
};
