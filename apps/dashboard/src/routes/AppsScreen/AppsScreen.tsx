import { ReactElement, useState, useRef, useEffect, useMemo, type ComponentProps } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button/Button';
import { AppsTable } from '../../components/Apps/AppsTable/AppsTable';
import { Dialog } from '../../components/ui/Dialog/Dialog';
import CreateAppForm from '../../components/Apps/CreateAppForm/CreateAppForm';
import { queries } from '../../zero/queries';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { usePermissions } from '../../hooks/usePermissions';
import { useAuth } from '../../hooks/useAuth';
import { useZero } from '../../hooks/useZero';
import { useVespaAppSearch } from '../../hooks/useVespaAppSearch';
import { useMutation } from '@tanstack/react-query';
import { appsService } from '../../services/Apps/appsService';
import { mutators } from '../../zero/mutators';
import { toast } from 'sonner';
import { Plus, AppWindow, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import Input from '../../components/ui/Input/Input';
import { AccessType } from '@xyne/shared';

const ITEMS_PER_PAGE = 15;

type AppsView = 'installed' | 'org' | 'marketplace';

const VIEW_TABS: { value: AppsView; label: string }[] = [
  { value: 'org', label: 'Org Apps' },
  { value: 'installed', label: 'Installed' },
  { value: 'marketplace', label: 'Marketplace' },
];

const isAppsView = (v: string | null): v is AppsView =>
  v === 'installed' || v === 'org' || v === 'marketplace';

const AppsScreen = (): ReactElement => {
  const permissions = usePermissions();
  const { user } = useAuth();
  const zero = useZero();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentPage = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const view: AppsView = isAppsView(searchParams.get('view'))
    ? (searchParams.get('view') as AppsView)
    : 'org';
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Per-view cursor history so paging in one tab doesn't corrupt another.
  const cursorKey = `appsCursorHistory_${view}`;
  const cursorHistoryRef = useRef<{ createdAt: number; id: string }[]>([]);

  useEffect(() => {
    const stored = sessionStorage.getItem(cursorKey);
    cursorHistoryRef.current = stored
      ? (JSON.parse(stored) as { createdAt: number; id: string }[])
      : [];
  }, [cursorKey]);

  const startCursor = useMemo(() => {
    if (currentPage <= 1) return null;
    const stored = sessionStorage.getItem(cursorKey);
    if (!stored) return null;
    try {
      const history = JSON.parse(stored) as { createdAt: number; id: string }[];
      return history[currentPage - 2] ?? null;
    } catch {
      return null;
    }
  }, [currentPage, cursorKey]);

  // Resolve the caller's org for the Org view. orgId arrives async, so the Org query is
  // gated on `!!orgId` below to avoid ever running with an empty orgId.
  const [workspace] = useCachedQuery(
    queries.getWorkspaceById({ workspaceId: user?.workspaceId ?? '' }),
  );
  const orgId = workspace?.orgId ?? '';

  // Only the active tab's query subscribes — `enabled` short-circuits the other two so we
  // don't hold three live Zero subscriptions at once. Switching tabs (re)subscribes the
  // newly-active query, giving it a fresh hydration each time it's opened.
  const [installedRows] = useCachedQuery(
    queries.getWorkspaceInstalledApps({ limit: ITEMS_PER_PAGE, start: startCursor }),
    { enabled: view === 'installed' },
  );
  const [orgAppRows] = useCachedQuery(
    queries.getOrgApps({ limit: ITEMS_PER_PAGE, start: startCursor, orgId }),
    { enabled: view === 'org' && !!orgId },
  );
  const [marketplaceRows] = useCachedQuery(
    queries.getMarketplaceApps({ limit: ITEMS_PER_PAGE, start: startCursor }),
    { enabled: view === 'marketplace' },
  );

  // Org/Marketplace views need to know what's installed in MY workspace (for Installed status
  // and the version-gated Update button). Fetch my installs unpaginated, only on those views.
  const [myInstalls] = useCachedQuery(
    queries.getWorkspaceInstalledApps({ limit: 1000, start: null }),
    { enabled: view === 'org' || view === 'marketplace' },
  );
  const installedVersionByAppId = useMemo(() => {
    const map: Record<string, number> = {};
    for (const row of myInstalls ?? []) {
      if (row.appId) map[row.appId] = row.version ?? 1;
    }
    return map;
  }, [myInstalls]);

  // Raw rows of the active view drive pagination (their createdAt/id are the cursor).
  const rawRows =
    view === 'installed' ? installedRows : view === 'org' ? orgAppRows : marketplaceRows;

  // Normalize each view to the row shape AppsTable expects. Installed rows are installed_apps with
  // a related `app`; surface the app and attach its install so status/webhook/botUserId resolve.
  const apps = useMemo(() => {
    if (view === 'installed') {
      return (installedRows ?? [])
        .filter(row => row.app)
        .map(row => ({ ...(row.app as Record<string, unknown>), installations: [row] }));
    }
    if (view === 'org') return orgAppRows ?? [];
    return marketplaceRows ?? [];
  }, [view, installedRows, orgAppRows, marketplaceRows]);

  // Resolve origin org names for "Created by" attribution. The creator's user isn't synced for
  // cross-workspace/cross-org apps, so we fall back to the app's org name (fetched via REST since
  // other orgs aren't readable client-side). Each org id is requested at most once.
  const appOrgIds = useMemo(
    () =>
      Array.from(
        new Set(
          (apps as Array<Record<string, unknown>>)
            .map(a => a['orgId'])
            .filter((x): x is string => typeof x === 'string' && x.length > 0),
        ),
      ),
    [apps],
  );
  const [orgNamesById, setOrgNamesById] = useState<Record<string, string>>({});
  const requestedOrgIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const missing = appOrgIds.filter(id => !requestedOrgIdsRef.current.has(id));
    if (missing.length === 0) return;
    missing.forEach(id => requestedOrgIdsRef.current.add(id));
    void appsService
      .getOrgNames(missing)
      .then(map => setOrgNamesById(prev => ({ ...prev, ...map })))
      .catch(() => {});
  }, [appOrgIds]);

  // Full-corpus search via Vespa (name, description, creator — hybrid lexical+semantic).
  // Empty query → falls back to the paginated Zero list below.
  const isSearchMode = searchQuery.trim().length > 0;
  const {
    hits,
    total: searchTotal,
    hasMore,
    loadMore,
    isSearching,
    reload: reloadSearch,
  } = useVespaAppSearch(searchQuery, view);

  // Render search results from the Vespa response. Install state + owning-org name
  // are resolved server-side, scoped to the caller's workspace (see searchApps) — so
  // no bulk client fetch of installed_apps. orgId/scope/version drive the status,
  // org-name attribution, and the version-gated Update button, exactly like the Zero
  // rows. The signing secret is never here — it's fetched on demand.
  const filteredApps = useMemo(() => {
    if (!isSearchMode) return apps ?? [];
    return hits.map(h => ({
      id: h.docId,
      name: h.name,
      description: h.description,
      createdBy: h.createdBy,
      orgId: h.orgId,
      scope: h.scope,
      version: h.version,
      webhookUrl: h.webhookUrl ?? undefined,
      createdAt: h.createdAt,
      updatedAt: h.createdAt,
      // Installed view: the row IS the install (status/webhook/botUser/version read here).
      // Org/Marketplace: install state comes from installedVersionByAppId below instead.
      installations: h.installed
        ? [
            {
              id: h.installedAppId ?? '',
              appId: h.docId,
              userId: h.botUserId ?? '',
              webhookUrl: h.webhookUrl ?? undefined,
              signingSecret: '',
              version: h.installedVersion ?? undefined,
              createdAt: 0,
              updatedAt: 0,
            },
          ]
        : [],
    }));
  }, [isSearchMode, apps, hits]);

  // Org/Marketplace status + Update-gating look install state up by appId. In search
  // mode that comes from the hits (server-resolved); otherwise from the Zero query.
  const effectiveInstalledVersionByAppId = useMemo(() => {
    if (!isSearchMode) return installedVersionByAppId;
    const map: Record<string, number> = {};
    for (const h of hits) {
      if (h.installed && h.installedVersion !== null) map[h.docId] = h.installedVersion;
    }
    return map;
  }, [isSearchMode, hits, installedVersionByAppId]);

  // "Created by" org-name attribution. Search hits already carry orgName (no extra
  // getOrgNames round-trip); the non-search path uses the REST-resolved map above.
  const effectiveOrgNamesById = useMemo(() => {
    if (!isSearchMode) return orgNamesById;
    const map: Record<string, string> = { ...orgNamesById };
    for (const h of hits) {
      if (h.orgId && h.orgName) map[h.orgId] = h.orgName;
    }
    return map;
  }, [isSearchMode, hits, orgNamesById]);

  const hasNextPage = (rawRows?.length ?? 0) === ITEMS_PER_PAGE;
  const hasPreviousPage = currentPage > 1;

  const handleSelectView = (next: AppsView): void => {
    if (next === view) return;
    setSearchParams(prev => {
      prev.set('view', next);
      prev.set('page', '1');
      return prev;
    });
  };

  const handleNextPage = () => {
    if (hasNextPage && rawRows && rawRows.length > 0) {
      const lastRow = rawRows[rawRows.length - 1];
      if (lastRow) {
        cursorHistoryRef.current[currentPage - 1] = {
          createdAt: lastRow.createdAt,
          id: lastRow.id,
        };
        sessionStorage.setItem(cursorKey, JSON.stringify(cursorHistoryRef.current));
      }
      setSearchParams(prev => {
        prev.set('page', String(currentPage + 1));
        return prev;
      });
    }
  };

  const handlePreviousPage = () => {
    if (hasPreviousPage) {
      setSearchParams(prev => {
        prev.set('page', String(currentPage - 1));
        return prev;
      });
    }
  };

  const appAccessLevel = permissions
    .filter(p => p.resourceName === 'XYNE-APPS')
    .map(p => p.accessType)[0];
  const canCreateApp = appAccessLevel === AccessType.WRITE || appAccessLevel === AccessType.ADMIN;
  const isXyneAppsAdmin = appAccessLevel === AccessType.ADMIN;

  // Install / Update both hit the install endpoint (Update = re-install latest snapshot).
  const installAppMutation = useMutation({
    mutationFn: async (appId: string) => appsService.installApp(appId),
    onSuccess: () => {
      toast.success('App installed successfully');
      // Refresh search results so the row flips to "Installed" (install state is
      // resolved server-side per page, so re-fetch the current search).
      reloadSearch();
    },
    onError: (error: Error) => toast.error('Failed to install app', { description: error.message }),
  });

  const [isPromoting, setIsPromoting] = useState(false);
  const promoteAppMutation = useMutation({
    mutationFn: async (appId: string) => appsService.promoteApp(appId),
    onSuccess: () => toast.success('App promoted to the marketplace'),
    onError: (error: Error) => toast.error('Failed to promote app', { description: error.message }),
  });

  const handleUpdateApp = async (
    appId: string,
    data: { name?: string; description?: string; webhookUrl?: string },
  ): Promise<void> => {
    const mutatorPayload = {
      appId,
      ...(data.name !== undefined && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.webhookUrl !== undefined && { webhookUrl: data.webhookUrl }),
      timestamp: Date.now(),
    };
    const result = zero.mutate(mutators.apps.update(mutatorPayload));
    const res = await result.server;
    if (res.type === 'error') {
      toast.error('Failed to update app', {
        description: res.error.message || 'Failed to update app',
        duration: 5000,
      });
      throw new Error(res.error.message || 'Failed to update app');
    }
  };

  // Installed screen: edit the caller's install (webhook URL) via the workspace-scoped REST path.
  const handleUpdateInstall = async (
    installedAppId: string,
    data: { webhookUrl?: string },
  ): Promise<void> => {
    try {
      await appsService.updateInstalledApp(installedAppId, data);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to update installed app';
      toast.error('Failed to update installed app', { description: message, duration: 5000 });
      throw e;
    }
  };

  const handleInstallApp = (appId: string): void => {
    installAppMutation.mutate(appId);
  };

  const handlePromoteApp = (appId: string): void => {
    setIsPromoting(true);
    promoteAppMutation.mutate(appId, { onSettled: () => setIsPromoting(false) });
  };

  const getJwtMutation = useMutation({
    mutationFn: async (appId: string): Promise<string> => {
      const response = await appsService.regenerateJwt(appId);
      return response.jwtToken;
    },
  });
  const getJwtToken = async (appId: string): Promise<string> => getJwtMutation.mutateAsync(appId);

  const getSigningSecretMutation = useMutation({
    mutationFn: async (appId: string): Promise<string> => {
      const response = await appsService.getSigningSecret(appId);
      return response.signingSecret;
    },
  });
  const getSigningSecret = async (appId: string): Promise<string> =>
    getSigningSecretMutation.mutateAsync(appId);

  const uploadPictureMutation = useMutation({
    mutationFn: async ({ appId, file }: { appId: string; file: File }) =>
      appsService.uploadBotPicture(appId, file),
    onSuccess: () => toast.success('Profile picture uploaded successfully'),
    onError: (error: Error) =>
      toast.error('Failed to upload profile picture', { description: error.message }),
  });
  const handleUploadPicture = async (appId: string, file: File): Promise<void> => {
    await uploadPictureMutation.mutateAsync({ appId, file });
  };

  const loading = rawRows === undefined;

  const emptyCopy: Record<AppsView, { title: string; subtitle: string }> = {
    installed: {
      title: 'No apps installed',
      subtitle: 'Install apps from your org or the marketplace',
    },
    org: { title: 'No org apps yet', subtitle: 'Create an app to get started' },
    marketplace: { title: 'No marketplace apps', subtitle: 'No public apps are available yet' },
  };

  return (
    <div
      data-testid='apps-page'
      className='h-full w-full bg-background md:rounded-2xl overflow-hidden shadow-md'
    >
      <div className='h-full overflow-hidden'>
        <div className='flex flex-col h-full'>
          <div className='flex items-center justify-between p-6 border-b border-border bg-background'>
            <div>
              <h2 className='text-lg font-bold text-foreground'>Xyne Apps</h2>
              <p className='text-xs text-muted-foreground mt-1'>
                Manage your xyne-apps and their configurations
              </p>
            </div>
            <div className='flex items-center gap-2'>
              {canCreateApp && (
                <Button
                  onClick={() => setIsCreateModalOpen(true)}
                  data-track-category='Apps'
                  data-track-name='OpenCreateAppModal'
                >
                  <Plus size={16} className='mr-1' />
                  Create App
                </Button>
              )}
            </div>
          </div>

          <Dialog
            open={isCreateModalOpen}
            onOpenChange={setIsCreateModalOpen}
            title='Create New App'
            description='Create a new xyne-app to integrate with your workspace'
            className='max-w-lg max-h-[85vh]'
          >
            <CreateAppForm
              onSuccess={() => setIsCreateModalOpen(false)}
              onCancel={() => setIsCreateModalOpen(false)}
            />
          </Dialog>

          {/* View tabs */}
          <div className='flex items-center gap-1 px-6 pt-3 border-b border-border bg-background'>
            {VIEW_TABS.map(tab => (
              <button
                key={tab.value}
                type='button'
                onClick={() => handleSelectView(tab.value)}
                className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  view === tab.value
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
                data-track-category='Apps'
                data-track-name={`AppsView_${tab.value}`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search Bar */}
          <div className='px-6 py-3 border-b border-border bg-muted/50'>
            <div className='relative max-w-md'>
              <Search className='absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground' />
              <Input
                type='text'
                placeholder='Search apps by name, description or created by...'
                value={searchQuery}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setSearchQuery(e.target.value)
                }
                className='pl-10 h-9'
                data-track-category='Apps'
                data-track-name='SearchApps'
              />
            </div>
          </div>

          <div className='flex-1 overflow-y-auto p-4'>
            {loading ? (
              <div className='h-full flex items-center justify-center'>
                <p className='text-muted-foreground'>Loading...</p>
              </div>
            ) : filteredApps && filteredApps.length > 0 ? (
              <AppsTable
                apps={filteredApps as ComponentProps<typeof AppsTable>['apps']}
                currentUserId={user?.id ?? ''}
                onInstall={handleInstallApp}
                onReinstall={handleInstallApp}
                onUpdateApp={handleUpdateApp}
                onUpdateInstall={handleUpdateInstall}
                onGetJwtToken={getJwtToken}
                onGetSigningSecret={getSigningSecret}
                onUploadPicture={handleUploadPicture}
                userPermissions={permissions}
                isInstalling={installAppMutation.isPending}
                dataSource={view === 'installed' ? 'install' : 'app'}
                installedVersionByAppId={effectiveInstalledVersionByAppId}
                orgNamesById={effectiveOrgNamesById}
                {...(view === 'org' ? { onPromote: handlePromoteApp } : {})}
                canPromote={isXyneAppsAdmin}
                isPromoting={isPromoting}
              />
            ) : (
              <div className='text-center py-16'>
                <div className='text-muted-foreground text-5xl mb-4'>
                  <AppWindow size={48} className='mx-auto opacity-50' />
                </div>
                <h3 className='text-xl font-semibold text-foreground mb-2'>
                  {searchQuery ? 'No matching apps found' : emptyCopy[view].title}
                </h3>
                <p className='text-muted-foreground'>
                  {searchQuery ? 'Try adjusting your search query' : emptyCopy[view].subtitle}
                </p>
              </div>
            )}
          </div>

          {/* Search results count + load more */}
          {isSearchMode && filteredApps.length > 0 && (
            <div className='flex items-center justify-between px-6 py-3 border-t border-border bg-muted'>
              <span className='text-sm text-muted-foreground'>
                Showing {filteredApps.length} of {searchTotal}
              </span>
              {hasMore && (
                <Button
                  variant='outline'
                  size='sm'
                  onClick={loadMore}
                  data-track-category='Apps'
                  data-track-name='LOAD_MORE_APPS'
                  disabled={isSearching}
                >
                  {isSearching ? 'Loading…' : 'Load more'}
                </Button>
              )}
            </div>
          )}

          {/* Pagination Controls */}
          {(hasPreviousPage || hasNextPage) && !searchQuery && (
            <div className='flex items-center justify-between px-6 py-3 border-t border-border bg-muted'>
              <Button
                variant='outline'
                size='sm'
                onClick={handlePreviousPage}
                data-track-category='Apps'
                data-track-name='APPS_PREV_PAGE'
                disabled={!hasPreviousPage}
                className='gap-1'
              >
                <ChevronLeft className='h-4 w-4' />
                Prev
              </Button>
              <span className='text-sm text-muted-foreground'>Page {currentPage}</span>
              <Button
                variant='outline'
                size='sm'
                onClick={handleNextPage}
                data-track-category='Apps'
                data-track-name='APPS_NEXT_PAGE'
                disabled={!hasNextPage}
                className='gap-1'
              >
                Next
                <ChevronRight className='h-4 w-4' />
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

AppsScreen.displayName = 'AppsScreen';

export default AppsScreen;
