import { Copy, ExternalLink, CircleCheck, CircleDashed, GitBranch, RefreshCw } from 'lucide-react';
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

interface WorkflowBubbleProps {
  workflowName: string | undefined;
  workflowStatus?: string | undefined;
  createdAt: number;
  ticketId: string | undefined;
  metadata: MessageMetadata;
}

export const WorkflowBubble: React.FC<WorkflowBubbleProps> = ({
  workflowName,
  workflowStatus,
  createdAt,
  ticketId,
  metadata,
}) => {
  const navigate = useNavigate();
  const [isRerunning, setIsRerunning] = useState(false);

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
    <div className='flex flex-col bg-[#FAFAFA] border border-[#F0F0F0] p-3 gap-3 rounded-xl'>
      <div className='flex justify-between items-center gap-2'>
        <div className='flex items-center gap-2'>
          <span className='font-[15px] text-gray-800'>{workflowName}</span>
          {workflowName && (
            <button
              onClick={() => {
                void navigator.clipboard.writeText(workflowName);
              }}
              aria-label='Copy workflow name'
            >
              <Copy size={12} color='#788187' />
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
            >
              <RefreshCw size={12} className={isRerunning ? 'animate-spin' : ''} />
              {isRerunning ? 'Rerunning...' : 'Rerun'}
            </Button>
          )}
          <ExternalLink
            cursor={'pointer'}
            onClick={e => {
              e.stopPropagation();
              const workflowUrl = metadata?.workflowId
                ? `/tickets/${ticketId}/workflow/${metadata.workflowId}`
                : `/tickets/${ticketId}/workflow`;
              void navigate(workflowUrl);
            }}
            color='#788187'
            size={14}
          />
        </div>
      </div>
      <div className='flex items-center gap-2 text-[#788187] font-medium text-[13px]'>
        <span>{getExecutionTimeDisplay(displayMetadataForTime, new Date(createdAt))}</span>
      </div>
      {metadata?.gitInfo && (
        <div className='bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-2'>
          <div className='flex items-center gap-2.5'>
            <span className='font-medium text-gray-900'>Changes made in </span>
            <span className='font-medium bg-muted rounded-md px-2 py-1 text-sm'>
              {metadata.gitInfo.repoUrl?.split('/').pop()?.replace('.git', '')}
            </span>
          </div>

          <div className='flex flex-col text-sm text-gray-700 gap-2'>
            <div className='flex items-center gap-3 mt-1'>
              <span className='font-medium text-gray-900'>
                <GitBranch size={14} />
              </span>
              <span className='font-medium  hover:underline cursor-pointer'>
                {metadata.gitInfo?.branch}
              </span>
              <Copy
                size={12}
                color='#6B7280'
                className='cursor-pointer'
                onClick={() => {
                  if (metadata.gitInfo?.branch) {
                    void navigator.clipboard.writeText(metadata.gitInfo.branch);
                  }
                }}
              />
            </div>

            {metadata.gitInfo?.preview?.url && (
              <div className='break-all'>
                <span className='font-medium text-sm text-gray-900'>Preview:</span>{' '}
                <a
                  href={metadata.gitInfo.preview.url}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='text-blue-600 underline cursor-pointer'
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
        <div className='bg-white border border-gray-200 rounded-xl p-4 space-y-2'>
          <h4 className='text-[13px] font-semibold text-gray-700 mb-3'>Workflow Activity</h4>

          {metadata.completedSteps && metadata.completedSteps.length > 0 && (
            <div className='flex flex-col gap-2'>
              {metadata.completedSteps.map(step => (
                <div key={step.stepName} className='flex items-center gap-2'>
                  <CircleCheck size={14} />
                  <span className='text-sm font-medium'>
                    {formatStepName(step.stepName)} Completed
                  </span>
                </div>
              ))}
            </div>
          )}

          {filteredPending.length > 0 && (
            <div className='flex flex-col gap-2'>
              {filteredPending.map(step => (
                <div key={step.stepName} className='flex items-center gap-2'>
                  <CircleDashed size={14} className='animate-spin' />
                  <span className='text-sm font-medium'>
                    {formatStepName(step.stepName)} is Running
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
