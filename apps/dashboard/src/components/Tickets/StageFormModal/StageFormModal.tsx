import React, { useEffect, useState } from 'react';
import { useZero } from '../../../../src/hooks/useZero';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { MultipleCrossCancelDefault as X } from '@xyne/icons';
import { Dialog } from '../../ui/Dialog';
import Button from '../../ui/Button';
import Tooltip from '../../ui/Tooltip';
import { mutators } from '../../../zero/mutators';
import { useAuth } from '../../../hooks/useAuth';
import { TicketStageRequestStatus } from '@xyne/shared';
import type { Ticket, TicketStageRequest, ReenterMode } from '@xyne/shared';
import type { Stage } from '../../../routes/KanbanBoardScreen/KanbanBoardScreen.types';
import { StageFormFields, stageFormControlClassName } from '../StageFormFields/StageFormFields';
import {
  useStageForm,
  type StageFormResolvedInputs,
  type StageVisitEta,
} from '../StageFormFields/useStageForm';
import { StageFormConflictDialog } from '../StageFormInlinePanel/StageFormConflictDialog';
import { useStageFormConflictFlow } from '../StageFormInlinePanel/useStageFormConflictFlow';

interface StageFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  ticket: Ticket;
  targetStage: Stage;
  sourceStageName: string;
  formId: string;
  onSuccess?: () => void;
  isReviewer?: boolean;
  hasApprovers?: boolean;
  existingRequest?: TicketStageRequest | null;
  isNonLinearBoard?: boolean;
  showPersistedDocValues?: boolean;
  reenterMode?: ReenterMode | null;
  targetStageEtas?: readonly StageVisitEta[];
}

