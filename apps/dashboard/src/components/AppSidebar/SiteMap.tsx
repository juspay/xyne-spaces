import { ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import { usePath } from '../../hooks/usePath';
import { useVisibleNavigationItems } from '../../hooks/useVisibleNavigationItems';
import { chatNavItems, type NavigationItem } from './navigationConfig';
import { useAuth } from '../../hooks/useAuth';
import { useRadarEnabled } from '../../hooks/radarCacConfig';
import { useVisibleOrganisationsGroups } from '../../routes/OrganisationsModule/organisationsSections';
import { useVisibleAINavItems } from '../AIScreen/AISidebar';

interface Page {
  path: string;
  label: string;
  description: string;
}

/**
 * Every page the user can open, from the navigation configs, as one site map landmark: a second
 * way to reach any page (WCAG 2.4.5) for screen reader users, and for the assistant, which reads
 * it like any other navigation. Hidden from sight and out of the tab order.
 */
export const SiteMap = (): ReactElement => {
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const here = usePath();
  const items = useVisibleNavigationItems();
  const adminGroups = useVisibleOrganisationsGroups();
  const aiPages = useVisibleAINavItems();
  const auth = useAuth();
  const inboxPages = chatNavItems(useRadarEnabled(auth.user?.email));

  /** The pages inside a sidebar entry, from its own sidebar's config. */
  const childrenOf = ({ path, label }: NavigationItem): Page[] => {
    const within = (description: string): string => `${description}, in ${label}`;
    if (path === '/organisations') {
      return adminGroups.flatMap(({ sections }) =>
        sections.map(section => ({
          path: `/organisations/${section.key}`,
          label: section.label,
          description: within(section.description),
        })),
      );
    }
    if (path === '/ai') {
      return aiPages.map(item => ({
        path: item.to,
        label: item.label,
        description: within(item.description),
      }));
    }
    if (path === '/chat/dir') {
      return inboxPages.flatMap(item =>
        item.description
          ? [{ path: item.to, label: item.label, description: within(item.description) }]
          : [],
      );
    }
    return [];
  };
  const pages = items.flatMap(item => [item, ...childrenOf(item)]);

  return (
    <nav aria-label='Site map' className='sr-only'>
      <ul>
        {pages.map(({ path, label, description }) => (
          <li key={path}>
            <Link
              to={workspaceId ? `/${workspaceId}${path}` : path}
              tabIndex={-1}
              aria-description={description}
              aria-current={here === path || here.startsWith(`${path}/`) ? 'page' : undefined}
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
};
