import { Fragment, ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import { cn } from '../../utils/classNames';
import type { OrganisationsSectionGroup } from './organisationsSections';

/** One row of tabs for a sidebar entry that holds several sections. */
const OrganisationsTabBar = ({
  group,
  pathname,
}: {
  group: OrganisationsSectionGroup;
  pathname: string;
}): ReactElement => {
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const base = `${workspaceId ? `/${workspaceId}` : ''}/organisations`;

  return (
    <nav
      aria-label={`${group.label} sections`}
      className='mt-4 flex items-center gap-0.5 overflow-x-auto no-scrollbar'
    >
      {group.sections.map(({ key, label, icon: SectionIcon, dividerBefore }, index) => {
        const to = `${base}/${key}`;
        const isActive = pathname === to || pathname.startsWith(`${to}/`);
        return (
          <Fragment key={key}>
            {dividerBefore && index > 0 && (
              <span aria-hidden className='mx-2 h-5 w-px shrink-0 bg-border' />
            )}
            <Link
              to={to}
              aria-current={isActive ? 'page' : undefined}
              data-testid={`organisations-tab-${key}`}
              data-track-category='organisations'
              data-track-name={`OPEN_${key.toUpperCase().replace(/-/g, '_')}`}
              className={cn(
                'flex shrink-0 items-center gap-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px',
                isActive
                  ? 'text-primary border-primary'
                  : 'text-muted-foreground border-transparent hover:text-foreground hover:border-muted',
              )}
            >
              <SectionIcon size={16} variant={isActive ? 'Solid' : 'Stroke'} />
              {label}
            </Link>
          </Fragment>
        );
      })}
    </nav>
  );
};

export default OrganisationsTabBar;
