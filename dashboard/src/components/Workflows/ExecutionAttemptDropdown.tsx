import React, { useMemo } from 'react';
import { ChevronDown } from 'lucide-react';
import { format } from 'date-fns';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { ExecutionMetadata } from '../../services/Workflow/workflowGraphService.types';

interface ExecutionAttemptDropdownProps {
  executionMetadata: ExecutionMetadata[];
  selectedExecutionId?: string;
  onExecutionSelect: (executionId: string) => void;
}

const ExecutionAttemptDropdown: React.FC<ExecutionAttemptDropdownProps> = ({
  executionMetadata,
  selectedExecutionId,
  onExecutionSelect,
}) => {
  // Reverse metadata for correct ordering (backend sends newest first, we want oldest first)
  const orderedExecutionMetadata = useMemo(() => {
    return [...executionMetadata].reverse();
  }, [executionMetadata]);

  // Get current execution index
  const currentExecutionIndex = useMemo(() => {
    if (!selectedExecutionId || orderedExecutionMetadata.length === 0) return -1;
    return orderedExecutionMetadata.findIndex(exec => exec.executionId === selectedExecutionId);
  }, [selectedExecutionId, orderedExecutionMetadata]);

  // Don't render if only one execution or no valid selection
  if (orderedExecutionMetadata.length <= 1 || currentExecutionIndex < 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className='flex items-center gap-1 px-2.5 py-1 rounded-md border border-input text-xs bg-background hover:bg-blue-100 hover:border-blue-300 transition-colors h-[26px] min-w-[120px] font-medium leading-[1.2]'>
          Attempt {currentExecutionIndex + 1} of {orderedExecutionMetadata.length}
          <ChevronDown size={14} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' className='z-[100] min-w-[320px]'>
        {orderedExecutionMetadata.map((exec, index) => {
          // Find parent attempt number if this is a rerun
          const parentAttemptNumber = exec.parentWorkflowExecutionId
            ? orderedExecutionMetadata.findIndex(
                e => e.executionId === exec.parentWorkflowExecutionId,
              ) + 1
            : null;

          return (
            <DropdownMenuItem
              key={exec.executionId}
              onClick={() => onExecutionSelect(exec.executionId)}
              className={exec.executionId === selectedExecutionId ? 'bg-muted' : ''}
              data-track-category='Workflows'
              data-track-name='SelectExecutionAttempt'
              data-track-metadata={JSON.stringify({
                executionId: exec.executionId,
                attemptNumber: index + 1,
              })}
            >
              <div className='flex flex-col gap-1 w-full'>
                <span className='font-medium'>
                  Attempt {index + 1} {exec.tag === 'root' ? '(Original)' : ''}
                  {exec.executionId === selectedExecutionId && ' ✓'}
                </span>
                <span className='text-xs text-muted-foreground'>
                  {format(new Date(exec.createdAt), 'PPpp')} · {exec.executionStatus}
                </span>
                {exec.sourceStepName && parentAttemptNumber && (
                  <span className='text-xs text-orange-600'>
                    Forked from Attempt {parentAttemptNumber} at step &apos;{exec.sourceStepName}
                    &apos;
                  </span>
                )}
              </div>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default ExecutionAttemptDropdown;
