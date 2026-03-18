import React, { useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { ExecutionMetadata } from '../../services/Workflow/workflowGraphService.types';
import AttemptBranchGraph from './AttemptBranchGraph';

interface AttemptBranchGraphModalProps {
  executionMetadata: ExecutionMetadata[];
  selectedExecutionId: string | undefined;
  onExecutionSelect: (executionId: string) => void;
}

const AttemptBranchGraphModal: React.FC<AttemptBranchGraphModalProps> = ({
  executionMetadata,
  selectedExecutionId,
  onExecutionSelect,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  if (executionMetadata.length <= 1) {
    return null;
  }

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className='flex items-center justify-center w-5 h-5 rounded transition-colors text-muted-foreground hover:text-foreground hover:bg-border/50'
        title='View branch graph'
        data-track-category='Workflows'
        data-track-name='OpenAttemptBranchGraphModal'
      >
        <ChevronDown size={12} />
      </button>

      {isOpen && (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4'>
          <div className='w-full max-w-4xl bg-background rounded-lg shadow-lg border border-border overflow-hidden'>
            {/* Header */}
            <div className='flex items-center justify-between px-4 py-3 border-b border-border bg-muted/50'>
              <span className='text-sm font-medium text-foreground'>Attempt History</span>
              <button
                onClick={() => setIsOpen(false)}
                className='p-1 rounded hover:bg-border/50 transition-colors'
                title='Close'
                data-track-category='Workflows'
                data-track-name='CloseAttemptBranchGraphModal'
              >
                <X size={16} className='text-muted-foreground' />
              </button>
            </div>

            {/* Content */}
            <div className='max-h-[60vh] overflow-y-auto'>
              <AttemptBranchGraph
                executionMetadata={executionMetadata}
                selectedExecutionId={selectedExecutionId}
                onExecutionSelect={execId => {
                  onExecutionSelect(execId);
                  setIsOpen(false);
                }}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default AttemptBranchGraphModal;
