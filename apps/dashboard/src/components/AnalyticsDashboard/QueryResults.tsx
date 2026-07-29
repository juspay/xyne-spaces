import React, { useEffect, useState, useCallback, useRef, useMemo, type ReactElement } from 'react';
import GridLayout, { getCompactor, type Layout, type ResizeHandleAxis } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { apiInstance } from '../../services/clients/apiClient';
import { Trash2, RefreshCw, Edit, GripVertical, Maximize2, X } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import type { Query as QueryType, Dashboard } from '@xyne/shared';
import { QueryVisualization } from '../QueryVisualizations/QueryVisualization';
import type { QueryVisualizationType } from '../QueryVisualizations/types';
import { cn } from '../../utils/classNames';
import { useZero } from '../../hooks/useZero';
import { mutators } from '../../zero/mutators';
import { Dialog } from '../ui/Dialog/Dialog';
import { toast } from 'sonner';
import {
  GRID_COLS,
  MIN_TILE_H,
  MIN_TILE_W,
  ROW_HEIGHT_PX,
  TILE_MARGIN_PX,
} from '../DynamicDashboard/ComponentGrid/constants';
import { buildAnalyticsGridLayout } from './analyticsGridUtils';
import { useReferenceLabels } from '../../hooks/useReferenceLabels';
import { formatReferenceDisplayValue } from '../../utils/referenceLabelUtils';

const DASHBOARD_GRID_COMPACTOR = getCompactor(null, false, true);

interface MappingEntry {
  id: string;
  dashboardId: string;
  queryId: string;
  sequence?: number;
  createdAt: number;
  updatedAt: number;
  query: QueryType | undefined;
}

export interface DashboardWithQueries extends Dashboard {
  queryMappings?: ReadonlyArray<MappingEntry>;
}

interface QueryResultsProps {
  dashboardData: DashboardWithQueries | null | undefined;
  onDeleteQuery: (queryId: string) => void;
  onEditQuery?: (query: {
    id: string;
    title: string;
    queryJson: unknown;
    visualType?: string | null;
  }) => void;
}

interface QueryResult {
  queryId: string;
  mappingId: string;
  queryTitle: string;
  isLoading: boolean;
  data: Record<string, unknown>[] | null;
  error: string | null;
  visualType: string | null;
}

