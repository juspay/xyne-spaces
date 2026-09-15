import { ReactElement, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SearchDefault as Search, SidebarLeftClose, PlusDefault as Plus } from '@xyne/icons';
import { ProjectSidebarProps } from './ProjectSidebar.types';
import ViewsSidebarSection from './ViewsSidebarSection';
import { usePlatform } from '../../../hooks/usePlatform';
import { cn } from '../../../utils/classNames';
import AppNavigator from '../../AppNavigator/AppNavigator';

const ProjectSidebar = ({ onToggleCollapse }: ProjectSidebarProps): ReactElement => {
  const navigate = useNavigate();
  const { isMobile } = usePlatform();

  const [searchQuery, setSearchQuery] = useState('');

  return (
    <div className={cn('h-full w-full flex flex-col', isMobile && 'bg-sidebar')}>
      <div className='w-full h-[52px] shrink-0'>
        <AppNavigator />
      </div>
      <div className='flex-1 min-h-0 px-3 pt-3 pb-12 sm:pb-0 flex flex-col border-t border-sidebar-border-muted'>
        {/* Header */}
        <div className='hidden sm:flex pt-2 pb-3 px-2 h-10 items-center justify-between'>
          <h2 className='text-lg font-semibold leading-none tracking-[-0.2px] text-sidebar-accent-foreground'>
            Ticket views
          </h2>
          <div className='flex items-center gap-2'>
            {onToggleCollapse && (
              <button
                type='button'
                onClick={onToggleCollapse}
                aria-label='Collapse sidebar'
                aria-controls='projects-sidebar-region'
                title='Collapse sidebar'
                className='grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                data-track-category='Projects'
                data-track-name='ToggleProjectsSidebar'
              >
                <SidebarLeftClose className='size-4' />
              </button>
            )}
            <button
              type='button'
              onClick={() => void navigate('/projects/views/new')}
              aria-label='Create new view'
              title='Create new view'
              className='grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
              data-track-category='Projects'
              data-track-name='CreateNewView'
            >
              <Plus className='size-4' />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className='px-0.5 pb-3 shrink-0'>
          <div className='flex h-8 items-center gap-2 rounded-lg bg-muted px-2.5'>
            <Search className='size-3.5 shrink-0 text-muted-foreground' />
            <input
              type='text'
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder='Search views...'
              aria-label='Search views'
              className='min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground'
              data-track-event='blur'
              data-track-category='Projects'
              data-track-name='SearchViewsInput'
            />
          </div>
        </div>

        {/* Scrollable Content */}
        <div className='flex-1 min-h-0 overflow-y-auto no-scrollbar px-0.5 pt-1'>
          <ViewsSidebarSection searchQuery={searchQuery} />
        </div>
      </div>
    </div>
  );
};

export default ProjectSidebar;
