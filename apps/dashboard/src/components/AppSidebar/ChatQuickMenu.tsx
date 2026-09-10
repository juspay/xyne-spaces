import { createElement, useMemo, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import {
  ChatPlus,
  Subtask,
  ChatTyping,
  BookmarkDefault,
  SendPlaneSlant,
  ListAiGenerated,
} from '@xyne/icons';
import { Radar as RadarIcon } from 'lucide-react';
import { type PikaIconProps } from '@xyne/icons';
import { type PikaIcon } from './navigationConfig';
import { useAuth } from '../../hooks/useAuth';
import { useRadarEnabled } from '../../hooks/radarCacConfig';
import { QUICK_NAV_ROW_CLASS, QuickNavList } from './RailQuickNav';

// @xyne/icons has no radar glyph, so this borrows lucide's the way
// AudioWaveIcon does in navigationConfig — `variant` is dropped rather than
// passed through to the <svg>.
const RadarNavIcon = ({ variant: _variant, ...props }: PikaIconProps): ReactElement =>
  createElement(RadarIcon, props);

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
  { key: 'radar', label: 'Radar', to: '/chat/dir/radar', icon: RadarNavIcon },
];

/**
 * The rows this user may actually open. Radar's route is registered
 * unconditionally (the rollout gate lives inside RadarPanel), so the CAC check
 * has to drop the row here or people outside the rollout get a dead link.
 */
const useChatNavItems = (): typeof CHAT_NAV_ITEMS => {
  const radarEnabled = useRadarEnabled(useAuth().user?.email);
  return useMemo(
    () => CHAT_NAV_ITEMS.filter(item => item.key !== 'radar' || radarEnabled),
    [radarEnabled],
  );
};

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
    {useChatNavItems().map(item => {
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
          data-track-kind='passive'
          data-track-metadata={JSON.stringify({ path: item.to, label: item.label })}
        >
          <Icon size={16} className='shrink-0' aria-hidden />
          {item.label}
        </Link>
      );
    })}
  </QuickNavList>
);