function QueryResultFallbackTable({
  data,
}: {
  data: Record<string, unknown>[];
}): React.ReactElement {
  const referenceLabels = useReferenceLabels(data);
  const columns = Object.keys(data[0] || {});

  return (
    <table className='min-w-full divide-y divide-border/60 text-xs'>
      <thead className='bg-gradient-to-b from-muted to-muted/70 sticky top-0 z-10'>
        <tr>
          {columns.map(key => (
            <th
              key={key}
              className='px-3 py-2.5 text-left text-[10px] font-semibold text-foreground/70 uppercase tracking-wider'
            >
              {key}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className='bg-background divide-y divide-border/40'>
        {data.map((row, index) => (
          <tr key={index} className='hover:bg-muted/40 transition-colors duration-150'>
            {columns.map(key => {
              const { display, tooltip } = formatReferenceDisplayValue(
                key,
                row[key],
                referenceLabels,
              );
              return (
                <td
                  key={key}
                  className='px-3 py-2 whitespace-nowrap text-[11px] text-foreground/80 font-medium'
                  title={tooltip}
                >
                  {display}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ResizeCornerHandle(_axis: ResizeHandleAxis, ref: React.Ref<HTMLElement>): ReactElement {
  return (
    <div
      ref={ref as React.Ref<HTMLDivElement>}
      className='react-resizable-handle react-resizable-handle-se !w-5 !h-5 !right-0 !bottom-0 !bg-none !p-0 !m-0 opacity-50 hover:opacity-100 transition-opacity'
      data-track-category='ANALYTICS'
      data-track-name='Resize_Query_Card'
      aria-label='Resize'
    >
      <svg
        viewBox='0 0 16 16'
        width='14'
        height='14'
        className='absolute right-[2px] bottom-[2px] text-xyne-gray-500'
        aria-hidden='true'
      >
        <path d='M3 13 L13 3' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' />
        <path d='M8 13 L13 8' stroke='currentColor' strokeWidth='1.5' strokeLinecap='round' />
      </svg>
    </div>
  );
}

const QueryResults: React.FC<QueryResultsProps> = ({
  dashboardData,
  onDeleteQuery,
  onEditQuery,
}) => {
  const zero = useZero();
  const lastQueryJsonRef = useRef<Record<string, string>>({});
  const lastSerializedRef = useRef<Map<string, string>>(new Map());
  const backfillPersistedRef = useRef<string>('');

  const [expandedQueryId, setExpandedQueryId] = useState<string | null>(null);

  const sortedMappings = useMemo<MappingEntry[]>(() => {
    const mappings = (dashboardData?.queryMappings ?? []) as MappingEntry[];
    return [...mappings].sort((a, b) => {
      const seqDiff = (a.sequence ?? 0) - (b.sequence ?? 0);
      return seqDiff !== 0 ? seqDiff : a.createdAt - b.createdAt;
    });
  }, [dashboardData]);

  const queriesData = useMemo<QueryType[]>(() => {
    return sortedMappings.map(m => m.query).filter((q): q is QueryType => q !== undefined);
  }, [sortedMappings]);

  const gridEntries = useMemo(
    () =>
      queriesData.map(q => ({
        id: q.id,
        position: q.position ?? '{}',
        visualType: q.visualType ?? null,
      })),
    [queriesData],
  );

  const { layout, backfillUpdates } = useMemo(
    () => buildAnalyticsGridLayout(gridEntries, true),
    [gridEntries],
  );

  const [results, setResults] = useState<QueryResult[]>([]);

  const executeQuery = useCallback(
    async (queryId: string, _mappingId: string, queryJson: unknown): Promise<void> => {
      setResults(prev =>
        prev.map(r => (r.queryId === queryId ? { ...r, isLoading: true, error: null } : r)),
      );
      try {
        const response = await apiInstance.post<{
          success: boolean;
          data?: Record<string, unknown>[];
          error?: { message: string };
        }>('/analytics-query', queryJson as Record<string, unknown>);

        setResults(prev =>
          prev.map(r =>
            r.queryId === queryId
              ? response.data.success && response.data.data
                ? { ...r, isLoading: false, data: response.data.data }
                : {
                    ...r,
                    isLoading: false,
                    error: response.data.error?.message || 'Failed to execute',
                  }
              : r,
          ),
        );
      } catch {
        setResults(prev =>
          prev.map(r =>
            r.queryId === queryId
              ? { ...r, isLoading: false, error: 'Failed to execute query' }
              : r,
          ),
        );
      }
    },
    [],
  );

  // Sync results list when ordered queries change
  useEffect(() => {
    setResults(prev => {
      const queryIds = new Set(queriesData.map(q => q.id));
      const keptResults = prev
        .filter(r => queryIds.has(r.queryId))
        .map(r => {
          const query = queriesData.find(q => q.id === r.queryId);
          const mapping = sortedMappings.find(m => m.queryId === r.queryId);
          const visualType = query?.visualType ? (query.visualType as string) : null;
          if (query && query.title !== r.queryTitle) {
            return {
              queryId: r.queryId,
              mappingId: mapping?.id ?? r.mappingId,
              queryTitle: query.title ?? '',
              isLoading: r.isLoading,
              data: r.data,
              error: r.error,
              visualType,
            };
          }
          return { ...r, mappingId: mapping?.id ?? r.mappingId, visualType };
        });

      const newResults = queriesData
        .filter(q => !keptResults.some(r => r.queryId === q.id))
        .map(q => {
          const mapping = sortedMappings.find(m => m.queryId === q.id);
          return {
            queryId: q.id,
            mappingId: mapping?.id ?? '',
            queryTitle: q.title ?? '',
            isLoading: true,
            data: null,
            error: null,
            visualType: (q.visualType as string) || null,
          };
        });

      return [...keptResults, ...newResults];
    });
  }, [queriesData, sortedMappings]);

  // Auto-refresh when queryJson changes
  useEffect(() => {
    queriesData.forEach(q => {
      const currentJson = JSON.stringify(q.queryJson);
      const lastJson = lastQueryJsonRef.current[q.id];
      if (currentJson !== lastJson) {
        lastQueryJsonRef.current[q.id] = currentJson;
        const mapping = sortedMappings.find(m => m.queryId === q.id);
        void executeQuery(q.id, mapping?.id ?? '', q.queryJson);
      }
    });
  }, [queriesData, sortedMappings, executeQuery]);

  useEffect(() => {
    for (const q of queriesData) {
      if (!lastSerializedRef.current.has(q.id)) {
        lastSerializedRef.current.set(q.id, q.position ?? '{}');
      }
    }
  }, [queriesData]);

  const gridLayoutKey = useMemo(() => queriesData.map(q => q.id).join(','), [queriesData]);

  const persistLayout = useCallback(
    (next: Layout) => {
      if (!zero) return;
      const updates: Array<{ id: string; position: string }> = [];
      for (const item of next) {
        const w = Math.max(item.w, item.minW ?? MIN_TILE_W);
        const h = Math.max(item.h, item.minH ?? MIN_TILE_H);
        const serialized = JSON.stringify({
          x: item.x,
          y: item.y,
          w,
          h,
        });
        const prev = lastSerializedRef.current.get(item.i);
        if (prev === serialized) continue;
        lastSerializedRef.current.set(item.i, serialized);
        const persisted = queriesData.find(q => q.id === item.i)?.position;
        if (prev === undefined && persisted === serialized) continue;
        updates.push({ id: item.i, position: serialized });
      }
      if (updates.length === 0) return;
      const result = zero.mutate(
        mutators.dashboardComponent.updatePositions({
          updates,
          timestamp: Date.now(),
        }),
      );
      void result.server
        .then(r => {
          if (r.type === 'error') {
            toast.error('Failed to save card layout', {
              description: r.error instanceof Error ? r.error.message : 'Unknown error',
            });
          }
        })
        .catch((e: unknown) => {
          toast.error('Failed to save card layout', {
            description: e instanceof Error ? e.message : 'Unknown error',
          });
        });
    },
    [queriesData, zero],
  );

  useEffect(() => {
    if (backfillUpdates.length === 0 || !zero) return;
    const key = backfillUpdates.map(u => `${u.id}:${u.position}`).join('|');
    if (backfillPersistedRef.current === key) return;
    backfillPersistedRef.current = key;

    for (const u of backfillUpdates) {
      lastSerializedRef.current.set(u.id, u.position);
    }

    const result = zero.mutate(
      mutators.dashboardComponent.updatePositions({
        updates: backfillUpdates,
        timestamp: Date.now(),
      }),
    );
    void result.server.catch(() => {
      backfillPersistedRef.current = '';
    });
  }, [backfillUpdates, zero]);

  const handleRefreshQuery = useCallback(
    (queryId: string, mappingId: string, queryJson: unknown): void => {
      void executeQuery(queryId, mappingId, queryJson);
    },
    [executeQuery],
  );

  const handleDelete = (queryId: string): void => {
    onDeleteQuery(queryId);
  };

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [gridWidth, setGridWidth] = useState<number>(0);
  const hasQueries = queriesData.length > 0;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = (): void => {
      const style = getComputedStyle(el);
      const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const w = el.clientWidth - padX;
      if (w > 0) setGridWidth(w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasQueries]);

  if (queriesData.length === 0) {
    return (
      <div className='flex flex-col items-center justify-center h-48 text-muted-foreground bg-gradient-to-b from-muted/20 to-transparent rounded-2xl border border-dashed border-border/60'>
        <div className='w-12 h-12 rounded-xl bg-muted/50 flex items-center justify-center mb-3 shadow-inner'>
          <svg
            className='w-6 h-6 text-muted-foreground/50'
            fill='none'
            viewBox='0 0 24 24'
            stroke='currentColor'
          >
            <path
              strokeLinecap='round'
              strokeLinejoin='round'
              strokeWidth={1.5}
              d='M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z'
            />
          </svg>
        </div>
        <span className='text-sm font-medium'>No queries created yet</span>
        <span className='text-xs opacity-60 mt-1'>Create a query to visualize your data</span>
      </div>
    );
  }

  const resultsByQueryId = new Map<string, QueryResult>(results.map(r => [r.queryId, r]));
  const expandedResult = expandedQueryId ? resultsByQueryId.get(expandedQueryId) : undefined;

  return (
    <div>
      <div ref={wrapRef} className='dashboard-grid-wrap'>
        {gridWidth > 0 && (
          <GridLayout
            key={gridLayoutKey}
            className='dashboard-grid-layout'
            layout={layout}
            width={gridWidth}
            compactor={DASHBOARD_GRID_COMPACTOR}
            gridConfig={{ cols: GRID_COLS, rowHeight: ROW_HEIGHT_PX, margin: TILE_MARGIN_PX }}
            dragConfig={{ enabled: true, handle: '.dashboard-grid-drag-handle' }}
            resizeConfig={{ enabled: true, handles: ['se'], handleComponent: ResizeCornerHandle }}
            onDragStop={persistLayout}
            onResizeStop={persistLayout}
          >
            {sortedMappings.map(mapping => {
              const q = mapping.query;
              if (!q) return null;
              const r = resultsByQueryId.get(q.id) ?? {
                queryId: q.id,
                mappingId: mapping.id,
                queryTitle: q.title ?? '',
                isLoading: true,
                data: null,
                error: null,
                visualType: (q.visualType as string) || null,
              };

              const isKPI = r.visualType === 'KPI' || r.visualType === 'KPI_COMPARE';
              const hasData = r.data && r.data.length > 0;

              return (
                <div key={q.id} className='dashboard-grid-item h-full'>
                  <div
                    className={cn(
                      'h-full group rounded-2xl border border-border/60 bg-gradient-to-br from-card via-card to-muted/10 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.02)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.08),0_8px_24px_rgba(0,0,0,0.04)] hover:border-border/80 transition-all duration-300 ease-out overflow-hidden flex flex-col backdrop-blur-sm',
                      r.error && 'border-red-200 dark:border-red-800/60',
                    )}
                  >
                    <div className='flex items-center justify-between px-4 py-3 border-b border-border/40 bg-gradient-to-r from-muted/30 via-muted/20 to-transparent shrink-0'>
                      <div className='flex items-center gap-2 min-w-0 dashboard-grid-drag-handle cursor-grab active:cursor-grabbing touch-none'>
                        <div className='shrink-0 text-muted-foreground/40 hover:text-muted-foreground/80 transition-colors p-0.5 rounded'>
                          <GripVertical className='w-4 h-4' />
                        </div>
                        <div className='w-1.5 h-1.5 rounded-full bg-primary/60 shrink-0' />
                        <span className='text-sm font-semibold text-foreground/90 truncate'>
                          {r.queryTitle}
                        </span>
                      </div>
                      <div className='flex items-center gap-0.5 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity duration-200'>
                        {(r.visualType === 'BAR_CHART' ||
                          r.visualType === 'DATA_TABLE' ||
                          !r.visualType) && (
                          <Button
                            variant='ghost'
                            size='iconSm'
                            onClick={() => setExpandedQueryId(r.queryId)}
                            title='Expand view'
                            className='hover:bg-primary/10 hover:text-primary transition-colors'
                            data-track-category='ANALYTICS'
                            data-track-name='Expand_Query_Card'
                            data-track-metadata={JSON.stringify({
                              queryId: r.queryId,
                              visualType: r.visualType,
                            })}
                          >
                            <Maximize2 className='h-3.5 w-3.5' />
                          </Button>
                        )}
                        <Button
                          variant='ghost'
                          size='iconSm'
                          onClick={() => {
                            const query = queriesData.find(q2 => q2.id === r.queryId);
                            if (query) handleRefreshQuery(r.queryId, r.mappingId, query.queryJson);
                          }}
                          title='Refresh query'
                          className='hover:bg-primary/10 hover:text-primary transition-colors'
                          data-track-category='ANALYTICS'
                          data-track-name='Refresh_Query'
                          data-track-metadata={JSON.stringify({ queryId: r.queryId })}
                        >
                          <RefreshCw className='h-3.5 w-3.5' />
                        </Button>
                        {onEditQuery && (
                          <Button
                            variant='ghost'
                            size='iconSm'
                            onClick={() => {
                              const query = queriesData.find(q2 => q2.id === r.queryId);
                              if (query)
                                onEditQuery({
                                  id: query.id,
                                  title: query.title ?? '',
                                  queryJson: query.queryJson,
                                  visualType: query.visualType,
                                });
                            }}
                            title='Edit query'
                            className='hover:bg-primary/10 hover:text-primary transition-colors'
                            data-track-category='ANALYTICS'
                            data-track-name='Edit_Query'
                            data-track-metadata={JSON.stringify({ queryId: r.queryId })}
                          >
                            <Edit className='h-3.5 w-3.5' />
                          </Button>
                        )}
                        <Button
                          variant='ghost'
                          size='iconSm'
                          onClick={() => void handleDelete(r.queryId)}
                          title='Delete query'
                          className='hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400 transition-colors'
                          data-track-category='ANALYTICS'
                          data-track-name='Delete_Query'
                          data-track-metadata={JSON.stringify({ queryId: r.queryId })}
                        >
                          <Trash2 className='h-3.5 w-3.5' />
                        </Button>
                      </div>
                    </div>

                    <div className='flex-1 min-h-0 overflow-hidden p-3 flex flex-col'>
                      {r.isLoading ? (
                        <div className='flex items-center justify-center flex-1 text-sm text-muted-foreground'>
                          <div className='h-4 w-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary mr-2.5' />
                          <span>Loading...</span>
                        </div>
                      ) : r.error ? (
                        <div className='flex flex-col items-center justify-center flex-1 text-sm'>
                          <span className='text-red-600 dark:text-red-400 font-medium'>Error</span>
                          <span className='text-red-500/80 dark:text-red-400/70 text-xs mt-1'>
                            {r.error}
                          </span>
                        </div>
                      ) : !hasData ? (
                        <div className='flex flex-col items-center justify-center flex-1 text-sm text-muted-foreground'>
                          <span className='font-medium text-foreground/70'>No results found</span>
                        </div>
                      ) : r.visualType ? (
                        <div
                          className={cn(
                            'flex-1 min-h-0 flex flex-col rounded-xl bg-gradient-to-b from-background/50 to-transparent overflow-hidden',
                            !isKPI && 'p-2',
                          )}
                        >
                          <QueryVisualization
                            title=''
                            data={r.data}
                            visualizationType={r.visualType as QueryVisualizationType}
                            isLoading={false}
                            error={null}
                            fillHeight
                            className={cn(
                              'w-full h-full min-h-0 flex-1 rounded-none border-0 shadow-none overflow-auto p-4',
                              isKPI && 'border-0 p-2 bg-transparent overflow-visible',
                            )}
                          />
                        </div>
                      ) : (
                        <div className='flex-1 min-h-0 overflow-auto rounded-lg border border-border/30 bg-background/50'>
                          {r.data && <QueryResultFallbackTable data={r.data} />}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </GridLayout>
        )}
      </div>

      <Dialog
        open={expandedQueryId !== null}
        onOpenChange={open => !open && setExpandedQueryId(null)}
        className='max-w-6xl w-[90vw]'
        title={expandedResult?.queryTitle}
      >
        {expandedResult && (
          <div className='flex flex-col h-[85vh] p-4'>
            <div className='flex items-center justify-between mb-2 shrink-0'>
              <h2 className='text-lg font-bold truncate pr-4'>{expandedResult.queryTitle}</h2>
              <Button
                variant='ghost'
                size='iconSm'
                onClick={() => setExpandedQueryId(null)}
                title='Close'
                className='hover:bg-muted transition-colors'
                data-track-category='ANALYTICS'
                data-track-name='Close_Expanded_Query'
              >
                <X className='h-4 w-4' />
              </Button>
            </div>
            <div className='flex-1 min-h-0 overflow-auto'>
              {expandedResult.visualType ? (
                <QueryVisualization
                  title=''
                  data={expandedResult.data}
                  visualizationType={expandedResult.visualType as QueryVisualizationType}
                  isLoading={expandedResult.isLoading}
                  error={expandedResult.error}
                  fillHeight={true}
                  compact={true}
                  className='border-0 shadow-none'
                />
              ) : (
                <div className='overflow-auto rounded-lg border border-border/30 bg-background/50'>
                  {expandedResult.data && <QueryResultFallbackTable data={expandedResult.data} />}
                </div>
              )}
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
};

export default React.memo(QueryResults);
