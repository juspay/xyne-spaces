import React, { useMemo, useEffect, useRef } from 'react';
import {
  CombinedWorkflowData,
  WorkflowStep,
} from '../../services/Workflow/workflowGraphService.types';
import { AgentStepRenderer } from './AgentStepRenderer/StepRenderer';
import { Code, FileX2 } from 'lucide-react';
import { CodeGenerationLoader } from './CodeGenerationLoader/CodeGenerationLoader';

interface LiveEditsPanelProps {
  combinedStepsData: CombinedWorkflowData | null;
}

const LiveEditsPanel: React.FC<LiveEditsPanelProps> = ({ combinedStepsData }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  const editSteps = useMemo(() => {
    if (!combinedStepsData?.workflows?.length) return [];
    const steps: WorkflowStep[] = [];

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

        if (step.expandedExecutions) {
          step.expandedExecutions.forEach(exec => {
            exec.steps.forEach(childStep => {
              const childName = childStep.stepName?.toLowerCase() || '';
              if (
                childName.startsWith('tool_edit') ||
                childName.startsWith('tool_multiedit') ||
                childName.startsWith('tool_write')
              ) {
                steps.push(childStep);
              }
            });
          });
        }
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
    <div className='h-full flex flex-col bg-white overflow-hidden'>
      <div className='flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50/80'>
        <div className='flex items-center gap-2'>
          <Code className='w-4 h-4 text-blue-500' />
          <h3 className='font-medium text-gray-800 text-sm'>Live Edits</h3>
          <span className='px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-medium ml-2'>
            {editSteps.length}
          </span>
        </div>
      </div>

      <div className='flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50/30'>
        {editSteps.map((step, index) => (
          <div
            key={step.id || index}
            className='animate-in fade-in slide-in-from-bottom-2 duration-300 bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden'
          >
            <AgentStepRenderer step={step} defaultOpen={true} />
          </div>
        ))}
        <div ref={scrollRef} />
      </div>
    </div>
  );
};

export default LiveEditsPanel;
