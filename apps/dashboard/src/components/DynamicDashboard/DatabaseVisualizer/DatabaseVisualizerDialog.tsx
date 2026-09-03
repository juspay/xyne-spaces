import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, Loader2, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui/Button/Button';
import { SegmentedToggle } from '../../ui/SegmentedToggle/SegmentedToggle';
import { listDataSources } from '../../../services/DynamicDashboard/dataSourcesService';
import { dataSourceKeys, useDataSourceMutations } from '../../../hooks/useDataSources';
import { fetchDataSourceSchema } from '../../../services/DynamicDashboard/dataSourceSchemaService';
import { SchemaErdCanvas } from './SchemaErdCanvas';
import { SchemaBrowser } from './SchemaBrowser';
import { DataSourcePicker } from './DataSourcePicker';

interface DatabaseVisualizerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function CenterState({ children }: { children: ReactNode }): ReactElement {
  return (
    <div className='absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground text-sm'>
      {children}
    </div>
  );
}

function errorText(err: unknown): string | null {
  if (!err) return null;
  const e = err as { response?: { data?: { error?: string; message?: string } }; message?: string };
  return (
    e?.response?.data?.message ?? e?.response?.data?.error ?? e?.message ?? 'Something went wrong.'
  );
}

export function DatabaseVisualizerDialog({
  open,
  onOpenChange,
}: DatabaseVisualizerDialogProps): ReactElement {
  const sourcesQuery = useQuery({
    queryKey: dataSourceKeys.list,
    queryFn: listDataSources,
    enabled: open,
  });
  const sources = useMemo(() => sourcesQuery.data ?? [], [sourcesQuery.data]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const activeId = selectedId ?? sources[0]?.id ?? null;

  const schemaQuery = useQuery({
    queryKey: ['db-viz-schema', activeId],
    queryFn: ({ signal }) => fetchDataSourceSchema(activeId as string, signal),
    enabled: open && !!activeId,
    staleTime: 5 * 60 * 1000,
  });

  const [search, setSearch] = useState('');
  const [view, setView] = useState<'browse' | 'diagram'>('browse');

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRefresh, setConfirmRefresh] = useState(false);
  const activeSource = useMemo(
    () => sources.find(s => s.id === activeId) ?? null,
    [sources, activeId],
  );

  const { refresh: refreshMutation, remove: deleteMutation } = useDataSourceMutations();
  const busy = refreshMutation.isPending || deleteMutation.isPending;

  const onRefreshConfirmed = (): void => {
    if (!activeId) return;
    refreshMutation.mutate(activeId, {
      onSuccess: () => {
        setConfirmRefresh(false);
        onOpenChange(false);
      },
    });
  };

  const onDeleteConfirmed = (): void => {
    if (!activeId) return;
    deleteMutation.mutate(activeId, {
      onSuccess: () => {
        setSelectedId(null);
        setConfirmDelete(false);
      },
    });
  };

  const { reset: resetRefresh } = refreshMutation;
  const { reset: resetDelete } = deleteMutation;
  useEffect(() => {
    setSearch('');
    resetRefresh();
    resetDelete();
  }, [activeId, resetRefresh, resetDelete]);

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title='Database schema'
        className='max-w-none w-[92vw] h-[88vh] p-0 overflow-hidden'
      >
        <div className='flex flex-col h-full'>
          <div className='flex items-center gap-2 px-3 h-[60px] border-b border-border shrink-0 bg-muted/30'>
            {sources.length > 0 && (
              <DataSourcePicker sources={sources} selectedId={activeId} onSelect={setSelectedId} />
            )}
            {activeSource && (
              <>
                <button
                  type='button'
                  onClick={() => {
                    refreshMutation.reset();
                    setConfirmRefresh(true);
                  }}
                  disabled={busy}
                  title='Re-ingest this database'
                  aria-label='Re-ingest this database'
                  data-track-category='DYNAMIC_DASHBOARD'
                  data-track-name='Db_Viz_Refresh_Source'
                  className='shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
                >
                  <RefreshCw
                    size={15}
                    className={refreshMutation.isPending ? 'animate-spin' : ''}
                  />
                </button>
                <button
                  type='button'
                  onClick={() => {
                    deleteMutation.reset();
                    setConfirmDelete(true);
                  }}
                  disabled={busy}
                  title='Delete this database'
                  aria-label='Delete this database'
                  data-track-category='DYNAMIC_DASHBOARD'
                  data-track-name='Db_Viz_Delete_Source'
                  className='shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-lg text-muted-foreground hover:bg-rose-500/10 hover:text-rose-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
                >
                  <Trash2 size={15} />
                </button>
              </>
            )}
            <div className='w-px h-6 bg-border mx-1.5' />
            <SegmentedToggle
              options={[
                { value: 'browse', label: 'Browse' },
                { value: 'diagram', label: 'Diagram' },
              ]}
              value={view}
              onChange={setView}
            />
            <div className='ml-auto relative'>
              <Search
                size={14}
                className='absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground'
              />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={view === 'diagram' ? 'Find table…' : 'Search tables…'}
                aria-label='Search tables'
                data-track-category='DYNAMIC_DASHBOARD'
                data-track-name='Db_Viz_Search'
                className='h-9 w-56 pl-9 pr-3 text-[13px] bg-card border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring focus:ring-2 focus:ring-ring/15 transition-colors'
              />
            </div>
            <button
              type='button'
              onClick={() => onOpenChange(false)}
              aria-label='Close'
              data-track-category='DYNAMIC_DASHBOARD'
              data-track-name='Db_Viz_Close'
              className='shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors'
            >
              <X size={17} />
            </button>
          </div>

          <div className='flex-1 min-h-0 relative'>
            {sourcesQuery.isLoading ? (
              <CenterState>
                <Loader2 className='animate-spin' size={20} />
                Loading databases…
              </CenterState>
            ) : sources.length === 0 ? (
              <CenterState>No connected databases.</CenterState>
            ) : schemaQuery.isLoading ? (
              <CenterState>
                <Loader2 className='animate-spin' size={20} />
                Loading schema…
              </CenterState>
            ) : schemaQuery.isError ? (
              <CenterState>
                <AlertCircle size={20} className='text-rose-500' />
                <span>Couldn&apos;t load this database&apos;s schema.</span>
                <button
                  type='button'
                  onClick={() => void schemaQuery.refetch()}
                  data-track-category='DYNAMIC_DASHBOARD'
                  data-track-name='Db_Viz_Retry'
                  className='mt-1 text-sm text-primary hover:underline'
                >
                  Retry
                </button>
              </CenterState>
            ) : schemaQuery.data && schemaQuery.data.tables.length === 0 ? (
              <CenterState>No tables in this database.</CenterState>
            ) : schemaQuery.data ? (
              view === 'diagram' ? (
                <SchemaErdCanvas schema={schemaQuery.data} search={search} />
              ) : (
                <SchemaBrowser
                  schema={schemaQuery.data}
                  dataSourceId={activeId as string}
                  search={search}
                />
              )
            ) : null}
          </div>
        </div>
      </Dialog>

      <Dialog
        open={confirmRefresh}
        onOpenChange={next => {
          if (!next && !refreshMutation.isPending) setConfirmRefresh(false);
        }}
        title='Re-ingest database?'
        className='max-w-md'
      >
        <div className='p-4'>
          <p className='text-sm text-foreground'>
            This re-scans <span className='font-semibold'>{activeSource?.name}</span> against the
            live database: it re-profiles every table you already ingested and re-generates all
            their AI descriptions from scratch — any manual edits to table or column descriptions
            will be overwritten. Existing dashboards keep working. You&apos;ll see ingestion
            progress once it starts.
          </p>
          {errorText(refreshMutation.error) && (
            <p className='mt-3 text-[12px] text-rose-600'>{errorText(refreshMutation.error)}</p>
          )}
          <div className='mt-5 flex justify-end gap-2'>
            <button
              type='button'
              onClick={() => setConfirmRefresh(false)}
              disabled={refreshMutation.isPending}
              data-track-category='DYNAMIC_DASHBOARD'
              data-track-name='Db_Viz_Refresh_Source_Cancel'
              className='h-9 px-3 rounded-lg text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50'
            >
              Cancel
            </button>
            <Button
              variant='default'
              type='button'
              onClick={onRefreshConfirmed}
              disabled={refreshMutation.isPending}
              trackId='reingest_data_source'
              data-track-category='DYNAMIC_DASHBOARD'
              data-track-name='Db_Viz_Refresh_Source_Confirm'
              className='h-9 px-3 rounded-lg text-sm font-medium text-primary-foreground bg-primary hover:bg-primary/90 transition-colors disabled:opacity-50 inline-flex items-center gap-1.5'
            >
              {refreshMutation.isPending && <Loader2 size={13} className='animate-spin' />}
              Re-ingest
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={confirmDelete}
        onOpenChange={next => {
          if (!next && !deleteMutation.isPending) setConfirmDelete(false);
        }}
        title='Delete database?'
        className='max-w-md'
      >
        <div className='p-4'>
          <p className='text-sm text-foreground'>
            This permanently removes <span className='font-semibold'>{activeSource?.name}</span> and
            its ingested schema and search index. Dashboards already built from it keep working, but
            it can no longer be browsed or queried, and this can&apos;t be undone.
          </p>
          {errorText(deleteMutation.error) && (
            <p className='mt-3 text-[12px] text-rose-600'>{errorText(deleteMutation.error)}</p>
          )}
          <div className='mt-5 flex justify-end gap-2'>
            <button
              type='button'
              onClick={() => setConfirmDelete(false)}
              disabled={deleteMutation.isPending}
              data-track-category='DYNAMIC_DASHBOARD'
              data-track-name='Db_Viz_Delete_Source_Cancel'
              className='h-9 px-3 rounded-lg text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50'
            >
              Cancel
            </button>
            <Button
              variant='destructive'
              type='button'
              onClick={onDeleteConfirmed}
              disabled={deleteMutation.isPending}
              trackId='delete_data_source'
              data-track-category='DYNAMIC_DASHBOARD'
              data-track-name='Db_Viz_Delete_Source_Confirm'
              className='h-9 px-3 rounded-lg text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 transition-colors disabled:opacity-50 inline-flex items-center gap-1.5'
            >
              {deleteMutation.isPending && <Loader2 size={13} className='animate-spin' />}
              Delete
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
