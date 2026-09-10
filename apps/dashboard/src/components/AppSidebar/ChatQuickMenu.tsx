import { type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useRadarEnabled } from '../../hooks/radarCacConfig';
import { chatNavItems } from './navigationConfig';
import { QUICK_NAV_ROW_CLASS, QuickNavList } from './RailQuickNav';

export const ChatQuickMenu = ({
  prefixWs,
  onNavigate,
  onDismiss,
}: {
  prefixWs: (path: string) => string;
  onNavigate?: (label: string) => void;
  onDismiss?: () => void;
}): ReactElement => {
  const auth = useAuth();
  const radarEnabled = useRadarEnabled(auth.user?.email);

  return (
    <QuickNavList heading='Chat'>
      {chatNavItems(radarEnabled).map(item => {
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
};
