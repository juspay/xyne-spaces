import { AtomIcon, PanelLeftCloseIcon } from 'lucide-react';
import { ReactElement } from 'react';
import { Button } from '../ui/Button/Button';

const TeamIntelligenceSidebarHeader = ({
  isSidebarOpen,
  setIsSidebarOpen,
}: {
  isSidebarOpen: boolean;
  setIsSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
}): ReactElement => {
  const handleCloseSidebar = (): void => {
    setIsSidebarOpen(false);
  };

  return (
    <div className='w-full flex justify-between items-center p-4 border-b border-sidebar-divider h-20'>
      <div className='flex items-center gap-1'>
        <div className='p-2 rounded-lg text-action-primary'>
          <AtomIcon size={24} />
        </div>
        <div>
          <h1 className='text-base font-sf-pro-expanded font-bold text-foreground'>
            Team Intelligence
          </h1>
          <p className='text-[12px] text-muted-foreground'>Insights for Juspay Teams</p>
        </div>
      </div>
      {isSidebarOpen ? (
        <Button
          variant={'ghost'}
          size={'iconLg'}
          onClick={handleCloseSidebar}
          data-track-category='team-intelligence'
          data-track-name='collapse-team-intelligence-sidebar'
          className='rounded-md transition-colors text-muted-foreground'
          aria-label='Close sidebar'
        >
          <PanelLeftCloseIcon className='size-5' />
        </Button>
      ) : null}
    </div>
  );
};

export default TeamIntelligenceSidebarHeader;
