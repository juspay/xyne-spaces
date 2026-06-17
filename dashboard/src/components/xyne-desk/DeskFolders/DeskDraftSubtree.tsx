import { ReactElement } from 'react';
import { Pencil } from 'lucide-react';
import { cn } from '../../../utils/classNames';

/**
 * Lazy per-desk subtree rendered under an expanded desk row. Shows the user's
 * Drafts folder as a navigation entry into the per-desk drafts view.
 */

interface DeskDraftSubtreeProps {
  activeFolder?: 'userDrafts' | null;
  onOpenUserDrafts: () => void;
}

export const DeskDraftSubtree = ({
  activeFolder = null,
  onOpenUserDrafts,
}: DeskDraftSubtreeProps): ReactElement => {
  return (
    <div className='mt-0.5 ml-3 pl-2 border-l border-border/60 flex flex-col gap-0.5'>
      <SubItem
        icon={<Pencil size={12} className='text-muted-foreground' />}
        label='Drafts'
        active={activeFolder === 'userDrafts'}
        onClick={onOpenUserDrafts}
        trackName='OpenDeskUserDrafts'
      />
    </div>
  );
};

interface SubItemProps {
  icon: ReactElement;
  label: string;
  active: boolean;
  onClick: () => void;
  trackName: string;
}

const SubItem = ({ icon, label, active, onClick, trackName }: SubItemProps): ReactElement => (
  <button
    type='button'
    onClick={onClick}
    className={cn(
      'flex items-center gap-1.5 h-7 rounded-md px-1.5 cursor-pointer transition-colors text-left w-full',
      active
        ? 'text-sidebar-primary-foreground font-medium bg-sidebar-item-active'
        : 'text-sidebar-secondary-foreground hover:text-sidebar-primary-foreground hover:bg-sidebar-item-hover',
    )}
    data-track-category='Support'
    data-track-name={trackName}
  >
    <span className='flex items-center flex-shrink-0'>{icon}</span>
    <span className='text-[13px] flex-1 truncate min-w-0'>{label}</span>
  </button>
);
