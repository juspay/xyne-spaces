import { ReactElement, ReactNode } from 'react';
import { Navigate, Outlet, useLocation, useParams } from 'react-router-dom';
import { Panel, ResizableGroup, Separator } from '../../components/ui/Resizable/Resizable';
import AppLoader from '../../components/AppLoader/AppLoader';
import { useUserGroupsHydrated } from '../../hooks/useUserGroup';
import { useSelf } from '../../hooks/useUsers';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import OrganisationsSidebar from './OrganisationsSidebar';
import OrganisationsTabBar from './OrganisationsTabBar';
import {
  useActiveOrganisationsGroup,
  useOrganisationsAccess,
  useVisibleOrganisationsGroups,
  type OrganisationsSectionKey,
} from './organisationsSections';

// Pixels, like automationsSidebarWidth.ts, so the sidebar keeps its width when
// the surrounding container shrinks. Paired with `preserve-pixel-size`.
const SIDEBAR_DEFAULT_WIDTH = 240;
const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 340;

const useWorkspaceBase = (): string => {
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  return workspaceId ? `/${workspaceId}` : '';
};

/** `/organisations` has no content of its own: land on the first section the user can open. */
export const OrganisationsIndexRedirect = (): ReactElement => {
  const groups = useVisibleOrganisationsGroups();
  const userGroupsHydrated = useUserGroupsHydrated();
  const base = useWorkspaceBase();
  const first = groups[0]?.sections[0];

  // Owning a user group is the only way in for some users; wait until we know.
  if (!first && !userGroupsHydrated) return <AppLoader />;
  return <Navigate to={first ? first.key : base || '/'} replace />;
};

/** Guards a section with the same rule the sidebar uses to show it. */
export const OrganisationsSectionGuard = ({
  section,
  children,
}: {
  section: OrganisationsSectionKey;
  children: ReactElement;
}): ReactElement => {
  const access = useOrganisationsAccess();
  const userGroupsHydrated = useUserGroupsHydrated();
  const base = useWorkspaceBase();
  if (access[section]) return children;
  // Owning a group is enough for User Groups; don't bounce before groups load.
  if (section === 'user-groups' && !userGroupsHydrated) return <AppLoader />;
  return <Navigate to={`${base}/organisations`} replace />;
};

/**
 * Old standalone URLs (/workspace-management, /resource-access, /user-groups,
 * /roles) still arrive from bookmarks, notification links and OAuth returns.
 * Query strings are kept so OAuth callbacks (?channelEmailMailboxConnected=…) land intact.
 */
export const LegacyOrganisationsRedirect = ({
  section,
}: {
  section: OrganisationsSectionKey | ((search: URLSearchParams) => OrganisationsSectionKey);
}): ReactElement => {
  const { search } = useLocation();
  const { userGroupId } = useParams<{ userGroupId?: string }>();
  const base = useWorkspaceBase();
  const params = new URLSearchParams(search);
  const key = typeof section === 'function' ? section(params) : section;
  params.delete('tab');
  const query = params.toString();
  const suffix = userGroupId ? `/${userGroupId}/assignment-config` : '';
  return (
    <Navigate to={`${base}/organisations/${key}${suffix}${query ? `?${query}` : ''}`} replace />
  );
};

const LEGACY_WORKSPACE_TABS: Record<string, OrganisationsSectionKey> = {
  general: 'general',
  'repository-credentials': 'repository-credentials',
  invitations: 'invitations',
  guests: 'guests',
  toolbar: 'toolbar',
};

export const legacyWorkspaceTab = (params: URLSearchParams): OrganisationsSectionKey =>
  LEGACY_WORKSPACE_TABS[params.get('tab') ?? ''] ?? 'general';

/** Scrollable page body for the workspace settings sections (they bring their own headers). */
export const OrganisationsPage = ({ children }: { children: ReactNode }): ReactElement => (
  <div className='h-full overflow-y-auto'>
    <div className='max-w-5xl mx-auto w-full p-6'>{children}</div>
  </div>
);

/**
 * Sidebar with Organisations, Workspace, User Groups and Roles. Workspace
 * shows its sections as one row of tabs; the others bring their own headers.
 */
const OrganisationsModuleScreen = (): ReactElement => {
  const { pathname } = useLocation();
  const activeGroup = useActiveOrganisationsGroup(pathname);
  const tabbed = activeGroup && activeGroup.sections.length > 1 ? activeGroup : undefined;
  // Same workspace the tabs read and save (self.workspaceId), not the URL's.
  const self = useSelf();
  const [workspace] = useCachedQuery(
    queries.getWorkspaceById({ workspaceId: self?.workspaceId ?? '' }),
    { enabled: !!self?.workspaceId && !!tabbed?.showsWorkspaceName },
  );

  return (
    <div className='h-full relative overflow-hidden' data-component='OrganisationsModuleScreen'>
      <ResizableGroup
        orientation='horizontal'
        className='flex align-top h-full'
        autoSaveId='organisations-panel-layout'
      >
        <Panel
          id='sidebar'
          defaultSize={SIDEBAR_DEFAULT_WIDTH}
          minSize={SIDEBAR_MIN_WIDTH}
          maxSize={SIDEBAR_MAX_WIDTH}
          groupResizeBehavior='preserve-pixel-size'
        >
          <aside className='w-full h-full'>
            <OrganisationsSidebar />
          </aside>
        </Panel>

        <Separator className='w-[2px] transition-colors cursor-col-resize flex items-center justify-center group'>
          <div className='w-[2px] h-full bg-sidebar-divider group-hover:bg-primary group-active:bg-primary' />
        </Separator>

        <Panel defaultSize='80%' minSize='30%' id='main'>
          <main
            data-id='organisations-view'
            className='flex-1 h-full overflow-hidden relative flex flex-col rounded-2xl border border-border bg-background'
          >
            {tabbed && (
              <div className='shrink-0 border-b border-border bg-card px-6 pt-4'>
                <div className='flex min-w-0 items-center gap-2'>
                  <h1 className='text-xl font-semibold text-foreground'>{tabbed.label}</h1>
                  {tabbed.showsWorkspaceName && workspace?.name && (
                    <span
                      title={`These settings apply to ${workspace.name}`}
                      className='min-w-0 truncate rounded-full border border-border bg-muted px-2.5 py-0.5 text-sm font-medium text-foreground'
                    >
                      {workspace.name}
                    </span>
                  )}
                </div>
                {tabbed.description && (
                  <p className='mt-1 text-sm text-muted-foreground'>{tabbed.description}</p>
                )}
                <OrganisationsTabBar group={tabbed} pathname={pathname} />
              </div>
            )}
            <div className='flex-1 min-h-0 overflow-hidden relative flex flex-col'>
              <Outlet />
            </div>
          </main>
        </Panel>
      </ResizableGroup>
    </div>
  );
};

export default OrganisationsModuleScreen;
