import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useWorkflowMetrics } from '../../hooks/useWorkflowMetrics';

export const WorkflowMetricsBlock: React.FC = () => {
  const { metrics: metricsGroups, isLoading, error } = useWorkflowMetrics();
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div data-id='workflow-metrics-container' className='flex flex-col items-start'>
      {/* Header row - clickable to expand/collapse */}
      <button
        type='button'
        onClick={() => setIsExpanded(!isExpanded)}
        className='flex items-center gap-2 px-4 py-2 sm:px-6 hover:bg-muted/50 transition-colors cursor-pointer'
        data-track-category='workflow-metrics'
        data-track-name='toggle-expand'
      >
        {isExpanded ? (
          <ChevronDown size={16} className='text-muted-foreground' />
        ) : (
          <ChevronRight size={16} className='text-muted-foreground' />
        )}
        <span className='text-sm font-semibold text-foreground'>Metrics</span>
        <div className='flex items-center bg-muted text-muted-foreground text-xs font-medium px-2 py-0.5 rounded-full border border-border'>
          Past 7 days
        </div>
      </button>

      {/* Collapsible cards section */}
      {isExpanded && (
        <div className='flex items-stretch gap-3 px-4 py-2 sm:gap-4 sm:px-6'>
          <div className='flex flex-wrap items-stretch gap-3 flex-1'>
            {isLoading ? (
              <div className='flex items-center text-sm text-muted-foreground py-2 w-full'>
                Loading metrics...
              </div>
            ) : error ? (
              <div className='flex items-center text-sm text-red-500 py-2 w-full'>
                Failed to load metrics.
              </div>
            ) : metricsGroups.length === 0 ? (
              <div className='flex items-center text-sm text-muted-foreground italic py-2 w-full'>
                No workflow data from the past week.
              </div>
            ) : (
              metricsGroups.map(group => (
                <div
                  key={group.workflowType}
                  className='flex flex-col gap-3 sm:gap-4 border border-border bg-card rounded-lg sm:rounded-xl p-3 sm:p-5 shadow-sm min-w-0 w-auto'
                >
                  {/* Total stats for Workflow Type */}
                  <div className='flex flex-col gap-1.5 w-full pb-2 sm:pb-3 border-b border-border'>
                    <span
                      className='text-xs font-semibold text-foreground truncate tracking-wider'
                      title={group.workflowType}
                    >
                      {group.workflowType}
                    </span>
                    <div className='flex items-baseline gap-1.5'>
                      <span className='text-xl font-bold text-foreground leading-none'>
                        {group.total}
                      </span>
                      <span className='text-xs text-muted-foreground font-medium'>
                        Total Workflows
                      </span>
                    </div>
                  </div>

                  {/* Breakdown by Status */}
                  <div className='flex flex-wrap items-center gap-x-4 gap-y-3 w-full'>
                    {group.byStatus.length === 0 ? (
                      <span className='text-sm text-muted-foreground italic py-1'>
                        No status data
                      </span>
                    ) : (
                      group.byStatus.map(({ status, count, label, cssVar, Icon }) => (
                        <div
                          key={status}
                          className='flex flex-col gap-1.5 shrink-0'
                          title={`${label}: ${count}`}
                        >
                          <div className='flex items-center gap-1.5'>
                            <span style={{ color: cssVar }}>
                              <Icon size={14} />
                            </span>
                            <span className='text-xs font-medium' style={{ color: cssVar }}>
                              {label}
                            </span>
                          </div>
                          <span className='text-base font-semibold leading-none text-foreground'>
                            {count}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
