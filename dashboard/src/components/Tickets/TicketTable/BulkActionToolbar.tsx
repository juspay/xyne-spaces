import type React from 'react';
import { useState } from 'react';
import { EntitySelector } from '../../ui/EntitySelector/EntitySelector';
import { CircleCheckBig, UserIcon, X, Layers, Calendar, Tag } from 'lucide-react';
import { TicketStatusIcon } from '../../../assets/icons';
import type { TicketStatusV2, TicketPriority } from '@xyne/shared';
import { DatePicker } from '../../ui/DatePicker/DatePicker';
import { cn } from '../../../utils/classNames';
import type { User, UserGroup } from '../../../machines/stateMachine';
import {
  PriorityOptions,
  StatusOptions,
  useAssigneeOptions,
  useStageOptions,
} from './TicketTableHelper';
import type { ActiveMenu } from './TicketTableTypes';
import { TagSelector } from './TagSelector';

interface BulkActionToolbarProps {
  selectedCount: number;
  users?: User[];
  userGroups?: UserGroup[];
  stages?: Array<{ id: string; name: string }>;
  onAssigneeChange: (assignee: string | null) => void;
  onStatusChange: (status: TicketStatusV2) => void;
  onPriorityChange: (priority: TicketPriority | null) => void;
  onStageChange: (stage: string) => void;
  onDueDateChange: (date: Date | null) => void;
  onClearSelection: () => void;
  availableTags: string[];
  onTagsChange: (tags: string[]) => void;
}

