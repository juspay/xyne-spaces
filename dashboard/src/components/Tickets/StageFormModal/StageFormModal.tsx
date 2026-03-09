import React, { useState, useEffect } from 'react';
import { useZero } from '../../../../src/hooks/useZero';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { X } from 'lucide-react';
import { Dialog } from '../../ui/Dialog';
import Button from '../../ui/Button';
import { queries } from '../../../zero/queries';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { mutators } from '../../../zero/mutators';
import { useAuth } from '../../../hooks/useAuth';
import { FormEntityType, FormFieldType, TicketStageRequestStatus } from '@xyne/shared';
import type { Ticket, FormEntityValues, FormFields, TicketStageRequest } from '@xyne/shared';
import type { Stage } from '../../../routes/KanbanBoardScreen/KanbanBoardScreen.types';

interface StageFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  ticket: Ticket;
  targetStage: Stage;
  sourceStageName: string;
  formId: string;
  onSuccess?: () => void;
  isReviewer?: boolean;
  hasApprovers?: boolean; // true if stage has approvers (requires approval workflow)
  existingRequest?: TicketStageRequest | null; // Pre-fetched request for this stage
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
}) => {
  const zero = useZero();
  const { user } = useAuth();
  const [formData, setFormData] = useState<Record<string, string[]>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [existingApproval, setExistingApproval] = useState<TicketStageRequest | null>(null);

  const [formFields] = useCachedQuery(queries.getFormFieldsByFormId({ formId }));

  const [formEntityValues] = useCachedQuery(
    queries.getFormEntityValuesByEntityId({ entityId: ticket.id }),
  );

  useEffect(() => {
    setExistingApproval(existingRequest ?? null);

    const values = Array.isArray(formEntityValues) ? formEntityValues : [];
    const fields = Array.isArray(formFields) ? formFields : [];

    if (values.length > 0 && fields.length > 0) {
      const preFilled: Record<string, string[]> = {};

      const fieldIds = fields.map(f => f.id);

      const existingValues = values.filter((fev: FormEntityValues) => {
        // Filter by fieldId AND contextId (stageId) to ensure we only get values from the current form context
        // Since field IDs are unique to each form, this is sufficient to distinguish values
        return fieldIds.includes(fev.fieldId) && fev.contextId === targetStage.id;
      });

      existingValues.forEach((ev: FormEntityValues) => {
        const value = ev.actualFieldValue;
        if (value !== null && typeof value !== 'object') {
          preFilled[ev.fieldId] = [String(value)];
        } else if (Array.isArray(value)) {
          preFilled[ev.fieldId] = value as string[];
        }
      });

      if (Object.keys(preFilled).length > 0) {
        setFormData(preFilled);
      } else {
        setFormData({});
      }
    } else {
      // Clear form data for fresh transitions (no request for this stage yet)
      setFormData({});
    }
  }, [
    formEntityValues,
    formFields,
    existingRequest,
    targetStage.id,
    ticket.id,
    hasApprovers,
    isReviewer,
    formId,
  ]);

  const handleSubmit = (status: TicketStageRequestStatus): void => {
    // Only validate required fields when submitting for approval, not when saving as draft
    if (status === TicketStageRequestStatus.SUBMITTED) {
      const fields = Array.isArray(formFields) ? formFields : [];
      const missingFields = fields.filter(field => {
        if (field.isOptional) return false;
        const value = formData[field.id];
        return !value || value.length === 0 || value[0] === '';
      });

      if (missingFields.length > 0) {
        toast.error(
          `Please fill in all required fields: ${missingFields.map(f => f.fieldName).join(', ')}`,
        );
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const timestamp = Date.now();
      // Use existing approval ID if updating, or generate new UUID for new submission
      const submissionId = existingApproval?.id || uuidv4();

      // Save form entity values (actual form data) for each field
      const fields = Array.isArray(formFields) ? formFields : [];
      const values = Array.isArray(formEntityValues) ? formEntityValues : [];

      // Create/update form entity values for each field in the form
      for (const field of fields) {
        const fieldValue = formData[field.id] || [];
        // Find existing value for this field AND this context (stage)
        const existingValue = values.find(
          (fev: FormEntityValues) => fev.fieldId === field.id && fev.contextId === targetStage.id,
        );

        if (existingValue) {
          // Update existing form entity value
          zero.mutate(
            mutators.formEntityValue.update({
              formEntityValueId: existingValue.id,
              newValue: fieldValue,
              updatedAt: timestamp,
            }),
          );
        } else {
          // Create new form entity value for this field
          const formEntityValueId = uuidv4();
          zero.mutate(
            mutators.formEntityValue.create({
              id: formEntityValueId,
              entityId: ticket.id,
              entityType: FormEntityType.TICKET,
              fieldId: field.id,
              newValue: fieldValue,
              timestamp,
              contextId: targetStage.id, // Store stageId as contextId to distinguish values per stage
            }),
          );
        }
      }

      // isReviewed is true if status is 'approved' or 'rejected'
      const isReviewed =
        status === TicketStageRequestStatus.APPROVED ||
        status === TicketStageRequestStatus.REJECTED;

      // Generate activity IDs based on status changes
      const isNewSubmission = !existingApproval;
      const wasNotApproved = existingApproval?.status !== TicketStageRequestStatus.APPROVED;
      const wasNotRejected = existingApproval?.status !== TicketStageRequestStatus.REJECTED;

      const requestActivityId =
        status === TicketStageRequestStatus.SUBMITTED && isNewSubmission ? uuidv4() : undefined;
      const approvedActivityId =
        status === TicketStageRequestStatus.APPROVED && (isNewSubmission || wasNotApproved)
          ? uuidv4()
          : undefined;
      const rejectedActivityId =
        status === TicketStageRequestStatus.REJECTED && (isNewSubmission || wasNotRejected)
          ? uuidv4()
          : undefined;

      // For stages WITHOUT approvers: update ticket stage directly
      // For stages WITH approvers: create/update ticket stage request
      if (hasApprovers) {
        zero.mutate(
          mutators.ticketStageRequest.upsert({
            id: submissionId,
            ticketId: ticket.id,
            stageId: targetStage.id,
            ...(formId && { formId }),
            status,
            updatedBy: user?.id || '',
            ...(isReviewed && { reviewedBy: user?.id }),
            ...(requestActivityId && { requestActivityId }),
            ...(approvedActivityId && { approvedActivityId }),
            ...(rejectedActivityId && { rejectedActivityId }),
            updatedAt: timestamp,
          }),
        );
      } else {
        // For stages without approvers, directly update the ticket stage
        zero.mutate(
          mutators.ticket.update({
            id: ticket.id,
            stageName: targetStage.name,
            ...(targetStage.defaultTicketStatusV2 && {
              statusV2: targetStage.defaultTicketStatusV2,
            }),
            updatedAt: timestamp,
          }),
        );
      }

      // Only show toasts when there's a status change (not when just updating form values)
      const statusChanged = existingApproval?.status !== status;
      if (statusChanged) {
        if (status === TicketStageRequestStatus.DRAFT) {
          toast.success('Draft saved');
        } else if (status === TicketStageRequestStatus.SUBMITTED) {
          toast.success(hasApprovers ? 'Form submitted for approval' : 'Form submitted');
        } else if (status === TicketStageRequestStatus.APPROVED) {
          toast.success(hasApprovers ? 'Stage approved' : 'Stage updated');
        } else if (status === TicketStageRequestStatus.REJECTED) {
          toast.success('Stage rejected');
        }
      }
      onSuccess?.();
      onClose();
    } catch {
      toast.error('Failed to save form');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isApproved = hasApprovers && existingApproval?.status === TicketStageRequestStatus.APPROVED;
  const isRejected = hasApprovers && existingApproval?.status === TicketStageRequestStatus.REJECTED;
  const isSubmitted =
    hasApprovers && existingApproval?.status === TicketStageRequestStatus.SUBMITTED;
  const isDraft = hasApprovers && existingApproval?.status === TicketStageRequestStatus.DRAFT;

  const fields = Array.isArray(formFields) ? formFields : [];

  const showReviewButtons = hasApprovers && isReviewer && existingApproval !== null && !isDraft;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={onClose}
      title={isReviewer ? `${targetStage.name} Form Review` : `${targetStage.name} Form`}
    >
      <div className='p-6'>
        {/* Ticket Info Header */}
        <div className='mb-6 pb-4 border-b border-border flex items-center justify-between gap-4'>
          <div className='flex items-center gap-3'>
            <span className='px-2 py-0.5 bg-muted text-muted-foreground text-xs rounded'>
              {ticket.xyneId}
            </span>
            <span className='text-sm text-foreground'>
              <span className='font-medium'>{sourceStageName}</span>
              <span className='mx-2 text-muted-foreground'>→</span>
              <span className='font-medium text-blue-600'>{targetStage.name}</span>
            </span>
          </div>
          <button
            onClick={onClose}
            className='p-1 rounded-full hover:bg-muted transition-colors'
            aria-label='Close'
            data-track-category='Tickets'
            data-track-name='CloseStageFormModal'
          >
            <X className='w-4 h-4 text-muted-foreground' />
          </button>
        </div>

        {/* Status Messages - only show for stages with approvers */}
        {hasApprovers && (
          <>
            {isDraft && (
              <div className='mb-4 px-3 py-1.5 bg-muted rounded text-sm text-foreground inline-block'>
                Draft - Ready to submit
              </div>
            )}
            {isApproved && (
              <div className='mb-4 px-3 py-1.5 bg-muted rounded text-sm text-foreground inline-block'>
                Approved
              </div>
            )}
            {isRejected && (
              <div className='mb-4 px-3 py-1.5 bg-muted rounded text-sm text-foreground inline-block'>
                Rejected - Please resubmit
              </div>
            )}
            {isSubmitted && (
              <div className='mb-4 px-3 py-1.5 bg-muted rounded text-sm text-foreground inline-block'>
                Awaiting review
              </div>
            )}
          </>
        )}

        {fields.map((field: FormFields) => (
          <div key={field.id} className='mb-4'>
            <label className='block text-sm font-medium text-foreground mb-1'>
              {field.fieldName}
              {!field.isOptional && <span className='text-red-500'>*</span>}
            </label>
            {field.fieldType === FormFieldType.STRING && (
              <input
                type='text'
                value={formData[field.id]?.[0] || ''}
                onChange={e => setFormData({ ...formData, [field.id]: [e.target.value] })}
                disabled={isApproved}
                className='w-full px-3 py-2 border border-input rounded-md disabled:bg-muted disabled:text-muted-foreground'
                data-track-category='Tickets'
                data-track-name='StageFormStringInput'
                data-track-metadata={JSON.stringify({
                  fieldId: field.id,
                  fieldName: field.fieldName,
                })}
              />
            )}
            {field.fieldType === FormFieldType.NUMBER && (
              <input
                type='number'
                value={formData[field.id]?.[0] || ''}
                onChange={e => setFormData({ ...formData, [field.id]: [e.target.value] })}
                disabled={isApproved}
                className='w-full px-3 py-2 border border-input rounded-md disabled:bg-muted disabled:text-muted-foreground'
                data-track-category='Tickets'
                data-track-name='StageFormNumberInput'
                data-track-metadata={JSON.stringify({
                  fieldId: field.id,
                  fieldName: field.fieldName,
                })}
              />
            )}
            {field.fieldType === FormFieldType.BOOLEAN && (
              <div className='flex items-center gap-2'>
                <input
                  type='checkbox'
                  id={`field-${field.id}`}
                  checked={formData[field.id]?.[0] === 'true'}
                  onChange={e =>
                    setFormData({ ...formData, [field.id]: [String(e.target.checked)] })
                  }
                  disabled={isApproved}
                  className='h-4 w-4 text-blue-600 border-input rounded disabled:opacity-50'
                  data-track-category='Tickets'
                  data-track-name='StageFormCheckbox'
                  data-track-metadata={JSON.stringify({
                    fieldId: field.id,
                    fieldName: field.fieldName,
                  })}
                />
                <label htmlFor={`field-${field.id}`} className='text-sm text-muted-foreground'>
                  Yes
                </label>
              </div>
            )}
            {field.fieldType === FormFieldType.DATE && (
              <input
                type='date'
                value={formData[field.id]?.[0] || ''}
                onChange={e => setFormData({ ...formData, [field.id]: [e.target.value] })}
                disabled={isApproved}
                className='w-full px-3 py-2 border border-input rounded-md disabled:bg-muted disabled:text-muted-foreground'
                data-track-category='Tickets'
                data-track-name='StageFormDateInput'
                data-track-metadata={JSON.stringify({
                  fieldId: field.id,
                  fieldName: field.fieldName,
                })}
              />
            )}
            {(field.fieldType === FormFieldType.SINGLE_SELECT ||
              field.fieldType === FormFieldType.MULTI_SELECT) && (
              <select
                value={formData[field.id]?.[0] || ''}
                onChange={e =>
                  setFormData({
                    ...formData,
                    [field.id]:
                      field.fieldType === FormFieldType.MULTI_SELECT
                        ? Array.from(e.target.selectedOptions).map(opt => opt.value)
                        : [e.target.value],
                  })
                }
                disabled={isApproved}
                multiple={field.fieldType === FormFieldType.MULTI_SELECT}
                className='w-full px-3 py-2 border border-input rounded-md disabled:bg-muted disabled:text-muted-foreground'
                data-track-category='Tickets'
                data-track-name='StageFormSelect'
                data-track-metadata={JSON.stringify({
                  fieldId: field.id,
                  fieldName: field.fieldName,
                })}
              >
                {(field.fieldEnum as string[] | null | undefined)?.map((option: string) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            )}
            {field.fieldType === FormFieldType.USER && (
              <input
                type='text'
                placeholder='User ID'
                value={formData[field.id]?.[0] || ''}
                onChange={e => setFormData({ ...formData, [field.id]: [e.target.value] })}
                disabled={isApproved}
                className='w-full px-3 py-2 border border-input rounded-md disabled:bg-muted disabled:text-muted-foreground'
                data-track-category='Tickets'
                data-track-name='StageFormUserInput'
                data-track-metadata={JSON.stringify({
                  fieldId: field.id,
                  fieldName: field.fieldName,
                })}
              />
            )}
          </div>
        ))}

        {/* Comment input and actions at bottom */}
        <div className='mt-4 pt-4 border-t border-border flex justify-end gap-3'>
          {showReviewButtons ? (
            <>
              <Button
                variant='secondary'
                onClick={() => {
                  void handleSubmit(TicketStageRequestStatus.REJECTED);
                }}
                disabled={isSubmitting}
                data-track-category='Tickets'
                data-track-name='RejectStageForm'
              >
                {isSubmitting ? 'Rejecting...' : 'Reject'}
              </Button>
              <Button
                onClick={() => {
                  void handleSubmit(TicketStageRequestStatus.APPROVED);
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
          ) : hasApprovers ? (
            <>
              {/* Draft status: Show both Save as Draft and Submit for Approval */}
              <Button
                variant='secondary'
                onClick={() => {
                  void handleSubmit(TicketStageRequestStatus.DRAFT);
                }}
                disabled={isSubmitting}
                data-track-category='Tickets'
                data-track-name='SaveStageFormAsDraft'
              >
                {isSubmitting ? 'Saving...' : 'Save as Draft'}
              </Button>
              <Button
                onClick={() => {
                  void handleSubmit(TicketStageRequestStatus.SUBMITTED);
                }}
                disabled={isSubmitting}
                data-track-category='Tickets'
                data-track-name='SubmitStageFormForApproval'
              >
                {isSubmitting ? 'Submitting...' : 'Submit for Approval'}
              </Button>
            </>
          ) : (
            <Button
              onClick={() => {
                // If no approvers, just save form data without approval workflow
                void handleSubmit(TicketStageRequestStatus.APPROVED);
              }}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Saving...' : 'Save'}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
};

export default StageFormModal;
