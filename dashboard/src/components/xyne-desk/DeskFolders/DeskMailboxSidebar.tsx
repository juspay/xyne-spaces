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
      <div>
        {FOLDERS.map(({ key, label, icon: Icon }) => {
          const active = activeFolder === key;
          return (
            <button
              key={key}
              type='button'
              onClick={() => onSelectFolder(key, label)}
              className={cn(
                'flex items-center gap-3 w-full h-9 rounded-[10px] px-3 border border-transparent text-left text-sm font-medium tracking-[-0.14px] transition-colors',
                active
                  ? 'text-sidebar-accent-foreground bg-sidebar-accent border-sidebar-border'
                  : 'text-sidebar-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent hover:border-sidebar-border',
              )}
              data-track-category='Support'
              data-track-name='SelectMailboxFolder'
            >
              <span className='size-4 flex items-center justify-center shrink-0'>
                <Icon size={14} />
              </span>
              <span className='flex-1 truncate min-w-0'>{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
