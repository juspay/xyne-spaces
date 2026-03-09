import React, { useState } from 'react';
import { Ticket } from '../../hooks/useTickets';
import { useZero } from '../../hooks/useZero';
import { Modal, Breadcrumb } from '@juspay/blend-design-system';
import { toast } from 'sonner';
import SearchUser from '../ui/SearchUser/SearchUser';
import { User } from '@xyne/shared';
import { mutators } from '../../zero/mutators';
import { getWorkflowIcon } from '../../assets/icons/WorkflowIcons';
import { UserHoverWrapper } from '../ui/UserMentionPopover/UserMentionPopover';
import { useWorkflowControl } from '../../services/Workflow/workflowGraphService';
import { ExecutionMetadata } from '../../services/Workflow/workflowGraphService.types';
import ExecutionAttemptDropdown from './ExecutionAttemptDropdown';
import { useUser } from '../../hooks/useUsers';

interface WorkflowDetailsHeaderProps {
  ticket: Ticket;
  executionId?: string;
  executionStatus?: string;
  executionMetadata?: ExecutionMetadata[];
  selectedExecutionId?: string;
  onExecutionSelect?: (executionId: string) => void;
}

const WorkflowDetailsHeader: React.FC<WorkflowDetailsHeaderProps> = ({
  ticket,
  executionId,
  executionMetadata = [],
  selectedExecutionId,
  onExecutionSelect,
}) => {
  const zero = useZero();
  const [showDetails, setShowDetails] = useState(false); // DEFAULT COLLAPSED

  // Get user info from useUser hook
  const createdByUser = useUser(ticket?.createdBy);
  const assignedToUser = useUser(ticket?.assignedTo ?? '');

  // Workflow control hooks
  const {
    pauseExecution,
    resumeExecution,
    cancelExecution,
    isPausing,
    isResuming,
    isCanceling,
    pauseError,
    resumeError,
    cancelError,
    resetPause,
    resetResume,
    resetCancel,
  } = useWorkflowControl();

  const [isDescriptionModalOpen, setIsDescriptionModalOpen] = useState(false);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignLoading, setAssignLoading] = useState(false);
  const [selectedAssignUser, setSelectedAssignUser] = useState<User[]>([]);

  const workflowTitle = ticket?.title ?? 'Loading…';
  const runId = ticket?.xyneId ?? ticket?.id ?? 'UNKNOWN';

  // Calculate elapsed time
  const getElapsedTime = (): string => {
    if (!ticket?.createdAt) return '0m';
    const start = new Date(ticket.createdAt);
    const now = new Date();
    const diffMs = now.getTime() - start.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);

    if (diffHours > 0) {
      return `${diffHours}h ${diffMins % 60}m`;
    }
    return `${diffMins}m`;
  };

  const elapsedTime = getElapsedTime();

  // ---- Workflow Execution Control ----
  const handlePauseWorkflow = (): void => {
    if (!executionId) return;
    resetPause(); // Clear any previous errors
    pauseExecution(executionId);
  };

  const handleResumeWorkflow = (): void => {
    if (!executionId) return;
    resetResume(); // Clear any previous errors
    resumeExecution({ executionId });
  };

  const handleCancelWorkflow = (): void => {
    if (!executionId) return;
    resetCancel(); // Clear any previous errors
    cancelExecution(executionId);
  };

  // ---- Assign User ----
  const handleOpenAssignModal = (): void => {
    setSelectedAssignUser(assignedToUser ? [assignedToUser] : []);
    setAssignModalOpen(true);
  };

  const handleAssignSubmit = (): void => {
    if (!ticket) return;

    const userToAssign = selectedAssignUser?.[0] ?? null;

    setAssignLoading(true);

    try {
      void zero.mutate(
        mutators.ticket.updateAssignment({
          ticketId: ticket.id,
          assignedTo: userToAssign?.id ?? null,
          timestamp: Date.now(),
        }),
      );

      setAssignModalOpen(false);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error assigning user to ticket:', error);
      toast.error('Assignment Failed', {
        description: 'There was an error assigning the user. Please try again.',
        duration: 5000,
      });
    } finally {
      setAssignLoading(false);
    }
  };

  // Description truncation and modal handling
  const truncateDescription = (text: string, maxLength: number): string => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  const handleDescriptionClick = (): void => {
    setIsDescriptionModalOpen(true);
  };

  return (
    <div className='bg-muted'>
      {/* Top Navigation */}

      {/* Main Workflow Header */}
      <div className='bg-background border-b relative'>
        <div className='px-6 py-6'>
          {/* Breadcrumb */}
          <div className='mb-4'>
            <div className='flex items-center gap-3'>
              <Breadcrumb
                items={[
                  {
                    label: 'Workflows',
                    href: '/tickets',
                  },
                  {
                    label: runId,
                    href: '#',
                  },
                ]}
              />

              {/* Execution Attempt Dropdown */}
              {onExecutionSelect && (
                <ExecutionAttemptDropdown
                  executionMetadata={executionMetadata}
                  {...(selectedExecutionId && { selectedExecutionId })}
                  onExecutionSelect={onExecutionSelect}
                />
              )}
            </div>

            <button
              onClick={() => setShowDetails(!showDetails)}
              className='
    absolute 
    top-4 
    right-6 
    px-3 py-1.5 
    border border-input 
    rounded-md 
    text-sm 
    bg-background 
    hover:bg-muted 
    shadow-sm
    z-20
  '
              data-track-category='Workflows'
              data-track-name='ToggleDetailsPanel'
            >
              {showDetails ? 'Hide Details' : 'Show Details'}
            </button>
          </div>

          {/* Run Header */}
          {showDetails && (
            <>
              <div className='flex justify-between items-center mb-2'>
                <div className='flex items-center gap-4'>
                  <h1 className='text-3xl font-bold text-foreground'>{workflowTitle}</h1>
                </div>

                {/* Buttons */}

                <div className='flex gap-3'>
                  <button
                    onClick={handleOpenAssignModal}
                    className='bg-background border border-input px-3 py-2 rounded-md text-sm hover:bg-muted'
                    data-track-category='Workflows'
                    data-track-name='OpenAssignUserModal'
                    data-track-metadata={JSON.stringify({ ticketId: ticket?.id })}
                  >
                    Assign User
                  </button>

                  <button
                    onClick={handleCancelWorkflow}
                    disabled={isCanceling || !executionId}
                    className='bg-background border border-input px-3 py-2 rounded-md text-sm hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed'
                    data-track-category='Workflows'
                    data-track-name='CancelWorkflow'
                    data-track-metadata={JSON.stringify({ executionId })}
                  >
                    {isCanceling ? 'Canceling...' : 'Cancel'}
                  </button>

                  <button
                    onClick={handlePauseWorkflow}
                    disabled={isPausing || !executionId}
                    className='bg-background border border-input px-3 py-2 rounded-md text-sm hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed'
                    data-track-category='Workflows'
                    data-track-name='PauseWorkflow'
                    data-track-metadata={JSON.stringify({ executionId })}
                  >
                    {isPausing ? 'Pausing...' : 'Pause'}
                  </button>

                  <button
                    onClick={handleResumeWorkflow}
                    disabled={isResuming || !executionId}
                    className='bg-background border border-input px-3 py-2 rounded-md text-sm hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed'
                    data-track-category='Workflows'
                    data-track-name='ResumeWorkflow'
                    data-track-metadata={JSON.stringify({ executionId })}
                  >
                    {isResuming ? 'Resuming...' : 'Resume'}
                  </button>
                </div>
              </div>

              {/* Error Messages for Workflow Operations */}
              {(pauseError || resumeError || cancelError) && (
                <div className='mb-4 p-3 bg-red-50 border border-red-200 rounded-md'>
                  <p className='text-sm text-red-600 font-medium'>Workflow operation failed:</p>
                  <p className='text-sm text-red-600'>
                    {pauseError?.message || resumeError?.message || cancelError?.message}
                  </p>
                </div>
              )}

              {/* Details Grid */}
              <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8'>
                {/* Description */}
                <div
                  className='bg-muted rounded-xl p-4 border border-border cursor-pointer hover:bg-muted transition-colors'
                  onClick={handleDescriptionClick}
                  onKeyDown={e => e.key === 'Enter' && handleDescriptionClick()}
                  role='button'
                  tabIndex={0}
                  data-track-category='Workflows'
                  data-track-name='OpenDescriptionModal'
                  data-track-metadata={JSON.stringify({ ticketId: ticket?.id })}
                >
                  <div className='flex items-center gap-2 mb-2'>
                    {getWorkflowIcon('description', {
                      size: 16,
                      className: 'text-muted-foreground',
                    })}
                    <span className='text-sm font-medium text-muted-foreground'>Description</span>
                  </div>
                  <p className='text-sm text-foreground'>
                    {truncateDescription(workflowTitle, 50)}
                  </p>
                </div>

                {/* Current Node */}
                <div className='bg-muted rounded-xl p-4 border border-border'>
                  <div className='flex items-center gap-2 mb-2'>
                    {getWorkflowIcon('current-node', {
                      size: 16,
                      className: 'text-muted-foreground',
                    })}
                    <span className='text-sm font-medium text-muted-foreground'>Ticket Status</span>
                  </div>
                  <p className='text-sm text-foreground'>{ticket?.statusV2}</p>
                </div>

                {/* Elapsed Time */}
                <div className='bg-muted rounded-xl p-4 border border-border'>
                  <div className='flex items-center gap-2 mb-2'>
                    {getWorkflowIcon('clock', { size: 16, className: 'text-muted-foreground' })}
                    <span className='text-sm font-medium text-muted-foreground'>Elapsed Time</span>
                  </div>
                  <p className='text-sm text-foreground'>{elapsedTime}</p>
                </div>

                {/* Created By */}
                <div className='bg-muted rounded-xl p-4 border border-border'>
                  <div className='flex items-center gap-2 mb-2'>
                    {getWorkflowIcon('user', { size: 16, className: 'text-muted-foreground' })}
                    <span className='text-sm font-medium text-muted-foreground'>Created By</span>
                  </div>
                  <div className='flex items-center gap-2'>
                    <div className='w-6 h-6 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center'>
                      {createdByUser?.id && (
                        <UserHoverWrapper userId={createdByUser.id}>
                          <>
                            {(createdByUser?.name || createdByUser?.email)?.[0]?.toUpperCase() ||
                              'U'}
                          </>
                        </UserHoverWrapper>
                      )}
                    </div>
                    <span className='text-sm text-foreground'>
                      {createdByUser?.name || createdByUser?.email || 'Unknown'}
                    </span>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Description Modal */}
      <Modal
        isOpen={isDescriptionModalOpen}
        onClose={() => setIsDescriptionModalOpen(false)}
        title='Workflow Description'
        secondaryAction={{
          text: 'Close',
          onClick: () => setIsDescriptionModalOpen(false),
        }}
      >
        <div className='p-4'>
          <p className='text-foreground text-sm leading-relaxed'>{workflowTitle}</p>
        </div>
      </Modal>

      {/* Assign User Modal */}
      <Modal
        isOpen={assignModalOpen}
        onClose={() => setAssignModalOpen(false)}
        title='Assign User'
        primaryAction={{
          text: assignLoading ? 'Assigning...' : 'Assign',
          onClick: handleAssignSubmit,
          disabled: assignLoading,
        }}
        secondaryAction={{
          text: 'Cancel',
          onClick: () => setAssignModalOpen(false),
        }}
      >
        <SearchUser
          excludeUserIds={[]}
          selectedUsers={selectedAssignUser}
          onUsersChange={users => setSelectedAssignUser(users)}
          label='Assign to User'
          width='100%'
          disabled={{
            value: selectedAssignUser.length >= 1,
            reason:
              'Only one user can be assigned at a time. Remove the existing user to assign a new one.',
          }}
        />
      </Modal>
    </div>
  );
};

export default WorkflowDetailsHeader;
