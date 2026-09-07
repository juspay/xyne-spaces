import { type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import {
  ChatPlus,
  Subtask,
  ChatTyping,
  BookmarkDefault,
  SendPlaneSlant,
  ListAiGenerated,
} from '@xyne/icons';
import { type PikaIcon } from './navigationConfig';
import { QUICK_NAV_ROW_CLASS, QuickNavList } from './RailQuickNav';

const CHAT_NAV_ITEMS: {
  key: string;
  label: string;
  to: string;
  icon: PikaIcon;
  replace?: boolean;
}[] = [
  {
    key: 'new-message',
    label: 'New Message',
    to: '/chat/search?mode=dm',
    icon: ChatPlus,
    replace: true,
  },
  { key: 'threads', label: 'Threads', to: '/chat/dir/threads', icon: Subtask },
  { key: 'unreads', label: 'Unreads', to: '/chat/dir/unreads', icon: ChatTyping },
  { key: 'bookmarks', label: 'Bookmarks', to: '/chat/bookmarks', icon: BookmarkDefault },
  { key: 'drafts-sent', label: 'Drafts & Sent', to: '/chat/drafts-sent', icon: SendPlaneSlant },
  { key: 'recap', label: 'Recap', to: '/chat/dir/recap', icon: ListAiGenerated },
];

export const ChatQuickMenu = ({
  prefixWs,
  onNavigate,
  onDismiss,
}: {
  prefixWs: (path: string) => string;
  onNavigate?: (label: string) => void;
  onDismiss?: () => void;
}): ReactElement => (
  <QuickNavList heading='Chat'>
    {CHAT_NAV_ITEMS.map(item => {
      const Icon = item.icon;
      return (
        <Link
          key={item.key}
          to={prefixWs(item.to)}
          replace={item.replace ?? false}
          onClick={() => {
            onNavigate?.(item.label);
            onDismiss?.();
          }}
          className={QUICK_NAV_ROW_CLASS}
          data-track-category='App_Sidebar'
          data-track-name='Chat_Quick_Nav'
          data-track-metadata={JSON.stringify({ path: item.to, label: item.label })}
        >
          <Icon size={16} className='shrink-0' aria-hidden />
          {item.label}
        </Link>
      );
    })}
  </QuickNavList>
);
