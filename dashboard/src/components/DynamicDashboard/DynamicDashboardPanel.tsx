import { ReactElement, useCallback, useEffect, useState } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { Outlet, useNavigate, useParams } from 'react-router-dom';
import {
  LayoutDashboard,
  Plus,
  Trash2,
  Database,
  Network,
  Workflow,
  Bell,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../hooks/useAuth';
import { useDashboardList, useDashboardMutations } from '../../hooks/useDashboards';
import { listDataSources } from '../../services/DynamicDashboard/dataSourcesService';
import { getApiErrorMessage } from '../../utils/apiError';
import { websocketService } from '../../services/clients/socketClient';
import { Dialog } from '../ui/Dialog';
import { DashboardDeleteModal } from './DashboardDeleteModal';
import { CreateDashboardModal } from './CreateDashboardModal';
import { DataSourcesAdminModal } from './DataSourcesAdminModal';
import { DatabaseVisualizerDialog } from './DatabaseVisualizer/DatabaseVisualizerDialog';
import { PickerHint } from './PickerHint';
import { SidebarNavItem } from './panel/SidebarNavItem';
import { EmptyState } from './panel/EmptyState';
import { NoSourceEmptyState } from './panel/NoSourceEmptyState';

const DynamicDashboardPanel = (): ReactElement => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { dashboardId } = useParams<{ dashboardId?: string }>();

  const PAGE_SIZE = 50;
  type DashboardTab = 'mine' | 'shared' | 'all';
  const [activeTab, setActiveTab] = useState<DashboardTab>('mine');

  // Growing-limit window per tab — increase `limit` by PAGE_SIZE when the
  // user scrolls to the bottom. Only the active tab's query runs.
  const [mineLimit, setMineLimit] = useState(PAGE_SIZE);
  const { data: mineData } = useDashboardList('mine', mineLimit, {
    enabled: activeTab === 'mine',
  });

  const [sharedLimit, setSharedLimit] = useState(PAGE_SIZE);
  const { data: sharedData } = useDashboardList('shared', sharedLimit, {
    enabled: activeTab === 'shared',
  });

  const [allLimit, setAllLimit] = useState(PAGE_SIZE);
  const { data: allData } = useDashboardList('all', allLimit, {
    enabled: activeTab === 'all',
  });

  const dashboardList =
    activeTab === 'mine'
      ? (mineData?.dashboards ?? [])
      : activeTab === 'shared'
        ? (sharedData?.dashboards ?? [])
        : (allData?.dashboards ?? []);
  const handleEndReached = useCallback(() => {
    if (activeTab === 'mine' && mineData?.hasMore) {
      setMineLimit(l => l + PAGE_SIZE);
    } else if (activeTab === 'shared' && sharedData?.hasMore) {
      setSharedLimit(l => l + PAGE_SIZE);
    } else if (activeTab === 'all' && allData?.hasMore) {
      setAllLimit(l => l + PAGE_SIZE);
    }
  }, [activeTab, mineData?.hasMore, sharedData?.hasMore, allData?.hasMore]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [dataSourcesOpen, setDataSourcesOpen] = useState(false);
  const [schemaVizOpen, setSchemaVizOpen] = useState(false);

  const queryClient = useQueryClient();
  const { data: dataSources } = useQuery({
    queryKey: ['dataSources', 'list'],
    queryFn: listDataSources,
  });
  useEffect(() => {
    let active = true;
    const handler = (): void => {
      void queryClient.invalidateQueries({ queryKey: ['dataSources', 'list'] });
    };
    void websocketService
      .connect()
      .then(() => {
        if (!active) return;
        websocketService.on('data_source_ingestion_updated', handler);
      })
      .catch(() => {});
    return () => {
      active = false;
      websocketService.removeListener('data_source_ingestion_updated', handler);
    };
  }, [queryClient]);
  const hasDataSources = (dataSources?.length ?? 0) > 0;
  const ingestingSources = (dataSources ?? []).filter(
    s => s.ingestionStatus === 'pending' || s.ingestionStatus === 'in_progress',
  );

  const { remove } = useDashboardMutations();
  const isDeleting = remove.isPending;

  const handleConfirmDelete = useCallback(() => {
    if (!deletingId || remove.isPending) return;
    const idBeingDeleted = deletingId;
    remove.mutate(idBeingDeleted, {
      onSuccess: () => {
        toast.success('Dashboard deleted');
        if (dashboardId === idBeingDeleted && user?.workspaceId) {
          void navigate(`/${user.workspaceId}/dashboards`);
        }
        setDeletingId(null);
      },
      onError: (err: unknown) => {
        toast.error('Failed to delete dashboard', { description: getApiErrorMessage(err) });
      },
    });
  }, [deletingId, remove, dashboardId, user?.workspaceId, navigate]);

  const deletingDashboard = dashboardList.find(d => d.id === deletingId);

  const showInnerSidebar = hasDataSources || !!dashboardId;

  return (
    <div className='flex h-full gap-2'>
      {showInnerSidebar && (
        <aside className='w-[280px] shrink-0 bg-xyne-gray-25 md:rounded-2xl overflow-hidden shadow-md flex flex-col min-h-0'>
          <div className='px-4 h-[52px] flex items-center gap-2'>
            <h2 className='text-[17px] leading-6 font-semibold text-xyne-gray-900'>Dashboard</h2>
            <button
              type='button'
              onClick={() => setCreateOpen(true)}
              className='ml-auto inline-flex items-center justify-center w-7 h-7 rounded-lg text-xyne-gray-600 hover:bg-xyne-gray-100 transition-colors'
              aria-label='Create dashboard'
              data-track-category='DYNAMIC_DASHBOARD'
              data-track-name='Open_Create_Dashboard_Modal'
            >
              <Plus size={18} />
            </button>
          </div>

          {ingestingSources.length > 0 && (
            <div
              className='mx-4 mb-2 inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-50 text-amber-700 text-[11px] font-medium border border-amber-200 truncate'
              title={ingestingSources.map(s => s.name).join(', ')}
            >
              <Loader2 className='animate-spin size-3 shrink-0' />
              <span className='truncate'>
                {ingestingSources.length === 1
                  ? `Ingesting ${ingestingSources[0]!.name}…`
                  : `Ingesting ${ingestingSources.length} sources…`}
              </span>
            </div>
          )}

          <nav className='px-2 pt-1 pb-2 flex flex-col gap-0.5'>
            <SidebarNavItem
              icon={<Database size={16} />}
              label='Data Sources'
              onClick={() => setDataSourcesOpen(true)}
              trackName='Open_Data_Sources_Admin'
            />
            <SidebarNavItem
              icon={<Network size={16} />}
              label='Schema'
              onClick={() => setSchemaVizOpen(true)}
              trackName='Open_Database_Visualizer'
            />
            <SidebarNavItem icon={<Workflow size={16} />} label='Automations' disabled />
            <SidebarNavItem icon={<Bell size={16} />} label='Notification' disabled />
          </nav>

          <div className='mx-4 my-1 h-px bg-xyne-gray-200' />

          <div className='px-2 pt-1'>
            <div
              role='tablist'
              className='flex items-center gap-0.5 rounded-lg bg-xyne-gray-100 p-0.5'
            >
              {(['mine', 'shared', 'all'] as const).map(tab => {
                const isActive = activeTab === tab;
                const label = tab === 'mine' ? 'Mine' : tab === 'shared' ? 'Shared' : 'All';
                return (
                  <button
                    key={tab}
                    type='button'
                    role='tab'
                    aria-selected={isActive}
                    onClick={() => setActiveTab(tab)}
                    className={`flex-1 h-7 rounded-md text-xs font-medium transition-colors ${
                      isActive
                        ? 'bg-white text-xyne-gray-900 shadow-[0px_1px_2px_0px_rgba(0,0,0,0.04)]'
                        : 'text-xyne-gray-600 hover:text-xyne-gray-900'
                    }`}
                    data-track-category='DYNAMIC_DASHBOARD'
                    data-track-name={`Tab_${label}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className='flex-1 min-h-0 px-2 pb-2 pt-1'>
            {dashboardList.length === 0 ? (
              <div className='px-3 py-4 text-xs text-xyne-gray-500'>
                {activeTab === 'mine' ? (
                  <>
                    No dashboards yet — use{' '}
                    <span className='font-medium text-xyne-gray-600'>+</span> above to create one.
                  </>
                ) : activeTab === 'shared' ? (
                  'No dashboards have been shared with you yet.'
                ) : (
                  'No dashboards in this workspace yet.'
                )}
              </div>
            ) : (
              <Virtuoso
                style={{ height: '100%' }}
                data={dashboardList}
                endReached={handleEndReached}
                itemContent={(_index, d) => {
                  const active = d.id === dashboardId;
                  const disabled = !user?.workspaceId;
                  const select = (): void => {
                    if (disabled || !user?.workspaceId) return;
                    void navigate(`/${user.workspaceId}/dashboards/${d.id}`);
                  };
                  return (
                    <div
                      className={`group flex items-center gap-2 px-2.5 h-9 rounded-lg transition-colors ${
                        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                      } ${
                        active
                          ? 'bg-white shadow-[0px_1px_2px_0px_rgba(0,0,0,0.04)] border border-xyne-gray-200 text-xyne-gray-900'
                          : 'text-xyne-gray-600 hover:bg-xyne-gray-100'
                      }`}
                      role='button'
                      tabIndex={disabled ? -1 : 0}
                      onClick={select}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          select();
                        }
                      }}
                      aria-disabled={disabled}
                      data-track-category='DYNAMIC_DASHBOARD'
                      data-track-name='Select_Dashboard'
                    >
                      <LayoutDashboard
                        size={16}
                        className={active ? 'text-xyne-gray-900' : 'text-xyne-gray-500'}
                      />
                      <span className={`flex-1 text-sm truncate ${active ? 'font-semibold' : ''}`}>
                        {d.name}
                      </span>
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          setDeletingId(d.id);
                        }}
                        className='opacity-0 group-hover:opacity-100 p-1 rounded text-xyne-gray-500 hover:bg-rose-100 hover:text-rose-600 transition-all'
                        aria-label={`Delete ${d.name}`}
                        data-track-category='DYNAMIC_DASHBOARD'
                        data-track-name='Open_Delete_Dashboard_Modal'
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  );
                }}
              />
            )}
          </div>
        </aside>
      )}

      <div className='flex-1 flex flex-col min-w-0'>
        <div className='flex-1 overflow-auto min-h-0'>
          {dashboardId ? (
            <Outlet />
          ) : !hasDataSources ? (
            <NoSourceEmptyState onConnect={() => setDataSourcesOpen(true)} />
          ) : dashboardList.length === 0 ? (
            <EmptyState onCreate={() => setCreateOpen(true)} />
          ) : (
            <PickerHint />
          )}
        </div>
      </div>

      <Dialog
        open={!!deletingId}
        onOpenChange={open => !open && !isDeleting && setDeletingId(null)}
        title='Delete Dashboard'
      >
        <DashboardDeleteModal
          onClose={() => setDeletingId(null)}
          onConfirm={handleConfirmDelete}
          dashboardName={deletingDashboard?.name}
          isDeleting={isDeleting}
        />
      </Dialog>

      <Dialog
        open={createOpen}
        onOpenChange={open => !open && setCreateOpen(false)}
        title='Create Dashboard'
      >
        <CreateDashboardModal onClose={() => setCreateOpen(false)} />
      </Dialog>

      <Dialog
        open={dataSourcesOpen}
        onOpenChange={open => !open && setDataSourcesOpen(false)}
        title='Data sources'
        className='max-w-none w-fit'
      >
        <DataSourcesAdminModal onClose={() => setDataSourcesOpen(false)} />
      </Dialog>

      <DatabaseVisualizerDialog open={schemaVizOpen} onOpenChange={setSchemaVizOpen} />
    </div>
  );
};

export default DynamicDashboardPanel;
