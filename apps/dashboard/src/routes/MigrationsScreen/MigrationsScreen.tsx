import { ReactElement } from 'react';
import { NavLink, Navigate, Outlet } from 'react-router-dom';
import { SwapArrowHorizontal, ChatChatting } from '@xyne/icons';
import { cn } from '../../utils/classNames';
import { useHasResourceAccess } from '../../hooks/usePermissions';
import type { PikaIcon } from '../../components/AppSidebar/navigationConfig';

interface MigrationTabDef {
  key: 'jira' | 'whatsapp' | 'slack';
  label: string;
  icon: PikaIcon;
  /** Jira and WhatsApp migration both sit behind TICKET-MIGRATION ADMIN, same as their
   *  standalone routes did before being folded into this hub. Slack has no resource gate. */
  requiresTicketMigration: boolean;
}

const TABS: MigrationTabDef[] = [
  {
    key: 'jira',
    label: 'Jira Migration',
    icon: SwapArrowHorizontal,
    requiresTicketMigration: true,
  },
  {
    key: 'whatsapp',
    label: 'WhatsApp Migration',
    icon: ChatChatting,
    requiresTicketMigration: true,
  },
  {
    key: 'slack',
    label: 'Slack Migration',
    icon: SwapArrowHorizontal,
    requiresTicketMigration: false,
  },
];

/** `/migrations` has no content of its own — land on the first tab the user can actually open. */
export const MigrationsIndexRedirect = (): ReactElement => {
  const hasTicketMigration = useHasResourceAccess('TICKET-MIGRATION');
  return <Navigate to={hasTicketMigration ? 'jira' : 'slack'} replace />;
};

const MigrationsScreen = (): ReactElement => {
  const hasTicketMigration = useHasResourceAccess('TICKET-MIGRATION');
  const visibleTabs = TABS.filter(tab => !tab.requiresTicketMigration || hasTicketMigration);

  return (
    <div className='h-full w-full flex flex-col'>
      <div className='shrink-0 border-b border-border bg-card px-6 py-4 md:rounded-t-2xl'>
        <h1 className='text-xl font-semibold text-foreground'>Migrations</h1>
        <p className='mt-1 text-sm text-muted-foreground'>
          Bring data in from the other tools your team already uses.
        </p>
        <div className='mt-4 flex gap-0.5'>
          {visibleTabs.map(tab => (
            <NavLink
              key={tab.key}
              to={tab.key}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px',
                  'text-muted-foreground border-transparent hover:text-foreground hover:border-muted',
                  isActive && 'text-primary border-primary',
                )
              }
              data-track-category='migrations'
              data-track-name={`OPEN_${tab.key.toUpperCase()}_MIGRATION_TAB`}
            >
              <tab.icon size={16} />
              {tab.label}
            </NavLink>
          ))}
        </div>
      </div>

      <div className='flex-1 min-h-0'>
        <Outlet />
      </div>
    </div>
  );
};

export default MigrationsScreen;
