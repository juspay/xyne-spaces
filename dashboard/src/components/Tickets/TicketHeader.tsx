import React, { useState } from 'react';
import {
  ButtonType,
  Modal,
  Button,
  MultiSelect,
  TextInput,
  DateRangePicker,
  DateFormatPreset,
  DateRange,
} from '@juspay/blend-design-system';
import { Search } from 'lucide-react';
import CreateTicket from './CreateTicket';
import { SearchUser } from '../ui/SearchUser/SearchUser';
import { TicketCategory } from '@xyne/shared';
import { User } from '@xyne/shared';
import { useCanCreateTicket } from '../../hooks/usePermissions';

export interface TicketFilters {
  searchQuery: string;
  statusFilter: string[];
  workflowTypeFilter: string[];
  environmentFilter: string[];
  createdByFilter: User[];
  assignedToFilter: User[];
  dateRangeFilter: DateRange | null;
}

interface TicketHeaderProps {
  filters: TicketFilters;
  onFiltersChange: (filters: TicketFilters) => void;
}

const TicketHeader: React.FC<TicketHeaderProps> = ({ filters, onFiltersChange }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const canCreateTicket = useCanCreateTicket();

  const handleMultiSelectChange =
    (filterKey: keyof TicketFilters) =>
    (value: string): void => {
      const currentValues = filters[filterKey] as string[];
      if (value === '') {
        onFiltersChange({ ...filters, [filterKey]: [] });
      } else {
        const newValues = currentValues.includes(value)
          ? currentValues.filter(v => v !== value)
          : [...currentValues, value];
        onFiltersChange({ ...filters, [filterKey]: newValues });
      }
    };

  const hasActiveFilters = (): boolean => {
    return (
      filters.statusFilter.length > 0 ||
      filters.workflowTypeFilter.length > 0 ||
      filters.environmentFilter.length > 0 ||
      filters.createdByFilter.length > 0 ||
      filters.assignedToFilter.length > 0 ||
      filters.dateRangeFilter !== null
    );
  };

  const clearAllFilters = (): void => {
    onFiltersChange({
      ...filters,
      searchQuery: '',
      statusFilter: [],
      workflowTypeFilter: [],
      environmentFilter: [],
      createdByFilter: [],
      assignedToFilter: [],
      dateRangeFilter: null,
    });
  };

  const clearFilters = (): void => {
    onFiltersChange({
      ...filters,
      statusFilter: [],
      workflowTypeFilter: [],
      environmentFilter: [],
      createdByFilter: [],
      assignedToFilter: [],
      dateRangeFilter: null,
    });
  };

  const statusOptions = ['NEW', 'PENDING', 'SCHEDULED', 'SUCCESS', 'FAILURE', 'PAUSED'];
  const workflowTypeOptions = Object.values(TicketCategory);

  return (
    <div className='space-y-6 mb-8'>
      <div className='flex items-center justify-between'>
        <h1 className='font-semibold text-xl leading-[32px] tracking-normal text-foreground whitespace-nowrap'>
          Tickets Workflows
        </h1>
        {canCreateTicket && (
          <Button
            buttonType={ButtonType.PRIMARY}
            onClick={() => setIsModalOpen(true)}
            text='Create Automation Run'
          />
        )}
      </div>

      <div className='flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4'>
        <div className='flex flex-col sm:flex-row items-start sm:items-center gap-4 w-full lg:w-auto'>
          <div className='w-[300px]'>
            <TextInput
              placeholder='Search for Ticket ID / Ticket Title'
              value={filters.searchQuery}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                onFiltersChange({ ...filters, searchQuery: e.target.value })
              }
              leftSlot={<Search className='w-4 h-4' />}
            />
          </div>
          {filters.searchQuery.trim() && (
            <button
              onClick={clearAllFilters}
              className='flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-md transition-colors whitespace-nowrap'
            >
              <span>Clear All</span>
            </button>
          )}
        </div>

        <div className='flex flex-wrap items-center gap-2 lg:gap-4 w-full lg:w-auto'>
          {hasActiveFilters() && (
            <button
              onClick={clearFilters}
              className='flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-md transition-colors whitespace-nowrap'
            >
              <span>Clear Filters</span>
            </button>
          )}

          <MultiSelect
            label=''
            items={[
              {
                items: statusOptions.map(option => ({
                  label: option,
                  value: option,
                })),
              },
            ]}
            selectedValues={filters.statusFilter}
            onChange={handleMultiSelectChange('statusFilter')}
            placeholder='Status'
            enableSearch={true}
            enableSelectAll={true}
          />

          <MultiSelect
            label=''
            items={[
              {
                items: workflowTypeOptions.map(option => ({
                  label: option.replace(/_/g, ' '),
                  value: option,
                })),
              },
            ]}
            selectedValues={filters.workflowTypeFilter}
            onChange={handleMultiSelectChange('workflowTypeFilter')}
            placeholder='Workflow Type'
            enableSearch={true}
            enableSelectAll={true}
          />

          <div className='w-[200px]'>
            <SearchUser
              excludeUserIds={[]}
              selectedUsers={filters.createdByFilter}
              onUsersChange={users => onFiltersChange({ ...filters, createdByFilter: users })}
              placeholder='Created By'
              label=''
              width='100%'
              hintText=''
            />
          </div>

          <div className='w-[200px]'>
            <SearchUser
              excludeUserIds={[]}
              selectedUsers={filters.assignedToFilter}
              onUsersChange={users => onFiltersChange({ ...filters, assignedToFilter: users })}
              placeholder='Assigned To'
              label=''
              width='100%'
              hintText=''
            />
          </div>

          <DateRangePicker
            showDateTimePicker={false}
            value={
              filters.dateRangeFilter || {
                startDate: new Date(),
                endDate: new Date(),
              }
            }
            onChange={(range: DateRange) => onFiltersChange({ ...filters, dateRangeFilter: range })}
            formatConfig={{
              preset: DateFormatPreset.SHORT_RANGE,
              includeTime: false,
              includeYear: true,
            }}
            showPresets={true}
          />
        </div>
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={'Create Automation Run'}
        showCloseButton={true}
        closeOnBackdropClick={true}
        showDivider={true}
      >
        <CreateTicket isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
      </Modal>
    </div>
  );
};

export default TicketHeader;
