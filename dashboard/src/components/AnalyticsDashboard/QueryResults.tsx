import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { apiInstance } from '../../services/clients/apiClient';
import { Trash2, RefreshCw, Edit, GripVertical, Save } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import type { Query as QueryType, Dashboard } from '@xyne/shared';
import { QueryVisualization } from '../QueryVisualizations/QueryVisualization';
import type { QueryVisualizationType } from '../QueryVisualizations/types';
import { cn } from '../../utils/classNames';
import { useZero } from '../../hooks/useZero';
import { mutators } from '../../zero/mutators';

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

// ─── Sortable card wrapper ────────────────────────────────────────────────────

interface SortableCardProps {
  id: string;
  children: (dragHandle: {
    ref: (node: HTMLElement | null) => void;
    listeners: ReturnType<typeof useSortable>['listeners'];
  }) => React.ReactNode;
}

const SortableCard: React.FC<SortableCardProps> = ({ id, children }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} className='break-inside-avoid mb-5'>
      {children({ ref: setActivatorNodeRef, listeners })}
    </div>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────

const QueryResults: React.FC<QueryResultsProps> = ({
  dashboardData,
  onDeleteQuery,
  onEditQuery,
}) => {
  const zero = useZero();

  // Track last queryJson per query to detect changes
  const lastQueryJsonRef = useRef<Record<string, string>>({});

  // Server-sorted mappings (by sequence, then createdAt)
  const sortedMappings = useMemo<MappingEntry[]>(() => {
    const mappings = (dashboardData?.queryMappings ?? []) as MappingEntry[];
    return [...mappings].sort((a, b) => {
      const seqDiff = (a.sequence ?? 0) - (b.sequence ?? 0);
      return seqDiff !== 0 ? seqDiff : a.createdAt - b.createdAt;
    });
  }, [dashboardData]);

  // Local drag order — array of mapping IDs
  const [orderedMappingIds, setOrderedMappingIds] = useState<string[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Sync local order from server when not dirty
  useEffect(() => {
    if (!isDirty) {
      setOrderedMappingIds(sortedMappings.map(m => m.id));
    }
  }, [sortedMappings, isDirty]);

  // Resolve ordered mappings from local ID order
  const orderedMappings = useMemo<MappingEntry[]>(() => {
    return orderedMappingIds
      .map(id => sortedMappings.find(m => m.id === id))
      .filter((m): m is MappingEntry => m !== undefined);
  }, [orderedMappingIds, sortedMappings]);

  const queriesData = useMemo<QueryType[]>(() => {
    return orderedMappings.map(m => m.query).filter((q): q is QueryType => q !== undefined);
  }, [orderedMappings]);

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
          const mapping = orderedMappings.find(m => m.queryId === r.queryId);
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
          const mapping = orderedMappings.find(m => m.queryId === q.id);
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
  }, [queriesData, orderedMappings]);

  // Auto-refresh when queryJson changes
  useEffect(() => {
    queriesData.forEach(q => {
      const currentJson = JSON.stringify(q.queryJson);
      const lastJson = lastQueryJsonRef.current[q.id];
      if (currentJson !== lastJson) {
        lastQueryJsonRef.current[q.id] = currentJson;
        const mapping = orderedMappings.find(m => m.queryId === q.id);
        void executeQuery(q.id, mapping?.id ?? '', q.queryJson);
      }
    });
  }, [queriesData, orderedMappings, executeQuery]);

  // ── Drag-and-drop ─────────────────────────────────────────────────────────────

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setOrderedMappingIds(prev => {
      const oldIndex = prev.indexOf(active.id as string);
      const newIndex = prev.indexOf(over.id as string);
      return arrayMove(prev, oldIndex, newIndex);
    });
    setIsDirty(true);
  }, []);

  const handleSaveOrder = useCallback(() => {
    setIsSaving(true);
    zero.mutate(
      mutators.query.reorder({
        orderedMappingIds,
        timestamp: Date.now(),
      }),
    );
    setIsDirty(false);
    setIsSaving(false);
  }, [zero, orderedMappingIds]);

  const handleRefreshQuery = useCallback(
    (queryId: string, mappingId: string, queryJson: unknown): void => {
      void executeQuery(queryId, mappingId, queryJson);
    },
    [executeQuery],
  );

  const handleDelete = (queryId: string): void => {
    onDeleteQuery(queryId);
  };

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

  const formatCellValue = (value: unknown): string => {
    if (value === null || value === undefined) return '-';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value as string | number | boolean);
  };

  // O(1) lookup map for results
  const resultsByQueryId = new Map<string, QueryResult>(results.map(r => [r.queryId, r]));

  return (
    <div>
      {/* Save Order banner */}
      {isDirty && (
        <div className='flex items-center justify-between mb-4 px-4 py-2.5 rounded-xl bg-primary/5 border border-primary/20'>
          <span className='text-sm text-foreground/70'>
            Drag to reorder · Click <strong>Save Order</strong> to persist
          </span>
          <div className='flex gap-2'>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => {
                setOrderedMappingIds(sortedMappings.map(m => m.id));
                setIsDirty(false);
              }}
            >
              Discard
            </Button>
            <Button
              size='sm'
              onClick={() => void handleSaveOrder()}
              disabled={isSaving}
              data-track-category='ANALYTICS'
              data-track-name='Save_Query_Order'
            >
              <Save className='w-3.5 h-3.5 mr-1.5' />
              {isSaving ? 'Saving…' : 'Save Order'}
            </Button>
          </div>
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={orderedMappingIds} strategy={rectSortingStrategy}>
          <div style={{ columnCount: 'auto', columnWidth: '450px', columnGap: '1.25rem' }}>
            {orderedMappings.map(mapping => {
              const q = mapping.query;
              if (!q) return null;
              const r = resultsByQueryId.get(q.id);
              if (!r) return null;

              return (
                <SortableCard key={mapping.id} id={mapping.id}>
                  {({ ref: dragHandleRef, listeners: dragListeners }) => {
                    const isKPI = r.visualType === 'KPI';
                    const hasData = r.data && r.data.length > 0;

                    return (
                      <div
                        className={cn(
                          'h-full group rounded-2xl border border-border/60 bg-gradient-to-br from-card via-card to-muted/10 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.02)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.08),0_8px_24px_rgba(0,0,0,0.04)] hover:border-border/80 transition-all duration-300 ease-out overflow-hidden flex flex-col backdrop-blur-sm',
                          r.error && 'border-red-200 dark:border-red-800/60',
                        )}
                      >
                        {/* Card Header */}
                        <div
                          ref={dragHandleRef}
                          {...dragListeners}
                          className='flex items-center justify-between px-4 py-3 border-b border-border/40 bg-gradient-to-r from-muted/30 via-muted/20 to-transparent cursor-grab active:cursor-grabbing touch-none'
                          title='Drag to reorder'
                        >
                          <div className='flex items-center gap-2 min-w-0'>
                            <div className='shrink-0 text-muted-foreground/40 hover:text-muted-foreground/80 transition-colors p-0.5 rounded'>
                              <GripVertical className='w-4 h-4' />
                            </div>
                            <div className='w-1.5 h-1.5 rounded-full bg-primary/60 shrink-0' />
                            <span className='text-sm font-semibold text-foreground/90 truncate'>
                              {r.queryTitle}
                            </span>
                          </div>
                          <div className='flex items-center gap-0.5 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity duration-200'>
                            <Button
                              variant='ghost'
                              size='iconSm'
                              onClick={() => {
                                const query = queriesData.find(q2 => q2.id === r.queryId);
                                if (query)
                                  handleRefreshQuery(r.queryId, r.mappingId, query.queryJson);
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

                        {/* Body Content - Loading, Error, No Data, or Visualization */}
                        <div className='min-h-0 overflow-hidden p-3'>
                          {r.isLoading ? (
                            <div className='flex items-center justify-center h-32 text-sm text-muted-foreground'>
                              <div className='h-4 w-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary mr-2.5' />
                              <span>Loading...</span>
                            </div>
                          ) : r.error ? (
                            <div className='flex flex-col items-center justify-center h-32 text-sm'>
                              <span className='text-red-600 dark:text-red-400 font-medium'>
                                Error
                              </span>
                              <span className='text-red-500/80 dark:text-red-400/70 text-xs mt-1'>
                                {r.error}
                              </span>
                            </div>
                          ) : !hasData ? (
                            <div className='flex flex-col items-center justify-center h-32 text-sm text-muted-foreground'>
                              <span className='font-medium text-foreground/70'>
                                No results found
                              </span>
                            </div>
                          ) : r.visualType ? (
                            <div
                              className={cn(
                                'rounded-xl bg-gradient-to-b from-background/50 to-transparent',
                                !isKPI && 'p-2',
                              )}
                            >
                              <QueryVisualization
                                title=''
                                data={r.data}
                                visualizationType={r.visualType as QueryVisualizationType}
                                isLoading={false}
                                error={null}
                                className={cn(
                                  'w-full rounded-none border-0 shadow-none p-4',
                                  isKPI && 'border-0 p-2 bg-transparent',
                                )}
                              />
                            </div>
                          ) : (
                            <div className='overflow-auto rounded-lg border border-border/30 bg-background/50'>
                              <table className='min-w-full divide-y divide-border/60 text-xs'>
                                <thead className='bg-gradient-to-b from-muted to-muted/70 sticky top-0 z-10'>
                                  <tr>
                                    {r.data &&
                                      r.data[0] &&
                                      Object.keys(r.data[0]).map(key => (
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
                                  {r.data &&
                                    r.data.map((row, index) => (
                                      <tr
                                        key={index}
                                        className='hover:bg-muted/40 transition-colors duration-150'
                                      >
                                        {Object.values(row).map((value, cellIndex) => (
                                          <td
                                            key={cellIndex}
                                            className='px-3 py-2 whitespace-nowrap text-[11px] text-foreground/80 font-medium'
                                          >
                                            {formatCellValue(value)}
                                          </td>
                                        ))}
                                      </tr>
                                    ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  }}
                </SortableCard>
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
};

export default React.memo(QueryResults);
