import React, { useMemo, useEffect, useRef } from 'react';
import {
  CombinedWorkflowData,
  WorkflowStep,
} from '../../services/Workflow/workflowGraphService.types';
import { AgentStepRenderer } from './AgentStepRenderer/StepRenderer';
import { Bot, Code } from 'lucide-react';

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
          stepName.startsWith('tool_bash') ||
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
                childName.startsWith('tool_bash') ||
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

  if (editSteps.length === 0) {
    return (
      <div className='h-full flex items-center justify-center bg-gray-50'>
        <div className='text-center'>
          <Bot className='w-12 h-12 text-gray-400 mx-auto mb-4' />
          <p className='text-gray-600 font-medium'>No Live Edits Yet</p>
          <p className='text-sm text-gray-500 mt-2 max-w-sm'>
            Live file modifications will appear here once the agent starts editing files.
          </p>
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
