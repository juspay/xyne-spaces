import { ReactElement } from 'react';
import { Pencil, Send } from 'lucide-react';
import { cn } from '../../../utils/classNames';

/**
 * Lazy per-desk subtree rendered under an expanded desk row. Shows the user's
 * Drafts and Sent folders as navigation entries into the per-desk views.
 */

interface DeskDraftSubtreeProps {
  activeFolder?: 'userDrafts' | 'userSent' | null;
  onOpenUserDrafts: () => void;
  onOpenUserSent: () => void;
}

export const DeskDraftSubtree = ({
  activeFolder = null,
  onOpenUserDrafts,
  onOpenUserSent,
}: DeskDraftSubtreeProps): ReactElement => {
  return (
    <div className='flex flex-col'>
      <SubItem
        icon={<Pencil size={14} />}
        label='Drafts'
        active={activeFolder === 'userDrafts'}
        onClick={onOpenUserDrafts}
        trackName='OpenDeskUserDrafts'
      />
      <SubItem
        icon={<Send size={14} />}
        label='Sent'
        active={activeFolder === 'userSent'}
        onClick={onOpenUserSent}
        trackName='OpenDeskUserSent'
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
      'flex items-center gap-3 h-9 rounded-[10px] px-3 border border-transparent cursor-pointer transition-colors text-left w-full text-sm font-medium tracking-[-0.14px]',
      active
        ? 'text-sidebar-accent-foreground bg-sidebar-accent border-sidebar-border'
        : 'text-sidebar-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent hover:border-sidebar-border',
    )}
    data-track-category='Support'
    data-track-name={trackName}
  >
    <span className='size-4 flex items-center justify-center shrink-0'>{icon}</span>
    <span className='flex-1 truncate min-w-0'>{label}</span>
  </button>
);
