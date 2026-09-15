import { ReactElement } from 'react';
import { Inbox, Mails, Star, Ban, LucideIcon } from 'lucide-react';
import { cn } from '../../../utils/classNames';

export type MailboxFolder = 'inbox' | 'all' | 'starred' | 'spam' | 'sent' | 'drafts';

const FOLDERS: { key: MailboxFolder; label: string; icon: LucideIcon }[] = [
  { key: 'inbox', label: 'Inbox', icon: Inbox },
  { key: 'all', label: 'All Mail', icon: Mails },
  { key: 'starred', label: 'Starred', icon: Star },
  { key: 'spam', label: 'Spam', icon: Ban },
];

const BASIC_FOLDERS: { key: MailboxFolder; label: string; icon: LucideIcon }[] = [
  { key: 'all', label: 'All items', icon: Mails },
];

interface DeskMailboxSidebarProps {
  /** 'email' shows the full mailbox set; 'basic' shows only All items. */
  variant?: 'email' | 'basic';
  activeFolder: MailboxFolder | null;
  onSelectFolder: (folder: MailboxFolder, label: string) => void;
}

/**
 * Gmail-style mailbox folders for the desk sidebar (Inbox · All Mail · Starred ·
 * Spam). Per-user per-desk: each agent sees their own filing of the shared
 * mail. The folders are fixed (not user-created), unlike the Labels section.
 * Non-email desks (Slack / App / Call / Social) use variant='basic' for a
 * single All items entry.
 */
export const DeskMailboxSidebar = ({
  variant = 'email',
  activeFolder,
  onSelectFolder,
}: DeskMailboxSidebarProps): ReactElement => {
  const folders = variant === 'basic' ? BASIC_FOLDERS : FOLDERS;
  return (
    <div>
      <div>
        {folders.map(({ key, label, icon: Icon }) => {
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
                  : 'text-sidebar-foreground hover:text-sidebar-accent-foreground hover:bg-sidebar-accent',
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
