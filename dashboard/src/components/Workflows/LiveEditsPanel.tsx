import React, { useMemo, useEffect, useRef } from 'react';
import {
  CombinedWorkflowData,
  WorkflowStep,
} from '../../services/Workflow/workflowGraphService.types';
import { AgentStepRenderer } from './AgentStepRenderer/StepRenderer';
import { FileX2, RefreshCw } from 'lucide-react';
import { CodeGenerationLoader } from './CodeGenerationLoader/CodeGenerationLoader';
import { parseIteration } from './AgentChatView/AgentChatView.utils';

interface LiveEditsPanelProps {
  combinedStepsData: CombinedWorkflowData | null;
}

interface ExtendedWorkflowStep extends WorkflowStep {
  isReviewFix?: boolean;
  iterationIndex?: number;
}

const LiveEditsPanel: React.FC<LiveEditsPanelProps> = ({ combinedStepsData }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  const editSteps = useMemo(() => {
    if (!combinedStepsData?.workflows?.length) return [];
    const steps: ExtendedWorkflowStep[] = [];

    combinedStepsData.workflows.forEach(workflow => {
      workflow.steps.forEach(step => {
        const stepName = step.stepName?.toLowerCase() || '';
        if (
          stepName.startsWith('tool_edit') ||
          stepName.startsWith('tool_multiedit') ||
          stepName.startsWith('tool_write')
        ) {
          steps.push(step);
        }

        const handleExecutions = (
          executions: Array<{ parentStepName: string; steps: WorkflowStep[] }>,
        ): void => {
          executions.forEach(exec => {
            const iterInfo = parseIteration(exec.parentStepName);
            const isReviewFix = iterInfo && iterInfo.index > 0;

            exec.steps.forEach(childStep => {
              const childName = childStep.stepName?.toLowerCase() || '';
              if (
                childName.startsWith('tool_edit') ||
                childName.startsWith('tool_multiedit') ||
                childName.startsWith('tool_write')
              ) {
                const extendedChild: ExtendedWorkflowStep = { ...childStep };
                if (isReviewFix && iterInfo) {
                  extendedChild.isReviewFix = true;
                  extendedChild.iterationIndex = iterInfo.index;
                }
                steps.push(extendedChild);
              }
            });
          });
        };

        if (step.expandedExecutions) handleExecutions(step.expandedExecutions);
        if (step.expandedWorkflows) handleExecutions(step.expandedWorkflows);
      });
    });

    return steps.sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return timeA - timeB;
    });
  }, [combinedStepsData]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [editSteps.length]);

  const status = combinedStepsData?.workflows?.[0]?.status?.toUpperCase();
  const isTerminated = status === 'SUCCESS' || status === 'FAILURE';

  if (editSteps.length === 0) {
    if (!isTerminated) {
      return (
        <div className='h-full flex items-center justify-center'>
          <CodeGenerationLoader />
        </div>
      );
    }

    return (
      <div className='h-full flex items-center justify-center bg-gray-50'>
        <div className='text-center px-6'>
          <div className='w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4'>
            <FileX2 className='w-7 h-7 text-gray-400' />
          </div>
          <p className='text-gray-700 font-medium text-sm'>It seems there are no edits!</p>
        </div>
      </div>
    );
  }

  return (
    <div className='h-full flex flex-col bg-background overflow-hidden'>
      <div className='flex-1 overflow-y-auto p-4 space-y-4 bg-muted/30'>
        {editSteps.map((step, index) => (
          <div
            key={step.id || index}
            className='animate-in fade-in slide-in-from-bottom-2 duration-300 flex flex-col gap-2'
          >
            {step.isReviewFix && (
              <div className='flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded w-fit border border-amber-200/50 mb-1 ml-1 font-medium'>
                <RefreshCw className='w-3 h-3' />
                <span>Fixing Review Feedback (Iter {step.iterationIndex})</span>
              </div>
            )}
            <AgentStepRenderer step={step} defaultOpen={true} hideHeader={true} />
          </div>
        ))}
        <div ref={scrollRef} />
      </div>
    </div>
  );
};

export default LiveEditsPanel;
