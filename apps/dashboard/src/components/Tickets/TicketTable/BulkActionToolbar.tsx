import type React from 'react';
import { useMemo, useState } from 'react';
import { EntitySelector } from '../../ui/EntitySelector/EntitySelector';
import {
  CheckTickCircle as CircleCheckBig,
  UserDefault as UserIcon,
  MultipleCrossCancelDefault as X,
  LayerTwo as Layers,
  CalendarDefault as Calendar,
  Tag,
} from '@xyne/icons';
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
import type { ActiveMenu, StageOptionSource } from './TicketTableTypes';
import { TagSelector } from './TagSelector';

interface BulkActionToolbarProps {
  selectedCount: number;
  users?: User[];
  userGroups?: UserGroup[];
  stages?: StageOptionSource[];
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

  // The server rejects an eta in the past, so past days can't be offered. Midnight,
  // not `new Date()` — otherwise today itself would compare as earlier and be disabled.
  const startOfToday = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  }, []);

  const assigneeOptions = useAssigneeOptions(users, userGroups);
  const stageOptions = useStageOptions(stages);

  return (
    <div
      className='
    bg-card
    p-2 sm:p-3
    flex flex-col sm:flex-row sm:items-center w-full sm:w-max gap-2 sm:gap-4
    absolute bottom-20 left-1/2 -translate-x-1/2
    right-2 sm:right-auto
    rounded-2xl shadow-2xl border border-border
    z-50
    max-w-[min(100%,calc(100vw-1rem))]
  '
    >
      <div className='flex flex-wrap items-center justify-between sm:justify-start gap-1 sm:gap-6 w-full sm:w-auto'>
        {/* Selection Info Section */}
        <div className='flex items-center gap-2 pb-2 sm:pb-0 sm:pr-4 flex-1 sm:flex-none min-w-0'>
          <button
            onClick={onClearSelection}
            className='p-1 text-foreground hover:text-muted-foreground transition-colors flex-shrink-0'
            title='Clear selection'
            data-track-category='Tickets'
            data-track-name='ClearTicketSelection'
          >
            <X className='w-4 h-4' />
          </button>
          <span className='text-xs sm:text-sm font-semibold text-foreground whitespace-nowrap overflow-hidden text-ellipsis'>
            {selectedCount} {selectedCount === 1 ? 'ticket' : 'tickets'} selected
          </span>
        </div>
        <div className='flex flex-wrap items-center gap-3 sm:gap-1 justify-start w-full sm:w-auto'>
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
            inputClassName='!bg-transparent placeholder:text-foreground text-foreground border-none hover:bg-background/5 text-xs sm:text-sm px-2 font-semibold'
            inputIcon={<UserIcon className='size-4 text-foreground' />}
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
            inputClassName='!bg-transparent placeholder:text-foreground text-foreground border-none hover:bg-background/5 text-xs sm:text-sm px-2 font-semibold'
            inputIcon={<CircleCheckBig className='size-4 text-foreground' />}
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
            inputClassName='!bg-transparent text-foreground placeholder:text-foreground border-none hover:bg-background/5 text-xs sm:text-sm px-2 font-semibold'
            inputIcon={<Layers className='size-4 text-foreground' />}
            showIndicator={false}
          />

          {/* Due Date Selector */}
          <div className='relative'>
            <button
              onClick={() => setActiveMenu(activeMenu === 'dueDate' ? null : 'dueDate')}
              className={cn(
                'flex items-center gap-1 sm:gap-3 px-2 sm:px-3 py-1.5 rounded-lg cursor-pointer transition-colors whitespace-nowrap',
                activeMenu === 'dueDate'
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-background/5 hover:text-foreground',
              )}
              data-track-category='Tickets'
              data-track-name='ToggleDueDateMenu'
            >
              <Calendar className='size-4 text-foreground flex-shrink-0' />
              <span className='text-xs sm:text-sm font-semibold text-foreground'>Due Date</span>
            </button>

            {activeMenu === 'dueDate' && (
              <div className='absolute bottom-full mb-4 left-0 z-50'>
                <DatePicker
                  selectedDate={null}
                  minDate={startOfToday}
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
              inputClassName='!bg-transparent text-foreground border-none placeholder:text-foreground hover:bg-background/5 text-xs sm:text-sm px-2 font-semibold'
              inputIcon={<TicketStatusIcon size={14} />}
              showIndicator={false}
            />
          )}

          {/* Tags Selector */}
          <div className='relative'>
            <button
              onClick={() => setActiveMenu(activeMenu === 'tags' ? null : 'tags')}
              className={cn(
                'flex items-center gap-1 sm:gap-3 px-2 sm:px-3 py-1.5 rounded-lg cursor-pointer transition-colors whitespace-nowrap',
                activeMenu === 'tags'
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-background/5 hover:text-foreground',
              )}
              data-track-category='Tickets'
              data-track-name='ToggleTagsMenu'
            >
              <Tag className='size-4 text-foreground flex-shrink-0' />
              <span className='text-xs sm:text-sm font-semibold text-foreground'>Labels</span>
            </button>

            {activeMenu === 'tags' && (
              <div className='absolute bottom-full mb-4 left-0 z-50'>
                <div className='bg-background rounded-lg shadow-lg border border-border p-2 min-w-[250px]'>
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
