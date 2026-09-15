import { type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { PencilEditBox } from '@xyne/icons';
import { useClawAdminAccessQuery } from '@/hooks/useClawAdminAccess';
import { useClawOrgManageAccess } from '@/hooks/useClawOrganization';
import { useAuth } from '@/hooks/useAuth';
import { NAV_ITEMS } from '../AIScreen/AISidebar';
import { QUICK_NAV_ROW_CLASS, QuickNavList } from './RailQuickNav';

export const XyneAIQuickMenu = ({
  prefixWs,
  onNavigate,
  onDismiss,
}: {
  prefixWs: (path: string) => string;
  onNavigate?: (label: string) => void;
  onDismiss?: () => void;
}): ReactElement => {
  const { t } = useTranslation('common');
  const { user } = useAuth();
  const { isAdmin } = useClawAdminAccessQuery(user?.id);
  const { canManage: canManageOrg } = useClawOrgManageAccess();

  const items = NAV_ITEMS.filter(
    item => (!item.adminOnly || isAdmin) && (!item.orgManagerOnly || canManageOrg),
  );

  const handleClick = (label: string): void => {
    onNavigate?.(label);
    onDismiss?.();
  };

  return (
    <QuickNavList heading='Xyne AI'>
      <Link
        to={prefixWs('/ai/chat/new')}
        onClick={() => handleClick('new-chat')}
        className={QUICK_NAV_ROW_CLASS}
        data-track-category='App_Sidebar'
        data-track-name='XyneAI_Quick_New_Chat'
      >
        <PencilEditBox size={16} className='shrink-0' aria-hidden />
        {t('aiScreen.sidebar.newChatTooltip')}
      </Link>

      {items.map(item => {
        const Icon = item.icon;
        return (
          <Link
            key={item.key}
            to={prefixWs(item.to)}
            onClick={() => handleClick(item.key)}
            className={QUICK_NAV_ROW_CLASS}
            data-track-category='App_Sidebar'
            data-track-name='XyneAI_Quick_Nav'
            data-track-metadata={JSON.stringify({ path: item.to, label: item.key })}
          >
            <Icon size={16} className='shrink-0' aria-hidden />
            {t(item.labelKey)}
          </Link>
        );
      })}
    </QuickNavList>
  );
};
