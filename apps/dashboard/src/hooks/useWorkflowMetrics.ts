import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { analyticsService, WorkflowMetricGroup } from '../services/Analytics/analyticsService';
import { getStatusConfig } from '../components/Tickets/ticketUtils';

export interface WorkflowTypeMetrics {
  workflowType: string;
  total: number;
  byStatus: {
    status: string;
    count: number;
    label: string;
    cssVar: string;
    Icon: React.FC<{ size: number }>;
  }[];
}

function processWorkflowMetrics(groups: WorkflowMetricGroup[] | undefined): WorkflowTypeMetrics[] {
  if (!groups || groups.length === 0) {
    return [];
  }

  const typeGroupMap = new Map<
    string,
    {
      total: number;
      labelMap: Map<string, { count: number; config: ReturnType<typeof getStatusConfig> }>;
    }
  >();

  for (const group of groups) {
    const wType = group.workflowType;
    if (!wType) continue; // Skip workflows without type

    if (!typeGroupMap.has(wType)) {
      typeGroupMap.set(wType, { total: 0, labelMap: new Map() });
    }
    const typeGroup = typeGroupMap.get(wType)!;
    const count = group._count.id;
    typeGroup.total += count;

    if (!group.status) continue;

    const s = group.status.toUpperCase();
    let unifiedLabel = 'Others';
    let configKey = 'NEW';

    if (s === 'RUNNING' || s === 'IN_PROGRESS') {
      unifiedLabel = 'Running';
      configKey = 'RUNNING';
    } else if (s === 'PENDING') {
      // PENDING in workflows often means active/evaluating
      unifiedLabel = 'In Progress';
      configKey = 'RUNNING';
    } else if (s === 'SCHEDULED' || s === 'PAUSED' || s === 'WAITING') {
      unifiedLabel = 'Paused / Waiting';
      configKey = 'PAUSED';
    } else if (s === 'FAILURE' || s === 'FAILED') {
      unifiedLabel = 'Failed';
      configKey = 'FAILED';
    } else if (s === 'SUCCESS' || s === 'COMPLETED') {
      unifiedLabel = 'Completed';
      configKey = 'COMPLETED';
    } else {
      unifiedLabel = 'Others';
      configKey = 'NEW';
    }

    const config = getStatusConfig(configKey);

    let customCssVar = config.cssVar;
    if (unifiedLabel === 'Running' || unifiedLabel === 'In Progress') customCssVar = '#3b82f6';
    else if (unifiedLabel === 'Paused / Waiting') customCssVar = '#f59e0b';
    else if (unifiedLabel === 'Failed') customCssVar = '#ef4444';
    else if (unifiedLabel === 'Completed') customCssVar = '#10b981';
    else customCssVar = '#6b7280';

    const customConfig = { ...config, label: unifiedLabel, cssVar: customCssVar };

    const existing = typeGroup.labelMap.get(unifiedLabel);
    if (existing) {
      existing.count += count;
    } else {
      typeGroup.labelMap.set(unifiedLabel, { count, config: customConfig });
    }
  }

  return Array.from(typeGroupMap.entries())
    .map(([workflowType, group]) => {
      const byStatus = Array.from(group.labelMap.values())
        .map(({ count, config }) => ({
          status: config.label,
          count,
          label: config.label,
          cssVar: config.cssVar,
          Icon: config.Icon,
        }))
        .sort((a, b) => b.count - a.count);

      return {
        workflowType,
        total: group.total,
        byStatus,
      };
    })
    .sort((a, b) => b.total - a.total);
}

export function useWorkflowMetrics(): {
  metrics: WorkflowTypeMetrics[];
  isLoading: boolean;
  error: Error | null;
} {
  const timeRangeParams = useMemo(() => {
    return { timeRange: '7d', groupBy: 'day' as const };
  }, []);

  const { data, isLoading, error } = useQuery({
    queryKey: ['analytics', 'workflowMetrics', timeRangeParams],
    queryFn: () => analyticsService.getWorkflowMetrics(timeRangeParams),
    refetchInterval: 20 * 1000, // Poll every 20s
  });

  const metrics = useMemo(() => processWorkflowMetrics(data?.data), [data]);

  return { metrics, isLoading, error };
}
