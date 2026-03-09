import React, { JSX, useMemo, useState } from 'react';
import { getWorkflowIcon } from '../../assets/icons/WorkflowIcons';
import {
  StepDetailsResponse,
  WorkflowStepData,
} from '../../services/Workflow/workflowGraphService.types';
import { AgentStepRenderer } from './AgentStepRenderer/StepRenderer';
import { formatWorkflowDate } from '../../utils/dateUtils';
import { formatStepData, extractGitInfo, convertRepoToHttp } from './utils/utils';
import { ChevronLeft, ChevronRight, Send } from 'lucide-react';
import { useWorkflowControl } from '../../services/Workflow/workflowGraphService';
import { toast } from 'sonner';

interface StepInputContext {
  id?: string;
  workflowExecutionId?: string;
  [key: string]: unknown;
}

export interface StepDetailsProps {
  step: (StepDetailsResponse & { workflowStepIds: string[] }) | null;
  onNavigateAttempt?: (direction: 'previous' | 'next') => void;
  executionId?: string;
}

const StepDetails: React.FC<StepDetailsProps> = ({ step, onNavigateAttempt }) => {
  // Workflow control hooks
  const { continueAgenticStep, isContinuing, continueError, resetContinue } = useWorkflowControl();

  // State for continuation input
  const [continuationMessage, setContinuationMessage] = useState('');

  const originalStep = useMemo(() => step?.originalStep, [step]);

  /** ---------------------------------------
   *  Loop Attempt Metadata (header only)
   *  -------------------------------------- */

  const stepIds = useMemo(() => {
    const ids = step?.workflowStepIds ?? [];
    return Array.from(new Set(ids)); // dedupe
  }, [step?.workflowStepIds]);

  const totalAttempts = stepIds.length;

  const currentAttempt = useMemo(() => {
    if (!originalStep?.id) return undefined;

    const idx = stepIds.findIndex(id => id === originalStep.id);
    return idx >= 0 ? idx + 1 : undefined;
  }, [stepIds, originalStep?.id]);

  /** ---------------------------------------
   *  Check if audit section should be shown
   *  -------------------------------------- */

  const shouldShowAudit = useMemo((): boolean => {
    return originalStep?.stepExecutorType?.toLowerCase() === 'agent';
  }, [originalStep]);

  const gitInfo = useMemo(() => {
    return extractGitInfo(step?.output?.data?.['gitInfo']);
  }, [step?.output?.data]);

  /** ---------------------------------------
   *  Continue agentic step handler
   *  -------------------------------------- */

  const handleContinueAgenticStep = (): void => {
    if (!continuationMessage.trim()) {
      toast.error('Continue Failed', {
        description: 'Please enter a message to continue the agent',
        duration: 5000,
      });
      return;
    }

    // Use the INPUT step ID, not the OUTPUT step ID
    // step.input contains the INPUT step data
    const inputStepId = (step?.input?.context as StepInputContext)?.id;
    const executionId =
      (step?.input?.context as StepInputContext)?.workflowExecutionId ||
      originalStep?.workflowExecutionId ||
      '';

    if (!inputStepId || !executionId) {
      toast.error('Continue Failed', {
        description: 'Missing input step ID or execution ID',
        duration: 5000,
      });
      return;
    }

    resetContinue(); // Clear any previous errors
    continueAgenticStep({
      executionId,
      stepId: inputStepId,
      message: continuationMessage.trim(),
    });

    // Clear input and show success notification
    setContinuationMessage('');
    toast.success('Continuation Started', {
      description: 'Agent is continuing with your additional context',
      duration: 3000,
    });
  };

  /** ---------------------------------------
   *  Helpers
   *  -------------------------------------- */

  const renderStepData = (
    data: WorkflowStepData | null | undefined,
    isInput = false,
  ): JSX.Element => {
    if (!data) {
      return (
        <div className='flex flex-col items-center justify-center py-6 text-center'>
          <p className='text-muted-foreground text-sm'>
            No {isInput ? 'input' : 'output'} data available for this step.
          </p>
        </div>
      );
    }

    return (
      <div className='bg-slate-50 rounded-md p-3 border border-slate-100 overflow-safe w-full'>
        <pre className='text-xs text-foreground overflow-y-auto overflow-x-hidden max-h-80 min-w-0 w-full font-mono leading-relaxed text-wrap'>
          {formatStepData(data)}
        </pre>
      </div>
    );
  };

  if (!step || !originalStep) {
    return (
      <div className='flex items-center justify-center h-64 bg-background'>
        <div className='text-center'>
          <div className='w-10 h-10 rounded-full bg-muted flex items-center justify-center mx-auto mb-2'>
            <ChevronRight size={18} className='text-muted-foreground' />
          </div>
          <p className='text-muted-foreground text-sm'>Select a step to view details</p>
        </div>
      </div>
    );
  }

  /** ---------------------------------------
   *  Section Renderers
   *  -------------------------------------- */

  const renderSummarySection = (): JSX.Element => (
    <div className='space-y-3'>
      <h3 className='text-sm font-semibold text-foreground border-b border-border pb-2'>Summary</h3>
      <div className='grid grid-cols-1 md:grid-cols-2 gap-3'>
        <div className='bg-slate-50 rounded-md p-3 border border-slate-100'>
          <div className='flex items-center gap-1.5 mb-1'>
            {getWorkflowIcon('code', { size: 12, className: 'text-muted-foreground' })}
            <span className='text-xs font-medium text-muted-foreground'>Executor Type</span>
          </div>
          <p className='text-sm text-foreground font-medium'>
            {originalStep.stepExecutorType?.toLocaleUpperCase()}
          </p>
        </div>

        <div className='bg-slate-50 rounded-md p-3 border border-slate-100'>
          <div className='flex items-center gap-1.5 mb-1'>
            {getWorkflowIcon('clock', { size: 12, className: 'text-muted-foreground' })}
            <span className='text-xs font-medium text-muted-foreground'>Created</span>
          </div>
          <p className='text-sm text-foreground'>{formatWorkflowDate(originalStep.createdAt)}</p>
        </div>

        <div className='bg-slate-50 rounded-md p-3 border border-slate-100'>
          <div className='flex items-center gap-1.5 mb-1'>
            {getWorkflowIcon('clock', { size: 12, className: 'text-muted-foreground' })}
            <span className='text-xs font-medium text-muted-foreground'>Updated</span>
          </div>
          <p className='text-sm text-foreground'>{formatWorkflowDate(originalStep.updatedAt)}</p>
        </div>

        {gitInfo && (
          <>
            <div className='bg-slate-50 rounded-md p-3 border border-slate-100'>
              <div className='flex items-center gap-1.5 mb-1'>
                {getWorkflowIcon('code', { size: 12, className: 'text-muted-foreground' })}
                <span className='text-xs font-medium text-muted-foreground'>Branch</span>
              </div>
              <a
                href={`${convertRepoToHttp(gitInfo.repoUrl)}/commits?until=refs/heads/${encodeURIComponent(gitInfo.branch)}`}
                target='_blank'
                rel='noopener noreferrer'
                className='text-sm text-blue-600 hover:underline break-all'
              >
                {gitInfo.branch}
              </a>
            </div>

            {gitInfo.pr_link && (
              <div className='bg-slate-50 rounded-md p-3 border border-slate-100'>
                <div className='flex items-center gap-1.5 mb-1'>
                  {getWorkflowIcon('git', { size: 12, className: 'text-muted-foreground' })}
                  <span className='text-xs font-medium text-muted-foreground'>Pull Request</span>
                </div>
                <a
                  href={gitInfo.pr_link}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='text-sm text-emerald-600 hover:underline break-all'
                >
                  Open Pull Request
                </a>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );

  const renderInputSection = (): JSX.Element => (
    <div className='space-y-3'>
      <h3 className='text-sm font-semibold text-foreground border-b border-border pb-2'>Input</h3>
      {renderStepData(step.input?.data, true)}
    </div>
  );

  const renderAuditSection = (): JSX.Element | null => {
    if (!shouldShowAudit) {
      return null;
    }

    console.log('exec.steps', originalStep?.expandedExecutions);

    const executions = originalStep?.expandedExecutions ?? step?.output?.expandedExecutions ?? [];

    if (!executions.length) {
      return (
        <div className='space-y-3'>
          <h3 className='text-sm font-semibold text-foreground border-b border-border pb-2'>
            Audit Trail
          </h3>
          <div className='text-sm text-muted-foreground bg-slate-50 p-3 rounded-md border border-slate-100'>
            No audit data available for this step.
          </div>
        </div>
      );
    }

    return (
      <div className='space-y-3 overflow-safe'>
        <h3 className='text-sm font-semibold text-foreground border-b border-border pb-2'>
          Audit Trail
        </h3>
        {executions.map(exec => (
          <div
            key={exec?.executionId}
            className='bg-slate-50 rounded-md p-3 border border-slate-100 overflow-safe'
          >
            <div className='text-xs font-medium text-muted-foreground mb-2 break-all'>
              Execution: <span className='text-foreground'>{exec?.executionId}</span>
            </div>

            <div className='space-y-1.5 overflow-safe'>
              {exec.steps.map(s => (
                <div key={s.id} className='text-sm text-foreground overflow-safe'>
                  <AgentStepRenderer step={s} />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderContinuationSection = (): JSX.Element | null => {
    // Only show for completed agentic steps
    if (
      !shouldShowAudit ||
      !['COMPLETED', 'FAILURE', 'SUCCESS'].includes(step?.workflowExecution?.status)
    ) {
      return null;
    }

    return (
      <div className='space-y-3'>
        <h3 className='text-sm font-semibold text-foreground border-b border-border pb-2'>
          Continue Agent
        </h3>
        <div className='bg-slate-50 rounded-md p-3 border border-slate-100'>
          <p className='text-xs text-muted-foreground mb-2'>
            Provide additional context or instructions to continue this agent step.
          </p>
          <textarea
            value={continuationMessage}
            onChange={e => setContinuationMessage(e.target.value)}
            placeholder='Enter additional context or instructions...'
            className='w-full p-2 border border-border rounded-md resize-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400 text-sm'
            rows={2}
            disabled={isContinuing}
            data-track-category='Workflows'
            data-track-name='AgentContinuationInput'
          />
          <div className='flex items-center justify-between mt-2'>
            <div className='flex-1'>
              {continueError && <p className='text-xs text-red-500'>{continueError.message}</p>}
            </div>
            <button
              onClick={handleContinueAgenticStep}
              disabled={isContinuing || !continuationMessage.trim()}
              className='flex items-center gap-1.5 px-3 py-1.5 bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-xs font-medium'
              data-track-category='Workflows'
              data-track-name='ContinueAgenticStep'
            >
              {isContinuing ? (
                <>
                  <span className='animate-spin'>⏳</span>
                  Continuing...
                </>
              ) : (
                <>
                  <Send size={12} />
                  Continue
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderOutputSection = (): JSX.Element | null => {
    if (shouldShowAudit) {
      return null;
    }
    return (
      <div className='space-y-3'>
        <h3 className='text-sm font-semibold text-foreground border-b border-border pb-2'>
          Output
        </h3>
        {renderStepData(step.output?.data, false)}
      </div>
    );
  };

  return (
    <div
      className='h-full bg-background flex flex-col overflow-hidden'
      style={{ maxWidth: '100%', width: '100%' }}
      data-id='step-details'
    >
      {/* Header */}
      <div className='border-b border-border px-4 py-3 flex-shrink-0'>
        <div className='flex items-center justify-center gap-2'>
          {totalAttempts > 1 && currentAttempt && (
            <button
              onClick={() => onNavigateAttempt && onNavigateAttempt('previous')}
              disabled={currentAttempt === 1}
              className='disabled:opacity-30 hover:bg-muted p-1 rounded transition-colors'
              data-track-category='Workflows'
              data-track-name='NavigateToPreviousStepAttempt'
              data-track-metadata={JSON.stringify({
                stepId: originalStep?.id,
                currentAttempt,
                totalAttempts,
              })}
            >
              <ChevronLeft size={14} className='text-muted-foreground' />
            </button>
          )}

          <h3
            className='text-sm font-semibold text-foreground truncate flex items-center gap-1.5'
            title={step.stepName ?? ''}
          >
            {step.stepName}
            {totalAttempts > 1 && currentAttempt && (
              <span className='text-xs text-muted-foreground font-medium'>
                ({currentAttempt}/{totalAttempts})
              </span>
            )}
          </h3>

          {totalAttempts > 1 && currentAttempt && (
            <button
              onClick={() => onNavigateAttempt && onNavigateAttempt('next')}
              disabled={currentAttempt === totalAttempts}
              className='disabled:opacity-30 hover:bg-muted p-1 rounded transition-colors'
              data-track-category='Workflows'
              data-track-name='NavigateToNextStepAttempt'
              data-track-metadata={JSON.stringify({
                stepId: originalStep?.id,
                currentAttempt,
                totalAttempts,
              })}
            >
              <ChevronRight size={14} className='text-muted-foreground' />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className='flex-1 overflow-y-auto overflow-x-hidden p-4 min-w-0 word-break-safe'>
        <div className='space-y-5 min-w-0 w-full word-break-safe'>
          {renderSummarySection()}
          {renderInputSection()}
          {renderAuditSection()}
          {renderContinuationSection()}
          {renderOutputSection()}
        </div>
      </div>
    </div>
  );
};

export default StepDetails;
