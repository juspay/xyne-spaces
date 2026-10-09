import { ReactElement } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { cn } from '../../utils/classNames';
import { usePlatform } from '../../hooks/usePlatform';
import AppNavigator from '../../components/AppNavigator/AppNavigator';
import {
  type OrganisationsSection,
  useActiveOrganisationsGroup,
  useVisibleOrganisationsGroups,
} from './organisationsSections';

/** What an entry holds: its page's description, or each of its tabs with theirs. */
const describeSections = (sections: OrganisationsSection[]): string => {
  const [only] = sections;
  return only && sections.length === 1
    ? only.description
    : sections.map(({ label, description }) => `${label} (${description})`).join(', ');
};

const OrganisationsSidebar = (): ReactElement => {
  const { pathname } = useLocation();
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const { isMobile } = usePlatform();
  const groups = useVisibleOrganisationsGroups();
  const activeGroup = useActiveOrganisationsGroup(pathname);
  const base = `${workspaceId ? `/${workspaceId}` : ''}/organisations`;

  return (
    <div className={cn('h-full w-full flex flex-col', isMobile && 'bg-sidebar')}>
      <div className='w-full h-[52px] shrink-0'>
        <AppNavigator />
      </div>
      <div className='flex-1 min-h-0 px-3 pt-3 pb-12 sm:pb-0 flex flex-col border-t border-sidebar-border-muted'>
        <div className='hidden sm:flex pt-2 pb-3 px-2 h-10 items-center mb-2'>
          <h2 className='text-base font-semibold leading-normal text-sidebar-accent-foreground'>
            Administration
          </h2>
        </div>

        <nav
          aria-label='Organisations'
          className='flex-1 min-h-0 overflow-y-auto no-scrollbar px-0.5 pt-1 flex flex-col gap-0.5'
        >
          {groups.map(group => {
            const GroupIcon = group.icon;
            const isActive = activeGroup?.key === group.key;
            // Land on the group's first tab the user can open.
            const to = `${base}/${group.sections[0]?.key ?? ''}`;
            return (
              <Link
                key={group.key}
                to={to}
                aria-current={isActive ? 'page' : undefined}
                aria-description={describeSections(group.sections)}
                data-testid={`organisations-nav-${group.key}`}
                data-track-category='organisations'
                data-track-name={`OPEN_${group.key.toUpperCase().replace(/-/g, '_')}`}
                className={cn(
                  'flex items-center gap-3 w-full px-3 py-2 text-sm font-medium tracking-[-0.14px] rounded-[10px] border border-transparent transition-colors hover:bg-sidebar-accent',
                  isActive
                    ? 'text-sidebar-accent-foreground bg-sidebar-accent'
                    : 'text-sidebar-foreground hover:text-sidebar-accent-foreground',
                )}
              >
                <span className='size-4 flex items-center justify-center shrink-0'>
                  <GroupIcon size={16} variant={isActive ? 'Solid' : 'Stroke'} />
                </span>
                <span className='flex-1 min-w-0 text-left truncate'>{group.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
};

export default OrganisationsSidebar;
