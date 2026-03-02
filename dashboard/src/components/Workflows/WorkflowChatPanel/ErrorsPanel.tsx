import React from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { WorkflowStep } from '../../../services/Workflow/workflowGraphService.types';

interface ErrorsPanelProps {
  errorSteps: { step: WorkflowStep; message: string }[];
  onClose: () => void;
}

export const ErrorsPanel: React.FC<ErrorsPanelProps> = ({ errorSteps, onClose }) => {
  return (
    <div className='flex flex-col h-full bg-white'>
      <div className='flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-red-50/30'>
        <h3 className='font-medium text-red-700 flex items-center gap-2'>
          <AlertTriangle size={16} className='text-red-500' strokeWidth={2.5} />
          Errors ({errorSteps.length})
        </h3>
        <button
          onClick={onClose}
          className='p-1.5 rounded-md hover:bg-gray-200 text-gray-500 transition-colors'
          data-track-category='Workflows'
          data-track-name='CloseErrorsTab'
        >
          <X size={16} />
        </button>
      </div>
      <div className='flex-1 overflow-y-auto p-3 space-y-3 bg-gray-50/30 no-scrollbar'>
        {errorSteps.length === 0 ? (
          <div className='text-center p-4 text-gray-500 text-sm'>No errors found</div>
        ) : (
          errorSteps.map((err, idx) => (
            <div
              key={`${err.step.id}-${idx}`}
              className='p-3.5 bg-white rounded-xl border border-red-100/60 shadow-[0_2px_8px_rgba(239,68,68,0.08)] hover:border-red-200 transition-colors group'
            >
              <div className='text-sm font-bold text-red-800 mb-1.5 capitalize truncate group-hover:text-red-900'>
                {err.step.stepName?.replace(/_/g, ' ') || 'Step'}
              </div>
              <div className='text-[13px] text-red-600 break-words leading-relaxed whitespace-pre-wrap'>
                {err.message}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
