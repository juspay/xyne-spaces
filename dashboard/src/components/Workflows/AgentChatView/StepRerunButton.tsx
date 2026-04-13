import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Loader2, AlertCircle, RotateCcw, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { useSelector } from '@xstate/react';
import { useWorkflowControl } from '../../../services/Workflow/workflowGraphService';
import { CombinedWorkflowData } from '../../../services/Workflow/workflowGraphService.types';
import Tooltip from '../../ui/Tooltip/Tooltip';
import { USER_REPLY_PREFIX, RA_URL } from '../constants';
import { browserPanelActor } from '../../../machines/browserPanelMachine';
import { isElectronApp } from '../../../utils/electronApp';

interface StepRerunButtonProps {
  executionId?: string;
  stepIds: string[];
  combinedStepsData: CombinedWorkflowData | null;
  onRerun?: (newExecutionId: string) => void;
  size?: number;
}

export const StepRerunButton: React.FC<StepRerunButtonProps> = ({
  executionId,
  stepIds,
  combinedStepsData,
  onRerun,
  size = 14,
}) => {
  const { continueAgenticStepAsync, isContinuing, restoreExecutionAsync, isRestoring } =
    useWorkflowControl();
  const browserPanelState = useSelector(
    browserPanelActor,
    state => state.context.browserPanelState,
  );
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [contextInput, setContextInput] = useState('');
  const [dropdownError, setDropdownError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsDropdownOpen(false);
      }
    };

    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return (): void => document.removeEventListener('mousedown', handleClickOutside);
    }
    return undefined;
  }, [isDropdownOpen]);

  // Determine if these steps are agentic (have an agent input step)
  const isAgenticStep = (): boolean => {
    if (!stepIds.length || !combinedStepsData?.workflows?.length) return false;

    for (const workflow of combinedStepsData.workflows) {
      for (const step of workflow.steps) {
        if (stepIds.includes(step.id) && step.type === 'input') {
          return true;
        }
      }
    }
    return false;
  };

  const findInputStep = (): { id: string; executionId: string } | null => {
    if (!stepIds.length || !combinedStepsData?.workflows?.length) {
      return null;
    }

    for (const workflow of combinedStepsData.workflows) {
      for (const step of workflow.steps) {
        if (stepIds.includes(step.id) && step.type === 'input') {
          return {
            id: step.id,
            executionId: step.workflowExecutionId || executionId || '',
          };
        }
      }
    }

    return null;
  };

  // Find any step matching the stepIds for restore (deterministic rerun)
  const findStepForRestore = (): { id: string; executionId: string } | null => {
    if (!stepIds.length || !combinedStepsData?.workflows?.length) {
      return null;
    }

    for (const workflow of combinedStepsData.workflows) {
      for (const step of workflow.steps) {
        if (stepIds.includes(step.id)) {
          return {
            id: step.id,
            executionId: step.workflowExecutionId || executionId || '',
          };
        }
      }
    }

    return null;
  };

  const handleAgenticRerun = async (): Promise<void> => {
    if (!executionId) {
      setDropdownError('No execution ID available');
      return;
    }

    const inputStep = findInputStep();
    if (!inputStep) {
      setDropdownError('No checkpoint found to continue from');
      return;
    }

    try {
      setDropdownError(null);
      const trimmed = contextInput.trim();
      const result = await continueAgenticStepAsync({
        executionId: inputStep.executionId,
        stepId: inputStep.id,
        message: trimmed ? USER_REPLY_PREFIX + trimmed : '',
      });

      toast.success('Rerun started', {
        description: `Execution restarted from this step`,
        duration: 3000,
      });

      setIsDropdownOpen(false);
      setContextInput('');

      if (result.rerunExecutionId && onRerun) {
        onRerun(result.rerunExecutionId);
      }
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to rerun step';
      setDropdownError(errorMsg);
      toast.error('Rerun failed', {
        description: errorMsg,
        duration: 4000,
      });
    }
  };

  const handleDeterministicRerun = async (): Promise<void> => {
    if (!executionId) {
      setDropdownError('No execution ID available');
      return;
    }

    const step = findStepForRestore();
    if (!step) {
      setDropdownError('No step found to restore from');
      return;
    }

    try {
      setDropdownError(null);
      const result = await restoreExecutionAsync({
        executionId: step.executionId,
        stepId: step.id,
      });

      toast.success('Rerun started', {
        description: `Execution restarted from this step`,
        duration: 3000,
      });

      setIsDropdownOpen(false);

      if (result.rerunExecutionId && onRerun) {
        onRerun(result.rerunExecutionId);
      }
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to rerun step';
      setDropdownError(errorMsg);
      toast.error('Rerun failed', {
        description: errorMsg,
        duration: 4000,
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleAgenticRerun();
    } else if (e.key === 'Escape') {
      setIsDropdownOpen(false);
    }
  };

  const handleOpenRA = (): void => {
    setIsDropdownOpen(false);
    if (isElectronApp()) {
      if (browserPanelState === 'open') {
        browserPanelActor.send({ type: 'OPEN_URLS', urls: [RA_URL] });
      } else {
        browserPanelActor.send({ type: 'OPEN', urls: [RA_URL] });
      }
    } else {
      window.open(RA_URL, '_blank');
    }
  };

  const isLoading = isContinuing || isRestoring;
  const isAgentic = isAgenticStep();

  return (
    <div className='relative'>
      <Tooltip content='Rerun from this step'>
        <button
          ref={buttonRef}
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          disabled={isLoading || !executionId}
          className='p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
          data-track-category='Workflows'
          data-track-name='OpenStepRerunDropdown'
        >
          {isLoading ? (
            <Loader2 size={size} className='animate-spin text-blue-500' />
          ) : (
            <span className='flex items-center gap-0.5'>
              <RotateCcw size={size} />
              <ChevronDown size={size - 2} />
            </span>
          )}
        </button>
      </Tooltip>

      {isDropdownOpen && (
        <div
          ref={dropdownRef}
          className='absolute right-0 mt-1 w-80 bg-background border border-border rounded-lg shadow-lg z-50 p-3'
        >
          <div className='space-y-2.5'>
            {isAgentic ? (
              /* Agentic step: show textarea for context */
              <div>
                <label
                  htmlFor='rerun-context'
                  className='block text-xs font-medium text-foreground mb-1.5'
                >
                  Rerun Context{' '}
                  <span className='text-muted-foreground font-normal'>(Optional)</span>
                </label>
                <textarea
                  id='rerun-context'
                  value={contextInput}
                  onChange={(e): void => setContextInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder='Type your message to Rerun from this step or just press Enter'
                  className='w-full px-2 py-1.5 text-xs border border-border rounded-md bg-muted/50 text-foreground placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-sky-500 resize-none'
                  rows={6}
                  disabled={isLoading}
                  data-track-category='Workflows'
                  data-track-name='StepRerunContextInput'
                />
              </div>
            ) : (
              /* Deterministic step: no input needed, just confirmation text */
              <div className='text-xs text-foreground'>
                Rerun the workflow from this step? No additional input is needed.
              </div>
            )}

            {dropdownError && (
              <div className='flex items-start gap-1.5 p-2 bg-red-500/10 border border-red-200 rounded text-xs text-red-700'>
                <AlertCircle size={12} className='flex-shrink-0 mt-0.5' />
                <span>{dropdownError}</span>
              </div>
            )}

            <button
              onClick={(): void => {
                if (isAgentic) {
                  void handleAgenticRerun();
                } else {
                  void handleDeterministicRerun();
                }
              }}
              disabled={isLoading}
              className='w-full px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white text-xs font-medium rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5'
              data-track-category='Workflows'
              data-track-name='SubmitStepRerun'
            >
              {isLoading ? (
                <>
                  <Loader2 size={12} className='animate-spin' />
                  Rerunning...
                </>
              ) : (
                'Rerun from here'
              )}
            </button>

            <button
              onClick={handleOpenRA}
              className='w-full px-3 py-1.5 border border-border bg-background hover:bg-muted text-foreground text-xs font-medium rounded transition-colors flex items-center justify-center gap-1.5'
              data-track-category='Workflows'
              data-track-name='PlanFromRA'
            >
              <ExternalLink size={11} />
              Plan from RA
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