export const BulkActionToolbar: React.FC<BulkActionToolbarProps> = ({
  selectedCount,
  users = [],
  userGroups = [],
  stages = [],
  onAssigneeChange,
  onStatusChange,
  onPriorityChange,
  onStageChange,
  onDueDateChange,
  onClearSelection,
  onTagsChange,
  availableTags,
}) => {
  const [activeMenu, setActiveMenu] = useState<ActiveMenu>(null);

  const assigneeOptions = useAssigneeOptions(users, userGroups);
  const stageOptions = useStageOptions(stages);

  return (
    <div
      className='
    bg-[#181B1D]
    p-2 sm:p-3
    flex flex-col sm:flex-row sm:items-center w-full md:max-w-[760px] gap-2 sm:gap-4
    absolute bottom-20 left-1/2 -translate-x-1/2
    right-2 sm:right-auto
    rounded-2xl shadow-2xl border border-white/10
    z-50
    max-w-[calc(100vw-1rem)]
  '
    >
      <div className='flex flex-wrap lg:flex-nowrap items-center justify-between sm:justify-start gap-1 sm:gap-6 w-full sm:w-auto'>
        {/* Selection Info Section */}
        <div className='flex items-center gap-2 pb-2 sm:pb-0 sm:pr-4 flex-1 sm:flex-none min-w-0'>
          <button
            onClick={onClearSelection}
            className='p-1 text-white hover:text-gray-400 transition-colors flex-shrink-0'
            title='Clear selection'
            data-track-category='Tickets'
            data-track-name='ClearTicketSelection'
          >
            <X className='w-4 h-4' />
          </button>
          <span className='text-xs sm:text-sm font-semibold text-white whitespace-nowrap overflow-hidden text-ellipsis'>
            {selectedCount} {selectedCount === 1 ? 'ticket' : 'tickets'} selected
          </span>
        </div>
        <div className='flex flex-wrap items-center gap-3 sm:gap-1 md:flex-nowrap justify-start w-full sm:w-auto'>
          {/* Assignee Selector */}
          <EntitySelector
            options={assigneeOptions}
            selectedValue={null}
            onSelect={v => {
              onAssigneeChange(v === '' ? null : v);
              setActiveMenu(null);
            }}
            placeholder='Assignee'
            searchPlaceholder='Search users or groups...'
            variant='inline'
            isOpen={activeMenu === 'assignee'}
            onOpenChange={open => setActiveMenu(open ? 'assignee' : null)}
            inputClassName='!bg-transparent placeholder:text-white text-white border-none hover:bg-white/5 text-xs sm:text-sm px-2 font-semibold'
            inputIcon={<UserIcon className='size-4' />}
            showIndicator={false}
          />

          {/* Status Selector */}
          <EntitySelector
            options={StatusOptions}
            selectedValue={null}
            onSelect={v => {
              if (v) onStatusChange(v as TicketStatusV2);
              setActiveMenu(null);
            }}
            placeholder='Status'
            searchPlaceholder='Search status...'
            variant='inline'
            isOpen={activeMenu === 'status'}
            onOpenChange={open => setActiveMenu(open ? 'status' : null)}
            inputClassName='!bg-transparent placeholder:text-white text-white border-none hover:bg-white/5 text-xs sm:text-sm px-2 font-semibold'
            inputIcon={<CircleCheckBig className='size-4' />}
            showIndicator={false}
          />

          {/* Priority Selector */}
          <EntitySelector
            options={PriorityOptions}
            selectedValue={null}
            onSelect={v => {
              onPriorityChange((v || null) as TicketPriority | null);
              setActiveMenu(null);
            }}
            placeholder='Priority'
            searchPlaceholder='Search priority...'
            variant='inline'
            isOpen={activeMenu === 'priority'}
            onOpenChange={open => setActiveMenu(open ? 'priority' : null)}
            inputClassName='!bg-transparent text-white placeholder:text-white border-none hover:bg-white/5 text-xs sm:text-sm px-2 font-semibold'
            inputIcon={<Layers className='size-4' />}
            showIndicator={false}
          />

          {/* Due Date Selector */}
          <div className='relative'>
            <button
              onClick={() => setActiveMenu(activeMenu === 'dueDate' ? null : 'dueDate')}
              className={cn(
                'flex items-center gap-1 sm:gap-3 px-2 sm:px-3 py-1.5 rounded-lg cursor-pointer transition-colors whitespace-nowrap',
                activeMenu === 'dueDate'
                  ? 'bg-white/10 text-white'
                  : 'text-gray-400 hover:bg-white/5 hover:text-white',
              )}
              data-track-category='Tickets'
              data-track-name='ToggleDueDateMenu'
            >
              <Calendar className='size-4 text-white flex-shrink-0' />
              <span className='text-xs sm:text-sm font-semibold text-white'>Due Date</span>
            </button>

            {activeMenu === 'dueDate' && (
              <div className='absolute bottom-full mb-4 left-0 z-50'>
                <DatePicker
                  selectedDate={null}
                  onSelect={date => {
                    onDueDateChange(date);
                    setActiveMenu(null);
                  }}
                  isInitialOpen={true}
                  showClearButton={true}
                />
              </div>
            )}
          </div>

          {/* Stage Selector */}
          {stageOptions.length > 0 && (
            <EntitySelector
              options={stageOptions}
              selectedValue={null}
              onSelect={v => {
                if (v) onStageChange(v);
                setActiveMenu(null);
              }}
              placeholder='Stage'
              searchPlaceholder='Search stages...'
              variant='inline'
              isOpen={activeMenu === 'stage'}
              onOpenChange={open => setActiveMenu(open ? 'stage' : null)}
              inputClassName='!bg-transparent text-white border-none placeholder:text-white hover:bg-white/5 text-xs sm:text-sm px-2'
              inputIcon={<TicketStatusIcon size={14} />}
            />
          )}

          {/* Tags Selector */}
          <div className='relative'>
            <button
              onClick={() => setActiveMenu(activeMenu === 'tags' ? null : 'tags')}
              className={cn(
                'flex items-center gap-1 sm:gap-3 px-2 sm:px-3 py-1.5 rounded-lg cursor-pointer transition-colors whitespace-nowrap',
                activeMenu === 'tags'
                  ? 'bg-white/10 text-white'
                  : 'text-gray-400 hover:bg-white/5 hover:text-white',
              )}
              data-track-category='Tickets'
              data-track-name='ToggleTagsMenu'
            >
              <Tag className='size-4 text-white flex-shrink-0' />
              <span className='text-xs sm:text-sm font-semibold text-white'>Tags</span>
            </button>

            {activeMenu === 'tags' && (
              <div className='absolute bottom-full mb-4 left-0 z-50'>
                <div className='bg-white rounded-lg shadow-lg border border-gray-200 p-2 min-w-[250px]'>
                  <TagSelector
                    availableTags={availableTags}
                    selectedTags={[]}
                    onTagsChange={tags => {
                      onTagsChange(tags);
                      setActiveMenu(null);
                    }}
                    stopEditing={() => setActiveMenu(null)}
                    inlineTags={true}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
