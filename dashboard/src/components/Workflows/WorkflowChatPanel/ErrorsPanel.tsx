import React from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { WorkflowStep } from '../../../services/Workflow/workflowGraphService.types';

interface ErrorsPanelProps {
  errorSteps: { step: WorkflowStep; message: string }[];
  onClose: () => void;
}

export const ErrorsPanel: React.FC<ErrorsPanelProps> = ({ errorSteps, onClose }) => {
  return (
    <div className='flex flex-col h-full bg-background'>
      <div className='flex items-center justify-between px-4 py-3 border-b border-border bg-red-500/10'>
        <h3 className='font-medium text-red-600 dark:text-red-400 flex items-center gap-2'>
          <AlertTriangle size={16} className='text-red-500' strokeWidth={2.5} />
          Errors ({errorSteps.length})
        </h3>
        <button
          onClick={onClose}
          className='p-1.5 rounded-md hover:bg-border text-muted-foreground transition-colors'
          data-track-category='Workflows'
          data-track-name='CloseErrorsTab'
        >
          <X size={16} />
        </button>
      </div>
      <div className='flex-1 overflow-y-auto p-3 space-y-3 bg-muted/30 no-scrollbar'>
        {errorSteps.length === 0 ? (
          <div className='text-center p-4 text-muted-foreground text-sm'>No errors found</div>
        ) : (
          errorSteps.map((err, idx) => (
            <div
              key={`${err.step.id}-${idx}`}
              className='p-3.5 bg-background rounded-xl border border-red-200/60 dark:border-red-900/40 shadow-sm hover:border-red-300/80 dark:hover:border-red-800/60 transition-colors group'
            >
              <div className='text-sm font-bold text-red-700 dark:text-red-400 mb-1.5 capitalize truncate group-hover:text-red-800 dark:group-hover:text-red-300'>
                {err.step.stepName?.replace(/_/g, ' ') || 'Step'}
              </div>
              <div className='text-[13px] text-red-600 dark:text-red-400/80 break-words leading-relaxed whitespace-pre-wrap'>
                {err.message}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
