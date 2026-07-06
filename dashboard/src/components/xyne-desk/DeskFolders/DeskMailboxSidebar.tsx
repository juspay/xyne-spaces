import { ReactElement } from 'react';
import { Inbox, Mails, Star, Ban, LucideIcon } from 'lucide-react';
import { cn } from '../../../utils/classNames';

export type MailboxFolder = 'inbox' | 'all' | 'starred' | 'spam';

const FOLDERS: { key: MailboxFolder; label: string; icon: LucideIcon }[] = [
  { key: 'inbox', label: 'Inbox', icon: Inbox },
  { key: 'all', label: 'All Mail', icon: Mails },
  { key: 'starred', label: 'Starred', icon: Star },
  { key: 'spam', label: 'Spam', icon: Ban },
];

interface DeskMailboxSidebarProps {
  activeFolder: MailboxFolder | null;
  onSelectFolder: (folder: MailboxFolder, label: string) => void;
}

/**
 * Gmail-style mailbox folders for the desk sidebar (Inbox · All Mail · Starred ·
 * Spam). Per-user per-desk: each agent sees their own filing of the shared
 * mail. The folders are fixed (not user-created), unlike the Labels section.
 */
export const DeskMailboxSidebar = ({
  activeFolder,
  onSelectFolder,
}: DeskMailboxSidebarProps): ReactElement => {
  return (
    <div>
      <div className='space-y-0.5'>
        {FOLDERS.map(({ key, label, icon: Icon }) => {
          const active = activeFolder === key;
          return (
            <button
              key={key}
              type='button'
              onClick={() => onSelectFolder(key, label)}
              className={cn(
                'flex items-center gap-1.5 w-full h-7 rounded-md px-1.5 text-left transition-colors',
                active
                  ? 'text-sidebar-primary-foreground font-medium bg-sidebar-item-active'
                  : 'text-sidebar-secondary-foreground hover:text-sidebar-primary-foreground hover:bg-sidebar-item-hover',
              )}
              data-track-category='Support'
              data-track-name='SelectMailboxFolder'
            >
              <Icon size={13} className='shrink-0' />
              <span className='text-[13px] flex-1 truncate min-w-0'>{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
