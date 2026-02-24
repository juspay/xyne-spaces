import React, { useState, useCallback, useMemo } from 'react';
import { CodeBlock, CodeBlockVariant } from '@juspay/blend-design-system';
import { Ticket } from '../../hooks/useTickets';
import { formatDuration, formatTimestamp } from '../../utils/dateUtils';
import { exportWorkflowStepsAsJson } from './utils/convertToCSV';
import { CombinedWorkflowData } from '../../services/Workflow/workflowGraphService.types';
import { flattenWorkflowSteps } from '../../services/Workflow/workflowGraphService.utils';

interface WorkflowTableViewProps {
  ticket: Ticket;
  executionId?: string;
  combinedStepsData: CombinedWorkflowData;
  loading?: boolean;
  onRefresh?: () => void;
}

const WorkflowTableView: React.FC<WorkflowTableViewProps> = ({
  ticket,
  executionId: _executionId,
  combinedStepsData,
  loading = false,
  onRefresh,
}) => {
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());

  // Process combined steps data into flattened steps
  const steps = useMemo(() => {
    if (!combinedStepsData) return [];
    const allSteps = combinedStepsData.workflows[0]?.steps || [];
    return flattenWorkflowSteps(allSteps);
  }, [combinedStepsData]);

  // Format step status for display
  const getStatusColor = (status?: string): string => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      case 'running':
        return 'bg-yellow-100 text-yellow-800';
      case 'pending':
        return 'bg-gray-100 text-gray-800';
      case 'paused':
        return 'bg-purple-100 text-purple-800';
      case 'skipped':
        return 'bg-blue-100 text-blue-800';
      case 'not_executed':
        return 'bg-gray-100 text-gray-600';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  // Handle step expansion
  const toggleStepExpansion = useCallback((stepId: string) => {
    setExpandedSteps(prev => {
      const newSet = new Set(prev);
      if (newSet.has(stepId)) {
        newSet.delete(stepId);
      } else {
        newSet.add(stepId);
      }
      return newSet;
    });
  }, []);

  const handleRefreshClick = useCallback(() => {
    onRefresh?.();
  }, [onRefresh]);

  const exportData = useCallback(() => {
    exportWorkflowStepsAsJson(steps, ticket);
  }, [ticket, steps]);

  if (loading) {
    return (
      <div className='flex items-center justify-center h-96'>
        <div className='text-center'>
          <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4' />
          <p className='text-gray-600'>Loading workflow steps...</p>
        </div>
      </div>
    );
  }

  return (
    <div className='px-4 py-6 bg-gray-50'>
      <div className='mx-auto bg-white rounded-lg shadow-sm border border-gray-200'>
        {/* Header */}
        <div className='p-6 border-b border-gray-200'>
          <div className='flex items-center justify-between'>
            <div>
              <h3 className='text-lg font-semibold text-gray-900'>
                Workflow Steps ({steps.length})
              </h3>
              <p className='text-sm text-gray-600 mt-1'>
                Click on any step to expand and view its details
              </p>
            </div>

            <div className='flex items-center gap-3'>
              {/* Refresh Button */}
              <button
                onClick={handleRefreshClick}
                className='flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg shadow-sm hover:bg-gray-50 hover:border-gray-400 transition-colors'
                title='Refresh workflow data'
                data-track-category='Workflows'
                data-track-name='RefreshTableData'
              >
                <svg className='w-4 h-4' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15'
                  />
                </svg>
                <span className='text-sm font-medium'>Refresh</span>
              </button>

              {/* Export Button */}
              <button
                onClick={exportData}
                className='flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg shadow-sm hover:bg-blue-700 transition-colors'
                title='Export workflow data'
                data-track-event='BUTTON_CLICK'
                data-track-category='WORKFLOWS'
                data-track-name='EXPORT_DATA'
                data-track-metadata={JSON.stringify({
                  ticketId: ticket.id,
                  stepCount: steps.length,
                })}
              >
                <svg className='w-4 h-4' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='M12 16v-8m0 0l-3 3m3-3l3 3M4 16h16'
                  />
                </svg>
                <span className='text-sm font-medium'>Export JSON</span>
              </button>
            </div>
          </div>
        </div>

        {/* Steps List */}
        <div className='max-h-[calc(100vh-300px)] min-h-[600px] overflow-y-auto'>
          {steps.length === 0 ? (
            <div className='p-8 text-center text-gray-500'>
              <svg
                className='w-12 h-12 mx-auto mb-4 text-gray-300'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth={2}
                  d='M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z'
                />
              </svg>
              <p className='text-lg font-medium'>No workflow steps found</p>
              <p className='text-sm'>
                The workflow may not have started yet or there might be an issue loading the data.
              </p>
            </div>
          ) : (
            <div className='divide-y divide-gray-200'>
              {steps.map((step, index) => {
                const isExpanded = expandedSteps.has(step.id);
                const isSubCall =
                  step.stepName?.startsWith('llm_call') ||
                  step.stepName?.startsWith('tool_') ||
                  step.stepName === 'user_message' ||
                  step.stepName === 'framework_error' ||
                  step.stepExecutorType === 'agent';
                const status = isSubCall
                  ? step.status || step.computedStatus || 'pending'
                  : step.computedStatus || step.status || 'pending';
                const statusColor = getStatusColor(status);

                return (
                  <div key={step.id} className='p-6 hover:bg-gray-50 transition-colors'>
                    {/* Step Header */}
                    <button
                      className='flex items-center justify-between w-full text-left focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 rounded-lg p-2 -m-2'
                      onClick={() => toggleStepExpansion(step.id)}
                      type='button'
                      data-track-category='Workflows'
                      data-track-name='ToggleStepExpansion'
                      data-track-metadata={JSON.stringify({
                        stepId: step.id,
                        stepName: step.stepName,
                      })}
                    >
                      <div className='flex items-center gap-4 flex-1'>
                        {/* Step Number */}
                        <div className='flex items-center justify-center w-8 h-8 bg-blue-100 text-blue-800 rounded-full text-sm font-semibold'>
                          {index + 1}
                        </div>

                        {/* Step Info */}
                        <div className='flex-1'>
                          <div className='flex items-center gap-3 mb-1'>
                            <h4 className='text-lg font-semibold text-gray-900'>
                              {step.stepName || 'Unknown Step'}
                            </h4>
                            <span
                              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusColor}`}
                            >
                              {status.charAt(0).toUpperCase() + status.slice(1)}
                            </span>
                          </div>

                          <div className='flex items-center gap-6 text-sm text-gray-600'>
                            <span>
                              <span className='font-medium'>Type:</span>{' '}
                              {step.stepExecutorType || 'Unknown'}
                            </span>
                            <span>
                              {step.duration && <span className='font-medium'>Duration:</span>}{' '}
                              {formatDuration(step?.duration)}
                            </span>
                            <span>
                              {step.updatedAt && <span className='font-medium'>Updated:</span>}{' '}
                              {formatTimestamp(step?.updatedAt)}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Expand/Collapse Icon */}
                      <div className='flex items-center gap-2'>
                        <span className='text-sm text-gray-500'>
                          {isExpanded ? 'Collapse' : 'Expand'}
                        </span>
                        <svg
                          className={`w-5 h-5 text-gray-400 transform transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                          fill='none'
                          stroke='currentColor'
                          viewBox='0 0 24 24'
                        >
                          <path
                            strokeLinecap='round'
                            strokeLinejoin='round'
                            strokeWidth={2}
                            d='M9 5l7 7-7 7'
                          />
                        </svg>
                      </div>
                    </button>

                    {/* Expanded Content */}
                    {isExpanded && (
                      <div className='mt-6 pl-12'>
                        <div className='space-y-6'>
                          {/* Basic Information */}
                          <div>
                            <h5 className='text-sm font-semibold text-gray-700 mb-3'>
                              Basic Information
                            </h5>
                            <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-sm'>
                              <div>
                                <span className='font-medium text-gray-600'>Step ID:</span>
                                <p className='mt-1 font-mono text-xs bg-gray-100 p-2 rounded break-all'>
                                  {step.id}
                                </p>
                              </div>
                              <div>
                                <span className='font-medium text-gray-600'>
                                  Workflow Execution ID:
                                </span>
                                <p className='mt-1 font-mono text-xs bg-gray-100 p-2 rounded break-all'>
                                  {step.workflowExecutionId || 'N/A'}
                                </p>
                              </div>
                              <div>
                                <span className='font-medium text-gray-600'>Step Type:</span>
                                <p className='mt-1'>{step.type || 'N/A'}</p>
                              </div>
                              <div>
                                <span className='font-medium text-gray-600'>Created:</span>
                                <p className='mt-1'>{formatTimestamp(step.createdAt)}</p>
                              </div>
                              <div>
                                <span className='font-medium text-gray-600'>Updated:</span>
                                <p className='mt-1'>{formatTimestamp(step.updatedAt)}</p>
                              </div>
                              <div>
                                <span className='font-medium text-gray-600'>Duration:</span>
                                <p className='mt-1'>{formatDuration(step.duration)}</p>
                              </div>
                            </div>
                          </div>

                          {/* Step Data */}
                          {step.data && (
                            <div>
                              <h5 className='text-sm font-semibold text-gray-700 mb-3'>
                                Step Data
                              </h5>
                              <CodeBlock
                                code={
                                  typeof step.data === 'string'
                                    ? step.data
                                    : JSON.stringify(step.data, null, 2)
                                }
                                variant={CodeBlockVariant.DEFAULT}
                                showLineNumbers={true}
                                showHeader={true}
                                header={`step-${index + 1}-data.json`}
                              />
                            </div>
                          )}

                          {/* Complete Step JSON */}
                          <div>
                            <h5 className='text-sm font-semibold text-gray-700 mb-3'>
                              Complete Step JSON
                            </h5>
                            <CodeBlock
                              code={JSON.stringify(step, null, 2)}
                              variant={CodeBlockVariant.DEFAULT}
                              showLineNumbers={true}
                              showHeader={true}
                              header={`step-${index + 1}-complete.json`}
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default WorkflowTableView;
