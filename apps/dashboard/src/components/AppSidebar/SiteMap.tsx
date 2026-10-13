import { ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import { usePath } from '../../hooks/usePath';
import { useVisibleNavigationItems } from '../../hooks/useVisibleNavigationItems';
import { chatNavItems, type NavigationItem } from './navigationConfig';
import { useAuth } from '../../hooks/useAuth';
import { useRadarEnabled } from '../../hooks/radarCacConfig';
import { useVisibleOrganisationsGroups } from '../../routes/OrganisationsModule/organisationsSections';
import { useDisabledToolbarPaths } from '../../hooks/useDisabledToolbarPaths';
import { useVisibleAINavItems } from '../AIScreen/AISidebar';

interface Page {
  path: string;
  label: string;
  description: string;
}

const within = (description: string, parentLabel: string): string =>
  `${description}, in ${parentLabel}`;

/** The one page the user is on: an exact match, else the deepest listed section containing it. */
const currentPath = (here: string, paths: string[]): string | undefined =>
  paths
    .filter(path => here === path || here.startsWith(`${path}/`))
    .reduce<
      string | undefined
    >((best, path) => (best === undefined || path.length > best.length ? path : best), undefined);

const PageLinks = ({ pages }: { pages: Page[] }): ReactElement => {
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const current = currentPath(
    usePath(),
    pages.map(page => page.path),
  );

  return (
    <>
      {pages.map(({ path, label, description }) => (
        <li key={path}>
          <Link
            to={workspaceId ? `/${workspaceId}${path}` : path}
            tabIndex={-1}
            aria-description={description}
            aria-current={path === current ? 'page' : undefined}
          >
            {label}
          </Link>
        </li>
      ))}
    </>
  );
};

/** Split out so the admin and daily-brief lookups behind the AI pages only run when Xyne AI is listed. */
const AIPageLinks = ({ item }: { item: NavigationItem }): ReactElement => {
  const aiPages = useVisibleAINavItems();
  return (
    <PageLinks
      pages={[
        item,
        ...aiPages.map(page => ({
          path: page.to,
          label: page.label,
          description: within(page.description, item.label),
        })),
      ]}
    />
  );
};

/** A site map landmark: a second way to reach any page (WCAG 2.4.5), hidden from sight and the tab order. */
export const SiteMap = (): ReactElement => {
  const items = useVisibleNavigationItems();
  const adminGroups = useVisibleOrganisationsGroups();
  const auth = useAuth();
  const disabled = useDisabledToolbarPaths();
  // Every inbox page the workspace allows, whatever the user keeps in their own bar. Pages only:
  // "New message" (replace) starts an action rather than opening somewhere.
  const inboxPages = chatNavItems(useRadarEnabled(auth.user?.email)).filter(
    item => !item.replace && !(item.toolbarPath && disabled.has(item.toolbarPath)),
  );

  const childrenOf = ({ path, label }: NavigationItem): Page[] => {
    if (path === '/organisations') {
      return adminGroups.flatMap(({ sections }) =>
        sections.map(section => ({
          path: `/organisations/${section.key}`,
          label: section.fullLabel ?? section.label,
          description: within(section.description, label),
        })),
      );
    }
    if (path === '/chat/dir') {
      return inboxPages.flatMap(item =>
        item.description
          ? [{ path: item.to, label: item.label, description: within(item.description, label) }]
          : [],
      );
    }
    return [];
  };

  return (
    <nav aria-label='Site map' className='sr-only'>
      <ul>
        {items.map(item =>
          item.path === '/ai' ? (
            <AIPageLinks key={item.path} item={item} />
          ) : (
            <PageLinks key={item.path} pages={[item, ...childrenOf(item)]} />
          ),
        )}
      </ul>
    </nav>
  );
};
