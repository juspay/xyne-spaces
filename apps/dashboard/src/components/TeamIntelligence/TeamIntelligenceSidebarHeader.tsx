import { AtomIcon, PanelLeftCloseIcon } from 'lucide-react';
import { ReactElement } from 'react';
import { Button } from '../ui/Button/Button';

const TeamIntelligenceSidebarHeader = ({
  isSidebarOpen,
  setIsSidebarOpen,
  showCollapseButton = true,
}: {
  isSidebarOpen: boolean;
  setIsSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  showCollapseButton?: boolean;
}): ReactElement => {
  const handleCloseSidebar = (): void => {
    setIsSidebarOpen(false);
  };

  return (
    <div className='w-full flex justify-between items-center p-4 h-20'>
      <div className='flex items-center gap-1'>
        <div className='p-2 rounded-lg text-action-primary'>
          <AtomIcon size={24} />
        </div>
        <div>
          <h1 className='text-base font-sf-pro-expanded font-bold text-foreground line-clamp-1'>
            Team Intelligence
          </h1>
          <p className='text-[12px] text-muted-foreground line-clamp-1'>
            Founder and manager briefs
          </p>
        </div>
      </div>
      {isSidebarOpen && showCollapseButton ? (
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
