import { Copy, ExternalLink, CircleCheck, GitBranch, RefreshCw, X } from 'lucide-react';
import {
  formatStepName,
  getExecutionTimeDisplay,
  MessageMetadata,
} from '../../ui/MessageBubble/MessageBubble.utils';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { queries } from '../../../zero/queries';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { rerunWorkflowFromStart } from '../../../services/Workflow/workflowService';
import { calculateExecutionTime } from '../../Workflows/utils/utils';
import { toast } from 'sonner';
import { Button } from '../../ui/Button/Button';
import { cn } from '../../../utils/classNames';
import Tooltip from '../../ui/Tooltip';
import { LAST_WORKFLOW_PATH_KEY } from '../../Tickets/constants';

interface WorkflowBubbleProps {
  workflowName: string | undefined;
  workflowStatus?: string | undefined;
  createdAt: number;
  ticketId: string | undefined;
  metadata: MessageMetadata;
  workflowNumber?: number | undefined;
}

export const WorkflowBubble: React.FC<WorkflowBubbleProps> = ({
  workflowName,
  workflowStatus,
  createdAt,
  ticketId,
  metadata,
  workflowNumber,
}) => {
  const navigate = useNavigate();
  const [isRerunning, setIsRerunning] = useState(false);
  const [showAllSteps, setShowAllSteps] = useState(false);

  const totalSteps =
    (metadata?.completedSteps?.length || 0) + (metadata?.pendingSteps?.length || 0);
  const hasMoreSteps = totalSteps > 3;

  // Get latest execution for this workflow
  const [workflows] = useCachedQuery(queries.getWorkflowForTicket({ ticketId: ticketId || '' }), {
    enabled: !!ticketId,
  });

  const completedIds = new Set((metadata?.completedSteps || []).map(s => s.stepName));
  const filteredPending = (metadata?.pendingSteps || []).filter(s => !completedIds.has(s.stepName));

  // Find the latest execution for this workflow
  const targetWorkflow = workflows?.find(w => w.id === metadata.workflowId) || workflows?.[0];
  const executions = targetWorkflow?.workflowExecutions;
  const rootExecutions = executions?.filter(e => !e.parentWorkflowExecutionId);
  const latestExecution =
    rootExecutions && rootExecutions.length > 0
      ? rootExecutions.reduce((latest, current) => {
          const latestTime = new Date(latest.updatedAt ?? latest.createdAt ?? 0).getTime();
          const currentTime = new Date(current.updatedAt ?? current.createdAt ?? 0).getTime();
          return currentTime > latestTime ? current : latest;
        })
      : undefined;

  const displayStatus =
    latestExecution?.status ?? metadata.workflowStatus ?? workflowStatus ?? 'PENDING';

  const displayExecutionTime = calculateExecutionTime(
    metadata.executionTime,
    latestExecution,
    displayStatus,
  );

  const displayMetadataForTime = {
    workflowStatus: displayStatus as MessageMetadata['workflowStatus'],
    executionTime: displayExecutionTime,
    rerunStartTime: metadata.rerunStartTime,
  } as MessageMetadata;

  const handleRerun = async (): Promise<void> => {
    if (!latestExecution?.id || isRerunning) return;

    setIsRerunning(true);
    try {
      await rerunWorkflowFromStart(latestExecution.id);
      toast.success('Success', {
        description: 'Workflow rerun initiated successfully',
        duration: 3000,
      });
    } catch {
      toast.error('Error', {
        description: 'Failed to rerun workflow',
        duration: 3000,
      });
    } finally {
      setIsRerunning(false);
    }
  };

  return (
    <div className='flex flex-col bg-card border border-border p-3 gap-3 rounded-xl transition-all duration-200 hover:shadow-md'>
      <div className='flex justify-between items-center gap-2 min-w-0'>
        <div className='flex items-center gap-2 min-w-0 flex-1'>
          {workflowNumber !== undefined && (
            <span className='inline-flex items-center justify-center flex-shrink-0 min-w-[28px] h-6 px-2 bg-muted text-primary text-xs font-bold rounded-full border border-border'>
              #{workflowNumber}
            </span>
          )}
          <Tooltip content={workflowName || ''}>
            <span className='font-[15px] text-foreground truncate block max-w-[200px] sm:max-w-[300px] md:max-w-[400px]'>
              {workflowName}
            </span>
          </Tooltip>
          {workflowName && (
            <button
              onClick={() => {
                void navigator.clipboard.writeText(workflowName);
              }}
              aria-label='Copy workflow name'
              data-track-category='WORKFLOW_BUBBLE'
              data-track-name='COPY_WORKFLOW_NAME'
              data-track-metadata={JSON.stringify({ workflowName, ticketId })}
            >
              <Copy size={12} className='text-muted-foreground' />
            </button>
          )}
        </div>

        <div className='flex items-center gap-2'>
          {displayStatus === 'FAILED' && (
            <Button
              variant='secondary'
              size='sm'
              onClick={() => {
                void handleRerun();
              }}
              disabled={isRerunning || !latestExecution?.id}
              className='flex items-center gap-1'
              title='Rerun workflow from start'
              data-track-category='WORKFLOW_BUBBLE'
              data-track-name='RERUN_WORKFLOW'
              data-track-metadata={JSON.stringify({
                ticketId,
                latestExecutionId: latestExecution?.id,
              })}
            >
              <RefreshCw size={12} className={isRerunning ? 'animate-spin' : ''} />
              {isRerunning ? 'Rerunning...' : 'Rerun'}
            </Button>
          )}
          <ExternalLink
            cursor={'pointer'}
            onClick={e => {
              e.stopPropagation();
              sessionStorage.removeItem(LAST_WORKFLOW_PATH_KEY);
              const workflowNumberParam = workflowNumber ? `?workflowNumber=${workflowNumber}` : '';
              const workflowUrl = metadata?.workflowId
                ? `/tickets/${ticketId}/workflow/${metadata.workflowId}${workflowNumberParam}`
                : `/tickets/${ticketId}/workflow${workflowNumberParam}`;
              void navigate(workflowUrl);
            }}
            className='text-muted-foreground'
            size={14}
            data-track-category='WORKFLOW_BUBBLE'
            data-track-name='OPEN_WORKFLOW_DETAILS'
            data-track-metadata={JSON.stringify({ ticketId, workflowId: metadata?.workflowId })}
          />
        </div>
      </div>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='text-muted-foreground font-medium text-[13px]'>
          {getExecutionTimeDisplay(displayMetadataForTime, new Date(createdAt))}
        </span>
        <span
          className={cn(
            'text-xs font-medium px-2 py-0.5 rounded-full',
            displayStatus === 'SUCCESS' &&
              'bg-stage-completed border border-stage-completed-border text-status-success',
            displayStatus === 'FAILURE' && 'bg-destructive/10 text-destructive',
            displayStatus === 'PENDING' && 'bg-muted text-muted-foreground',
          )}
        >
          {displayStatus}
        </span>
      </div>
      {metadata?.gitInfo && (
        <div className='bg-card border border-border rounded-xl p-4 flex flex-col gap-2'>
          <div className='flex items-center gap-2.5'>
            <span className='font-medium text-foreground'>Changes made in </span>
            <span className='font-medium bg-muted rounded-md px-2 py-1 text-sm'>
              {metadata.gitInfo.repoUrl?.split('/').pop()?.replace('.git', '')}
            </span>
          </div>

          <div className='flex flex-col text-sm text-muted-foreground gap-2'>
            <div className='flex items-center gap-3 mt-1'>
              <span className='font-medium text-foreground'>
                <GitBranch size={14} />
              </span>
              <span className='font-medium  hover:underline cursor-pointer'>
                {metadata.gitInfo?.branch}
              </span>
              <Copy
                size={12}
                className='cursor-pointer text-muted-foreground'
                onClick={() => {
                  if (metadata.gitInfo?.branch) {
                    void navigator.clipboard.writeText(metadata.gitInfo.branch);
                  }
                }}
              />
            </div>

            {metadata.gitInfo?.preview?.url && (
              <div className='break-all'>
                <span className='font-medium text-sm text-foreground'>Preview:</span>{' '}
                <a
                  href={metadata.gitInfo.preview.url}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='text-primary underline cursor-pointer'
                >
                  {metadata.gitInfo.preview.url}
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {((metadata.completedSteps && metadata.completedSteps.length > 0) ||
        (metadata.pendingSteps && metadata.pendingSteps.length > 0)) && (
        <div className='bg-card border border-border rounded-xl p-4 space-y-2'>
          <h4 className='text-[13px] font-semibold text-muted-foreground mb-3'>
            Workflow Activity
          </h4>

          <div className='flex flex-col gap-2 transition-all duration-200'>
            {metadata.completedSteps && metadata.completedSteps.length > 0 && (
              <div className='flex flex-col gap-2'>
                {metadata.completedSteps.map((step, index) => (
                  <div
                    key={step.stepName}
                    className={cn(
                      'flex items-center gap-2',
                      !showAllSteps && index > 0 && 'hidden',
                    )}
                  >
                    {step.status === 'FAILED' ? (
                      <X size={14} className='text-destructive flex-shrink-0' />
                    ) : step.status === 'COMPLETED' ? (
                      <CircleCheck size={14} className='text-status-success flex-shrink-0' />
                    ) : (
                      <span className='text-foreground flex-shrink-0' />
                    )}
                    <span className='text-sm font-medium text-foreground'>
                      {formatStepName(step.stepName)}
                      {step.status === 'FAILED' && ' Failed'}
                      {step.status === 'COMPLETED' && ' Completed'}
                      {step.status === 'IN_PROGRESS' && ' is Running'}
                      {step.status === 'PENDING' && ' Pending'}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {filteredPending.length > 0 && (
              <div className='flex flex-col gap-2'>
                {filteredPending.map((step, index) => (
                  <div
                    key={step.stepName}
                    className={cn(
                      'flex items-center gap-2',
                      !showAllSteps && index > 0 && 'hidden',
                    )}
                  >
                    {step.status === 'FAILED' ? (
                      <X size={14} className='text-destructive flex-shrink-0' />
                    ) : (
                      <span className='text-foreground flex-shrink-0' />
                    )}
                    <span className='text-sm font-medium text-foreground'>
                      {formatStepName(step.stepName)}{' '}
                      {step.status === 'FAILED'
                        ? 'Failed'
                        : step.status === 'IN_PROGRESS'
                          ? 'is Running'
                          : 'Pending'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {!showAllSteps && hasMoreSteps && (
            <button
              className='text-xs font-semibold cursor-pointer text-muted-foreground hover:text-foreground underline py-1'
              onClick={() => setShowAllSteps(true)}
              data-track-category='WORKFLOW_BUBBLE'
              data-track-name='READ_MORE_STEPS'
            >
              Read More
            </button>
          )}
          {showAllSteps && (
            <button
              className='text-xs font-semibold cursor-pointer text-muted-foreground hover:text-foreground underline py-1'
              onClick={() => setShowAllSteps(false)}
              data-track-category='WORKFLOW_BUBBLE'
              data-track-name='VIEW_LESS_STEPS'
            >
              View Less
            </button>
          )}
        </div>
      )}
      {metadata?.createdBy && (
        <div className='flex items-center gap-2 text-xs text-muted-foreground border-t border-border pt-2 mt-1'>
          <span className='font-medium'>Ran by:</span>
          <span className='bg-muted px-2 py-0.5 rounded text-foreground'>{metadata.createdBy}</span>
        </div>
      )}
    </div>
  );
};
