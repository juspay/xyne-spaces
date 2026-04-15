import { useQuery } from '@tanstack/react-query';
import { apiInstance } from '../../services/clients/apiClient';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LogQueryParams {
  startTime: string;
  endTime: string;
  email?: string | undefined;
  keyword?: string | undefined;
  level?: string | undefined;
  sessionId?: string | undefined;
  requestId?: string | undefined;
  container?: string | undefined;
  logsqlFilters?: string | undefined;
  limit?: number | undefined;
}

export interface LogsResponse {
  summary?: {
    total_entries: number;
    severity_counts: Record<string, number>;
  };
  generated_logsql?: string;
  raw_logs?: Array<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Logs Hook
// ---------------------------------------------------------------------------

export function useLogsQuery(params: LogQueryParams | null) {
  return useQuery({
    queryKey: ['inspector', 'logs', params],
    queryFn: async () => {
      if (!params) return null;
      try {
        const searchParams = new URLSearchParams();
        searchParams.set('startTime', params.startTime);
        searchParams.set('endTime', params.endTime);
        if (params.email) searchParams.set('email', params.email);
        if (params.keyword) searchParams.set('keyword', params.keyword);
        if (params.level) searchParams.set('level', params.level);
        if (params.sessionId) searchParams.set('sessionId', params.sessionId);
        if (params.requestId) searchParams.set('requestId', params.requestId);
        if (params.container) searchParams.set('container', params.container);
        if (params.logsqlFilters) searchParams.set('logsqlFilters', params.logsqlFilters);
        if (params.limit) searchParams.set('limit', String(params.limit));

        const response = await apiInstance.get<LogsResponse>(
          `/inspectorTools/logs?${searchParams.toString()}`,
        );
        return response.data;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to fetch logs';
        throw new Error(message);
      }
    },
    enabled: !!params,
    staleTime: 30 * 1000,
    retry: false,
  });
}
