import React, { useState } from 'react';
import { Button } from '../Button';
import { useApprovalSubmit } from '../../../services/Workflow/useApprovalSubmit';
import { toast } from 'sonner';
import { usePendingHumanIntervention } from '../../../services/Workflow/usePendingApproval';

interface WorkflowAction {
  label: string;
  action: string;
  variant?: 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive' | undefined;
}

interface WorkflowActionMetadata {
  workflowExecutionId: string;
  workflowStepId: string;
  buttons: WorkflowAction[];
  responded?: boolean; // Flag indicating if action has already been taken
}

interface WorkflowActionButtonsProps {
  ticketId: string;
  metadata: WorkflowActionMetadata;
}

export const WorkflowActionButtons: React.FC<WorkflowActionButtonsProps> = ({
  ticketId,
  metadata,
}) => {
  const [submitted, setSubmitted] = useState(false);
  const { data, isLoading, refetch } = usePendingHumanIntervention(ticketId);
  const { submitResponse, isSubmitting } = useApprovalSubmit();

  const handleAction = async (action: string): Promise<void> => {
    try {
      await submitResponse({
        workflowStepId: metadata.workflowStepId,
        response: { decision: action },
      });
      setSubmitted(true);
      toast.success('Response submitted successfully');
      void refetch();
    } catch (error) {
      console.error('Failed to submit workflow action:', error);
      toast.error('Failed to submit response');
    }
  };

  // Don't render if already responded (from backend) or just submitted (local state)
  if (isLoading || !data?.requiresIntervention || submitted) {
    return null;
  }

  return (
    <div className='flex gap-2 mt-3'>
      {metadata.buttons.map((button, index) => (
        <Button
          key={index}
          size='sm'
          variant={button.variant || 'default'}
          onClick={() => void handleAction(button.action)}
          disabled={isSubmitting}
          loading={isSubmitting}
          data-track-category='Workflow'
          data-track-name='WorkflowActionButton'
        >
          {button.label}
        </Button>
      ))}
    </div>
  );
};
