import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { apiInstance } from '../../services/clients/apiClient';
import { Trash2, RefreshCw, Edit } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import type { Query as QueryType, Dashboard } from '@xyne/shared';

interface DashboardWithQueries extends Dashboard {
  queryMappings?: ReadonlyArray<{
    id: string;
    dashboardId: string;
    queryId: string;
    createdAt: number;
    updatedAt: number;
    query: QueryType | undefined;
  }>;
}

interface QueryResultsProps {
  dashboardData: DashboardWithQueries | null | undefined;
  onDeleteQuery: (queryId: string) => void;
  onEditQuery?: (query: { id: string; title: string; queryJson: unknown }) => void;
}

interface QueryResult {
  queryId: string;
  queryTitle: string;
  isLoading: boolean;
  data: Record<string, unknown>[] | null;
  error: string | null;
}

const QueryResults: React.FC<QueryResultsProps> = ({
  dashboardData,
  onDeleteQuery,
  onEditQuery,
}) => {
  // Track last queryJson for each query - to detect changes
  const lastQueryJsonRef = useRef<Record<string, string>>({});

  // Extract queries from dashboard data
  const queriesData = useMemo(() => {
    const mappings = dashboardData?.queryMappings ?? [];
    return mappings
      .map((m): QueryType | null => m.query || null)
      .filter((q): q is QueryType => q !== null)
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [dashboardData]);

  const [results, setResults] = useState<QueryResult[]>([]);

  const executeQuery = useCallback(async (queryId: string, queryJson: unknown): Promise<void> => {
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
            ? {
                ...r,
                isLoading: false,
                error: 'Failed to execute query',
              }
            : r,
        ),
      );
    }
  }, []);

  // Update results when queries change
  useEffect(() => {
    setResults(prev => {
      const queryIds = new Set(queriesData.map(q => q.id));
      const keptResults = prev
        .filter(r => queryIds.has(r.queryId))
        .map(r => {
          const query = queriesData.find(q => q.id === r.queryId);
          if (query && query.title !== r.queryTitle) {
            return { ...r, queryTitle: query.title };
          }
          return r;
        });
      // Add new queries with loading state
      const newResults = queriesData
        .filter(q => !keptResults.some(r => r.queryId === q.id))
        .map(q => ({
          queryId: q.id,
          queryTitle: q.title,
          isLoading: true,
          data: null,
          error: null,
        }));
      return [...keptResults, ...newResults];
    });
  }, [queriesData]);

  // Data-driven refresh: when queryJson changes, auto-refresh only that query
  useEffect(() => {
    queriesData.forEach(q => {
      const currentJson = JSON.stringify(q.queryJson);
      const lastJson = lastQueryJsonRef.current[q.id];

      if (currentJson !== lastJson) {
        // queryJson changed - refresh this query
        lastQueryJsonRef.current[q.id] = currentJson;
        void executeQuery(q.id, q.queryJson);
      }
    });
  }, [queriesData, executeQuery]);

  const handleRefreshQuery = useCallback(
    (queryId: string, queryJson: unknown): void => {
      void executeQuery(queryId, queryJson);
    },
    [executeQuery],
  );

  const handleDelete = (queryId: string): void => {
    onDeleteQuery(queryId);
  };

  if (queriesData.length === 0) {
    return (
      <div className='flex items-center justify-center h-32 text-gray-500'>
        No queries created yet
      </div>
    );
  }

  const formatCellValue = (value: unknown): string => {
    if (value === null || value === undefined) {
      return '-';
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return String(value as string | number | boolean);
  };

  const hasAggregations = (queryJson: unknown): boolean => {
    const q = queryJson as { aggregations?: unknown };
    return !!(q.aggregations && Array.isArray(q.aggregations) && q.aggregations.length > 0);
  };

  return (
    <div className='flex flex-col gap-3'>
      {results.map(r => {
        const originalQuery = queriesData.find(q => q.id === r.queryId);
        const isAggregation = originalQuery && hasAggregations(originalQuery.queryJson);
        const resultLabel = isAggregation ? 'groups' : 'rows';

        return (
          <div key={r.queryId} className='border border-gray-200 rounded-lg overflow-hidden'>
            {/* Query Header */}
            <div className='flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200'>
              <div className='flex items-center gap-2'>
                {r.isLoading && (
                  <div className='h-3 w-3 animate-spin rounded-full border-2 border-gray-300 border-t-gray-900' />
                )}
                <h4 className='text-xs font-semibold text-gray-900'>{r.queryTitle}</h4>
                {isAggregation && (
                  <span className='text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded'>
                    AGG
                  </span>
                )}
                {!r.isLoading && r.data && (
                  <span className='text-[10px] text-gray-500'>
                    ({r.data.length} {resultLabel})
                  </span>
                )}
                {r.error && <span className='text-[10px] text-red-500'>{r.error}</span>}
              </div>
              <div className='flex items-center gap-1'>
                <Button
                  variant='ghost'
                  size='iconSm'
                  onClick={() => {
                    const query = queriesData.find(q => q.id === r.queryId);
                    if (query) handleRefreshQuery(r.queryId, query.queryJson);
                  }}
                  disabled={r.isLoading}
                  title='Refresh query'
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${r.isLoading ? 'animate-spin' : ''}`} />
                </Button>
                {onEditQuery && (
                  <Button
                    variant='ghost'
                    size='iconSm'
                    onClick={() => {
                      const query = queriesData.find(q => q.id === r.queryId);
                      if (query) onEditQuery(query);
                    }}
                    disabled={r.isLoading}
                    title='Edit query'
                  >
                    <Edit className='h-3.5 w-3.5' />
                  </Button>
                )}
                <Button
                  variant='ghost'
                  size='iconSm'
                  onClick={() => void handleDelete(r.queryId)}
                  title='Delete query'
                >
                  <Trash2 className='h-3.5 w-3.5' />
                </Button>
              </div>
            </div>

            {/* Query Results Table */}
            {r.isLoading ? (
              <div className='flex items-center justify-center h-24 text-xs text-gray-500'>
                Loading results...
              </div>
            ) : r.error ? (
              <div className='flex items-center justify-center h-24 text-xs text-red-500'>
                {r.error}
              </div>
            ) : r.data && r.data.length > 0 ? (
              <div className='overflow-auto' style={{ maxHeight: '150px' }}>
                <table className='min-w-full divide-y divide-gray-200 text-xs'>
                  <thead className='bg-gray-50 sticky top-0'>
                    <tr>
                      {Object.keys(r.data[0]!).map(key => (
                        <th
                          key={key}
                          className='px-2 py-1.5 text-left text-[10px] font-medium text-gray-500 uppercase tracking-wider'
                        >
                          {key}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className='bg-white divide-y divide-gray-200'>
                    {r.data.map((row, index) => (
                      <tr key={index}>
                        {Object.values(row).map((value, cellIndex) => (
                          <td
                            key={cellIndex}
                            className='px-2 py-1.5 whitespace-nowrap text-[11px] text-gray-900'
                          >
                            {formatCellValue(value)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className='flex items-center justify-center h-24 text-xs text-gray-500'>
                No results
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default React.memo(QueryResults);
