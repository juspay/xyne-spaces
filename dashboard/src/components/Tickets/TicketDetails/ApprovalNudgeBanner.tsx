import React, { useState, useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';
import { usePendingHumanIntervention } from '../../../services/Workflow/usePendingApproval';
import { useApprovalSubmit } from '../../../services/Workflow/useApprovalSubmit';
import ApprovalDialog from './ApprovalDialog';
import { cn } from '../../ui/Drawer';
import { toast } from 'sonner';

interface ApprovalNudgeBannerProps {
  ticketId: string;
  className?: string;
}

const ApprovalNudgeBanner: React.FC<ApprovalNudgeBannerProps> = ({ ticketId, className }) => {
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const { data, isLoading, refetch } = usePendingHumanIntervention(ticketId);
  const { submitResponse, isSubmitting } = useApprovalSubmit();

  const handleSubmit = useCallback(
    async (response: Record<string, unknown>) => {
      if (!data?.step) return;

      try {
        await submitResponse({
          workflowStepId: data.step.id,
          response,
        });

        toast.success('Response submitted successfully');
        setIsDialogOpen(false);
        void refetch();
      } catch (error) {
        console.error('Failed to submit approval response:', error);
        toast.error('Failed to submit response. Please try again.');
      }
    },
    [data?.step, submitResponse, refetch],
  );

  if (isLoading || !data?.requiresIntervention || !data.step) {
    return null;
  }

  return (
    <>
      <div
        className={cn(
          'flex items-center justify-between gap-4 p-4 rounded-lg',
          'bg-amber-50 border border-amber-200',
          'dark:bg-amber-900/20 dark:border-amber-800',
          className,
        )}
      >
        <div className='flex items-center gap-3'>
          <div className='flex-shrink-0'>
            <AlertTriangle className='h-5 w-5 text-amber-600 dark:text-amber-500' />
          </div>
          <div className='flex flex-col'>
            <span className='text-sm font-medium text-amber-800 dark:text-amber-200'>
              Action Required
            </span>
            <span className='text-sm text-amber-700 dark:text-amber-300'>
              {data.step.title || 'This workflow is waiting for your response'}
            </span>
          </div>
        </div>

        <button
          onClick={() => setIsDialogOpen(true)}
          className={cn(
            'flex-shrink-0 px-4 py-2 text-sm font-medium rounded-md',
            'bg-amber-600 text-white hover:bg-amber-700',
            'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-amber-500',
            'transition-colors duration-150',
          )}
        >
          Review &amp; Respond
        </button>
      </div>

      <ApprovalDialog
        step={data.step}
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
      />
    </>
  );
};

export default ApprovalNudgeBanner;