export const StageFormModal: React.FC<StageFormModalProps> = ({
  isOpen,
  onClose,
  ticket,
  targetStage,
  sourceStageName,
  formId,
  onSuccess,
  isReviewer = false,
  hasApprovers = false,
  existingRequest = null,
  isNonLinearBoard = false,
  showPersistedDocValues = false,
  reenterMode,
  targetStageEtas,
}) => {
  const zero = useZero();
  const { user } = useAuth();

  const {
    fields,
    valuesForRender,
    isFieldsLoading,
    formData,
    setFormData,
    localDocChanges,
    setLocalDocChanges,
    missingRequiredFields,
    hasActiveRequestForDocPrefill,
    getContentConflicts,
    applyConflictResolution,
    persistForm,
    commitMove,
  } = useStageForm({
    ticket,
    targetStage,
    formId,
    hasApprovers,
    isNonLinearBoard,
    reenterMode,
    targetStageEtas,
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [existingApproval, setExistingApproval] = useState<TicketStageRequest | null>(null);
  const [reviewerComment, setReviewerComment] = useState('');

  useEffect(() => {
    setExistingApproval(existingRequest ?? null);
  }, [existingRequest]);

  const performSave = async (overrides?: StageFormResolvedInputs): Promise<boolean> => {
    const saved = await persistForm('save', overrides);
    if (!saved) return false;
    setLocalDocChanges(new Map());
    toast.success('Form saved');
    onSuccess?.();
    onClose();
    return true;
  };

  const performMove = async (overrides?: StageFormResolvedInputs): Promise<boolean> => {
    const effectiveFormData = await persistForm(hasApprovers ? 'submit' : 'move', overrides);
    if (!effectiveFormData) return false;
    if (hasApprovers) {
      toast.success('Form submitted for approval');
    } else {
      await commitMove(effectiveFormData);
      toast.success('Stage updated');
    }
    setLocalDocChanges(new Map());
    onSuccess?.();
    onClose();
    return true;
  };

  const conflict = useStageFormConflictFlow({
    getContentConflicts,
    applyConflictResolution,
    performSave,
    performMove,
  });

  const handleSubmitterSubmit = async (): Promise<void> => {
    if (missingRequiredFields.length > 0) {
      toast.error(
        `Please fill in all required fields: ${missingRequiredFields
          .map(f => f.fieldName)
          .join(', ')}`,
      );
      return;
    }
    setIsSubmitting(true);
    try {
      await conflict.run('move');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReviewerDecision = async (
    status: TicketStageRequestStatus.APPROVED | TicketStageRequestStatus.REJECTED,
  ): Promise<void> => {
    const trimmedComment = reviewerComment.trim();
    if (status === TicketStageRequestStatus.REJECTED && !trimmedComment) {
      toast.error('Please add a comment explaining the rejection');
      return;
    }

    setIsSubmitting(true);
    try {
      const persisted = await persistForm('review');
      if (!persisted) return;

      const timestamp = Date.now();
      const isNewSubmission = !existingApproval;
      const wasNotApproved = existingApproval?.status !== TicketStageRequestStatus.APPROVED;
      const wasNotRejected = existingApproval?.status !== TicketStageRequestStatus.REJECTED;
      const statusChanged = existingApproval?.status !== status;

      const approvedActivityId =
        status === TicketStageRequestStatus.APPROVED && (isNewSubmission || wasNotApproved)
          ? uuidv4()
          : undefined;
      const rejectedActivityId =
        status === TicketStageRequestStatus.REJECTED && (isNewSubmission || wasNotRejected)
          ? uuidv4()
          : undefined;
      const shouldAttachComment = trimmedComment.length > 0;
      const commentMessageId = shouldAttachComment ? uuidv4() : undefined;

      zero.mutate(
        mutators.ticketStageRequest.upsert({
          id: existingApproval?.id ?? uuidv4(),
          ticketId: ticket.id,
          stageId: targetStage.id,
          ...(formId && { formId }),
          status,
          updatedBy: user?.id || '',
          reviewedBy: user?.id,
          ...(approvedActivityId && { approvedActivityId }),
          ...(rejectedActivityId && { rejectedActivityId }),
          ...(commentMessageId && { commentMessageId, comment: trimmedComment }),
          updatedAt: timestamp,
        }),
      );

      if (statusChanged) {
        toast.success(
          status === TicketStageRequestStatus.APPROVED ? 'Stage approved' : 'Stage rejected',
        );
      }
      setReviewerComment('');
      setLocalDocChanges(new Map());
      onSuccess?.();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save form');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isApproved = hasApprovers && existingApproval?.status === TicketStageRequestStatus.APPROVED;
  const isRejected = hasApprovers && existingApproval?.status === TicketStageRequestStatus.REJECTED;
  const isSubmitted =
    hasApprovers && existingApproval?.status === TicketStageRequestStatus.SUBMITTED;
  const isDraft = hasApprovers && existingApproval?.status === TicketStageRequestStatus.DRAFT;
  const isFormReadOnly = isApproved || (isSubmitted && !isReviewer);
  const shouldShowPersistedDocValues =
    hasActiveRequestForDocPrefill || existingApproval !== null || showPersistedDocValues;

  const reviewerCommentContent =
    (
      existingRequest as unknown as {
        reviewerCommentMessage?: {
          content?: string | null;
          metadata?: { rawComment?: string | null } | null;
        } | null;
      } | null
    )?.reviewerCommentMessage?.metadata?.rawComment ??
    (
      existingRequest as unknown as {
        reviewerCommentMessage?: { content?: string | null } | null;
      } | null
    )?.reviewerCommentMessage?.content ??
    null;

  const showReviewButtons = hasApprovers && isReviewer && existingApproval !== null && !isDraft;
  const hasMissingRequiredFields = missingRequiredFields.length > 0;

  return (
    <>
      <Dialog
        open={isOpen}
        onOpenChange={onClose}
        title={isReviewer ? `${targetStage.name} Form Review` : `${targetStage.name} Form`}
      >
        <div className='max-h-[80vh] overflow-y-auto p-6'>
          <div className='mb-6 flex items-center justify-between gap-4 border-b border-border pb-4'>
            <div className='flex items-center gap-3'>
              <span className='rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground'>
                {ticket.xyneId}
              </span>
              <span className='text-sm text-foreground'>
                <span className='font-medium'>{sourceStageName}</span>
                <span className='mx-2 text-muted-foreground'>→</span>
                <span className='font-medium text-blue-600'>{targetStage.name}</span>
              </span>
            </div>
            <button
              type='button'
              onClick={onClose}
              className='rounded-full p-1 transition-colors hover:bg-muted'
              aria-label='Close'
              data-track-category='Tickets'
              data-track-name='CloseStageFormModal'
            >
              <X className='h-4 w-4 text-muted-foreground' />
            </button>
          </div>

          {hasApprovers && (
            <>
              {isDraft && (
                <div className='mb-4 inline-block rounded bg-muted px-3 py-1.5 text-sm text-foreground'>
                  Draft - Ready to submit
                </div>
              )}
              {isApproved && (
                <div className='mb-4 inline-block rounded bg-muted px-3 py-1.5 text-sm text-foreground'>
                  Approved
                </div>
              )}
              {isRejected && (
                <div className='mb-4 inline-block rounded bg-muted px-3 py-1.5 text-sm text-foreground'>
                  Rejected - Please resubmit
                </div>
              )}
              {isSubmitted && (
                <div className='mb-4 inline-block rounded bg-muted px-3 py-1.5 text-sm text-foreground'>
                  Awaiting review
                </div>
              )}
              {reviewerCommentContent && (
                <div className='mb-4 rounded border border-border bg-muted/60 px-3 py-2 text-sm text-foreground'>
                  <div className='mb-1 text-xs text-muted-foreground'>
                    {isRejected
                      ? 'Reason for rejection'
                      : isApproved
                        ? 'Reviewer comment'
                        : 'Last reviewer comment'}
                  </div>
                  <div className='whitespace-pre-wrap'>{reviewerCommentContent}</div>
                </div>
              )}
            </>
          )}

          <StageFormFields
            fields={fields}
            formData={formData}
            setFormData={setFormData}
            localDocChanges={localDocChanges}
            setLocalDocChanges={setLocalDocChanges}
            valuesForRender={valuesForRender}
            targetStageId={targetStage.id}
            disabled={isFormReadOnly}
            readOnlyDocs={isReviewer}
            showPersistedDocValues={shouldShowPersistedDocValues}
            idPrefix='stage-field'
            trackNamePrefix='StageForm'
          />

          {showReviewButtons && (
            <div className='mt-4'>
              <label
                htmlFor='reviewer-comment'
                className='mb-1 block text-sm font-medium text-foreground'
              >
                Comment <span className='text-xs text-muted-foreground'>(required on reject)</span>
              </label>
              <textarea
                id='reviewer-comment'
                value={reviewerComment}
                onChange={e => setReviewerComment(e.target.value)}
                placeholder='Explain your decision…'
                rows={3}
                className={`${stageFormControlClassName} resize-y`}
                disabled={isSubmitting}
                data-track-category='Tickets'
                data-track-name='StageFormReviewerCommentInput'
              />
            </div>
          )}

          <div className='mt-4 flex justify-end gap-3 border-t border-border pt-4'>
            {showReviewButtons ? (
              <>
                <Button
                  variant='secondary'
                  onClick={() => {
                    void handleReviewerDecision(TicketStageRequestStatus.REJECTED);
                  }}
                  disabled={isSubmitting}
                  data-track-category='Tickets'
                  data-track-name='RejectStageForm'
                >
                  {isSubmitting ? 'Rejecting...' : 'Reject'}
                </Button>
                <Button
                  onClick={() => {
                    void handleReviewerDecision(TicketStageRequestStatus.APPROVED);
                  }}
                  disabled={isSubmitting}
                  data-track-category='Tickets'
                  data-track-name='ApproveStageForm'
                >
                  {isSubmitting ? 'Approving...' : 'Approve'}
                </Button>
              </>
            ) : hasApprovers && isApproved ? (
              <Button disabled>Form approved</Button>
            ) : (
              <Tooltip
                content={
                  hasApprovers
                    ? 'Submit the form for approval'
                    : 'Save your changes and move to the next stage'
                }
              >
                <Button
                  onClick={() => {
                    void handleSubmitterSubmit();
                  }}
                  disabled={
                    isFormReadOnly ||
                    hasMissingRequiredFields ||
                    isSubmitting ||
                    isFieldsLoading ||
                    conflict.isConfirming
                  }
                  data-track-category='Tickets'
                  data-track-name={hasApprovers ? 'SubmitStageFormForApproval' : 'SubmitStageForm'}
                >
                  {isSubmitting ? 'Submitting...' : hasApprovers ? 'Submit for approval' : 'Submit'}
                </Button>
              </Tooltip>
            )}
          </div>
        </div>
      </Dialog>

      <StageFormConflictDialog
        open={conflict.conflicts.length > 0}
        conflicts={conflict.conflicts}
        resolution={conflict.resolution}
        isConfirming={conflict.isConfirming}
        onChange={conflict.onChange}
        onCancel={conflict.onCancel}
        onConfirm={() => void conflict.onConfirm()}
      />
    </>
  );
};
