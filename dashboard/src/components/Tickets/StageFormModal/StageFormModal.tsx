import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useZero } from '../../../../src/hooks/useZero';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { X } from 'lucide-react';
import { SingleSelect, SelectMenuAlignment } from '@juspay/blend-design-system';
import { Dialog } from '../../ui/Dialog';
import Button from '../../ui/Button';
import { MultiSelect } from '../../ui/MultiSelect';
import { queries } from '../../../zero/queries';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { mutators } from '../../../zero/mutators';
import { useAuth } from '../../../hooks/useAuth';
import { apiInstance } from '../../../services/clients/apiClient';
import { FormEntityType, FormFieldType, TicketStageRequestStatus } from '@xyne/shared';
import type { Ticket, FormEntityValues, FormFields, TicketStageRequest } from '@xyne/shared';
import type { Stage } from '../../../routes/KanbanBoardScreen/KanbanBoardScreen.types';
import { StageFormDocField } from './StageFormDocField';
import { cn } from '../../../utils/classNames';

// Local in-session state for a DOC field. Tracked separately from formData
// because the actual attachmentId doesn't exist until submit-time upload.
//   { file: File }   → user picked a new file to upload
//   { removed: true } → user removed the previously-persisted attachment
type DocLocalChange = { file: File } | { removed: true };

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
  isNonLinearBoard?: boolean;
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
}) => {
  const zero = useZero();
  const { user } = useAuth();
  const [formData, setFormData] = useState<Record<string, string[]>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [existingApproval, setExistingApproval] = useState<TicketStageRequest | null>(null);
  // Reviewer's comment for APPROVE/REJECT. Required on REJECT; optional on APPROVE.
  const [reviewerComment, setReviewerComment] = useState('');

  // In-session DOC field changes — pure in-memory state, no DB writes happen
  // until Submit. On submit, we POST each pending file to /attachments/upload
  // (bound directly to a FormEntityValues row) and use the returned attachmentId
  // in the Zero mutator. Closing the modal without submit discards everything
  // here — no cleanup needed.
  const [localDocChanges, setLocalDocChanges] = useState<Map<string, DocLocalChange>>(
    () => new Map(),
  );

  const [formFields, formFieldsDetails] = useCachedQuery(queries.getFormFieldsByFormId({ formId }));

  const [formEntityValues] = useCachedQuery(
    queries.getFormEntityValuesByEntityId({ entityId: ticket.id }),
  );

  // Reuse existing record ID on revisits (unique constraint on ticketId+stageId).
  const [ticketStageRequestsForTicket] = useCachedQuery(
    queries.getTicketStageRequests({ ticketId: ticket.id }),
  );

  useEffect(() => {
    setExistingApproval(existingRequest ?? null);

    const values = Array.isArray(formEntityValues) ? formEntityValues : [];
    const fields = Array.isArray(formFields) ? formFields : [];

    // Decide whether to pre-fill the form from previously saved values.
    // Linear: pre-fill whenever saved values exist (legacy behaviour).
    // Non-linear: pre-fill on an active pending (SUBMITTED) request OR on a fresh revisit —
    // the prior visit's values are already fetched (formEntityValues), keyed by (ticket, stage),
    // so "same form / same from / same to on another visit" resolves to the last submission.
    const hasActiveRequest = existingRequest?.status === TicketStageRequestStatus.SUBMITTED;
    const hasPriorValuesForStage = values.some(
      (fev: FormEntityValues) => fev.contextId === targetStage.id,
    );
    const shouldPrefill = isNonLinearBoard ? hasActiveRequest || hasPriorValuesForStage : true;

    if (shouldPrefill && values.length > 0 && fields.length > 0) {
      const preFilled: Record<string, string[]> = {};

      const fieldIds = fields.map(f => f.id);

      // On RESET re-entries, multiple values can exist for the same fieldId+contextId
      // (one per visit). Keep only the most recently updated value per field so the
      // pre-fill reflects the current visit's submission, not an older one.
      const latestByField = new Map<string, FormEntityValues>();
      values
        .filter(
          (fev: FormEntityValues) =>
            fieldIds.includes(fev.fieldId) && fev.contextId === targetStage.id,
        )
        .forEach((ev: FormEntityValues) => {
          const current = latestByField.get(ev.fieldId);
          if (!current || (ev.updatedAt ?? 0) > (current.updatedAt ?? 0)) {
            latestByField.set(ev.fieldId, ev);
          }
        });

      latestByField.forEach((ev: FormEntityValues) => {
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
    isNonLinearBoard,
  ]);

  // True if the field has SOMETHING the user has effectively provided —
  // either a persisted value in formData, or a pending in-session DOC upload.
  // A DOC field marked as 'removed' is treated as empty.
  const isFieldFilled = useCallback(
    (field: FormFields): boolean => {
      const change = localDocChanges.get(field.id);

      if (field.fieldType === FormFieldType.DOC) {
        if (change && 'file' in change) return true;
        if (change && 'removed' in change) return false;
        const value = formData[field.id];
        if (value && value.length > 0 && value[0]?.trim() !== '') return true;
        const values = Array.isArray(formEntityValues) ? formEntityValues : [];
        const latestValue = values
          .filter(
            (fev: FormEntityValues) => fev.fieldId === field.id && fev.contextId === targetStage.id,
          )
          .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
        return !!latestValue?.attachments?.[0];
      }

      const value = formData[field.id];
      if (!value || value.length === 0) return false;

      if (field.fieldType === FormFieldType.MULTI_SELECT) {
        return value.some(v => v.trim() !== '');
      }

      if (field.fieldType === FormFieldType.BOOLEAN) {
        return value[0] === 'true' || value[0] === 'false';
      }

      return value.some(v => v.trim() !== '');
    },
    [formData, localDocChanges, formEntityValues, targetStage.id],
  );

  const isFormValid = useMemo(() => {
    if (formFieldsDetails.type !== 'complete') return false;
    const fieldsList = Array.isArray(formFields) ? formFields : [];
    return fieldsList.filter(field => !field.isOptional).every(field => isFieldFilled(field));
  }, [formFields, formFieldsDetails.type, isFieldFilled]);

  // Resolve the FormEntityValues row id we'd update (or undefined if a fresh
  // create is required). Mirrors the existing mutator-time lookup logic so
  // we can pre-compute the id before the upload — the upload needs to know
  // it to set entityId on the new MessageAttachment row.
  const resolveExistingValueId = (
    fieldId: string,
    values: FormEntityValues[],
    forApproverPath: boolean,
  ): string | undefined => {
    if (forApproverPath && !existingApproval) return undefined;
    return values
      .filter(
        (fev: FormEntityValues) => fev.fieldId === fieldId && fev.contextId === targetStage.id,
      )
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0]?.id;
  };

  const handleSubmit = async (status: TicketStageRequestStatus): Promise<void> => {
    // Validate required fields for all submitter saves (with or without approvers).
    const isReviewerAction =
      hasApprovers &&
      isReviewer &&
      existingApproval !== null &&
      (status === TicketStageRequestStatus.APPROVED ||
        status === TicketStageRequestStatus.REJECTED);

    if (!isReviewerAction) {
      const fields = Array.isArray(formFields) ? formFields : [];
      const missingFields = fields.filter(field => !field.isOptional && !isFieldFilled(field));

      if (missingFields.length > 0) {
        toast.error(
          `Please fill in all required fields: ${missingFields.map(f => f.fieldName).join(', ')}`,
        );
        return;
      }
    }

    // Reviewer-side validation: a non-empty comment is mandatory on REJECT so the
    // submitter knows why. APPROVE accepts an optional comment.
    const trimmedComment = reviewerComment.trim();
    if (status === TicketStageRequestStatus.REJECTED && hasApprovers && isReviewer) {
      if (!trimmedComment) {
        toast.error('Please add a comment explaining the rejection');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const timestamp = Date.now();
      const fields = Array.isArray(formFields) ? formFields : [];
      const values = Array.isArray(formEntityValues) ? formEntityValues : [];

      // Pre-compute upload plan for DOC fields with in-session changes. We
      // need to allocate the FormEntityValues row id BEFORE uploading because
      // the upload writes a MessageAttachment row whose entityId points at it.
      const docUploadsByField = new Map<string, { file: File; formEntityValueId: string }>();
      const docRemovedFields = new Set<string>();
      for (const field of fields) {
        if (field.fieldType !== FormFieldType.DOC) continue;
        const change = localDocChanges.get(field.id);
        if (!change) continue;
        if ('file' in change) {
          const existingValueId = resolveExistingValueId(field.id, values, hasApprovers);
          docUploadsByField.set(field.id, {
            file: change.file,
            formEntityValueId: existingValueId ?? uuidv4(),
          });
        } else {
          docRemovedFields.add(field.id);
        }
      }

      // Upload pending DOC files. Each POST writes a MessageAttachment row with
      // entityType=FORM_ENTITY_VALUE bound directly to our pre-allocated
      // formEntityValueId — no DRAFT, no claim, no channel-draft tie. The
      // server returns the attachment id which we then thread into the Zero
      // mutator's newValue.
      const uploadedAttachmentIdByField = new Map<string, string>();
      for (const [fieldId, plan] of docUploadsByField) {
        const uploadForm = new FormData();
        uploadForm.append('files', plan.file);
        uploadForm.append('entityId', plan.formEntityValueId);
        uploadForm.append('entityType', 'FORM_ENTITY_VALUE');
        uploadForm.append('fileMetadata', JSON.stringify([{ fileIndex: 0, hasThumbnail: false }]));
        const response = await apiInstance.post('/attachments/upload', uploadForm, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        const attachmentId = (response.data as { attachments?: Array<{ id: string }> })
          ?.attachments?.[0]?.id;
        if (!attachmentId) {
          throw new Error('Upload succeeded but no attachment id returned');
        }
        uploadedAttachmentIdByField.set(fieldId, attachmentId);
      }

      // Build the effective formData the rest of the submit uses. DOC fields
      // with a fresh upload get the returned attachment id; DOC fields the
      // user removed get an empty array so the mutator clears actualFieldValue.
      const effectiveFormData: Record<string, string[]> = { ...formData };
      for (const [fieldId, attachmentId] of uploadedAttachmentIdByField) {
        effectiveFormData[fieldId] = [attachmentId];
      }
      for (const fieldId of docRemovedFields) {
        effectiveFormData[fieldId] = [];
      }

      // For DOC fields needing a fresh CREATE, use the pre-allocated
      // formEntityValues id so it matches the entityId we already wrote into
      // MessageAttachment.entityId during upload. Without this, the relation
      // wouldn't resolve.
      const formEntityValueIdsByField = new Map<string, string>();
      for (const [fieldId, plan] of docUploadsByField) {
        formEntityValueIdsByField.set(fieldId, plan.formEntityValueId);
      }
      // For revisits: reuse the existing record's ID to avoid the unique constraint on
      // (ticketId, stageId). existingApproval covers the SUBMITTED/DRAFT case; the
      // ticketStageRequestsForTicket lookup covers the APPROVED case from a prior visit.
      const existingForStage = (
        ticketStageRequestsForTicket as TicketStageRequest[] | undefined
      )?.find((r: TicketStageRequest) => r.stageId === targetStage.id);
      const submissionId = existingApproval?.id ?? existingForStage?.id ?? uuidv4();

      const isReviewed =
        status === TicketStageRequestStatus.APPROVED ||
        status === TicketStageRequestStatus.REJECTED;
      const isNewSubmission = !existingApproval;
      const wasNotApproved = existingApproval?.status !== TicketStageRequestStatus.APPROVED;
      const wasNotRejected = existingApproval?.status !== TicketStageRequestStatus.REJECTED;
      const statusChanged = existingApproval?.status !== status;

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

      if (hasApprovers) {
        // Version for a fresh-visit create. form_entity_values has a unique constraint on
        // (entityId, entityType, fieldId, contextId, version), so creating a new visit's
        // values at the default version=1 would collide with the previous visit's records.
        // Use maxExistingVersion+1 (across this stage's values) so the new visit's values are
        // distinct and don't overwrite the prior visit's. For RESET re-entries this aligns
        // with the eventual newVisitIndex; the approval-time promotion (mutators.ts) normalizes
        // it to the exact visitIndex. Computed once so all fields of this submission share it.
        const maxStageVersion = values
          .filter((fev: FormEntityValues) => fev.contextId === targetStage.id)
          .reduce((max, fev) => Math.max(max, fev.version ?? 1), 0);
        const freshVisitVersion = maxStageVersion + 1;

        // Save form entity values optimistically via Zero
        for (const field of fields) {
          const fieldValue = effectiveFormData[field.id] || [];
          // Only reuse an existing value record when we're editing the CURRENT pending
          // submission (an active SUBMITTED/DRAFT request exists → existingApproval set).
          // On a fresh visit (existingApproval is null because any prior request was
          // APPROVED/REJECTED), CREATE a new record at freshVisitVersion instead of
          // overwriting the previous visit's data — mirroring how the no-approver path
          // already versions per visit.
          const existingValue = existingApproval
            ? (values
                .filter(
                  (fev: FormEntityValues) =>
                    fev.fieldId === field.id && fev.contextId === targetStage.id,
                )
                .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0] ?? null)
            : null;
          if (existingValue) {
            zero.mutate(
              mutators.formEntityValue.update({
                formEntityValueId: existingValue.id,
                newValue: fieldValue,
                updatedAt: timestamp,
              }),
            );
          } else {
            // For DOC fields with a fresh upload this turn, use the
            // pre-allocated id so the relation joins back to the
            // MessageAttachment row we already wrote during upload.
            const formEntityValueId = formEntityValueIdsByField.get(field.id) ?? uuidv4();
            zero.mutate(
              mutators.formEntityValue.create({
                id: formEntityValueId,
                entityId: ticket.id,
                entityType: FormEntityType.TICKET,
                fieldId: field.id,
                newValue: fieldValue,
                timestamp,
                contextId: targetStage.id,
                version: freshVisitVersion,
              }),
            );
          }
        }

        // Attach reviewer's comment when present (required on REJECT, optional on
        // APPROVE — validated above). The mutator will atomically insert a USER
        // message in the ticket conversation and link it on the request row.
        const shouldAttachComment =
          isReviewed &&
          isReviewer &&
          trimmedComment.length > 0 &&
          (status === TicketStageRequestStatus.APPROVED ||
            status === TicketStageRequestStatus.REJECTED);
        const commentMessageId = shouldAttachComment ? uuidv4() : undefined;

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
            ...(commentMessageId && { commentMessageId, comment: trimmedComment }),
            updatedAt: timestamp,
          }),
        );

        if (statusChanged) {
          if (status === TicketStageRequestStatus.SUBMITTED) {
            toast.success('Form submitted for approval');
          } else if (status === TicketStageRequestStatus.APPROVED) {
            toast.success('Stage approved');
          } else if (status === TicketStageRequestStatus.REJECTED) {
            toast.success('Stage rejected');
          }
        }
        // Clear the textarea so a subsequent open doesn't repeat the prior comment.
        setReviewerComment('');
        setLocalDocChanges(new Map());
        onSuccess?.();
        onClose();
      } else {
        // Build fieldName→value map so the mutator can persist values by visitIndex
        const formValuesByName: Record<string, unknown> = {};
        for (const field of fields) {
          const rawValue = effectiveFormData[field.id];
          if (rawValue !== undefined) {
            formValuesByName[field.fieldName] = rawValue.length === 1 ? rawValue[0] : rawValue;
          }
        }

        // formValuesJson is always passed (even if "{}") so the server-side form gate
        // knows the form was shown and skips blocking the transition.
        if (isNonLinearBoard) {
          zero.mutate(
            mutators.nonLinear.transition({
              ticketId: ticket.id,
              toStageName: targetStage.name,
              now: Date.now(),
              formValuesJson: JSON.stringify(formValuesByName),
            }),
          );
        } else {
          // Linear board: persist the submitted form values, then move the ticket stage
          // (matching the legacy behaviour — values saved + stage's default status applied).
          for (const field of fields) {
            const fieldValue = effectiveFormData[field.id] || [];
            const existingValue = values.find(
              (fev: FormEntityValues) =>
                fev.fieldId === field.id && fev.contextId === targetStage.id,
            );
            if (existingValue) {
              zero.mutate(
                mutators.formEntityValue.update({
                  formEntityValueId: existingValue.id,
                  newValue: fieldValue,
                  updatedAt: timestamp,
                }),
              );
            } else {
              // Same DOC-id pre-allocation as the approver path — the relation
              // needs MessageAttachment.entityId === FormEntityValues.id.
              const formEntityValueId = formEntityValueIdsByField.get(field.id) ?? uuidv4();
              zero.mutate(
                mutators.formEntityValue.create({
                  id: formEntityValueId,
                  entityId: ticket.id,
                  entityType: FormEntityType.TICKET,
                  fieldId: field.id,
                  newValue: fieldValue,
                  timestamp,
                  contextId: targetStage.id,
                }),
              );
            }
          }

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

        if (statusChanged) {
          toast.success('Stage updated');
        }
        setLocalDocChanges(new Map());
        onSuccess?.();
        onClose();
      }
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

  const fields = Array.isArray(formFields) ? formFields : [];
  const isFieldsLoading = formFieldsDetails.type !== 'complete';
  const valuesForRender = Array.isArray(formEntityValues) ? formEntityValues : [];

  // Resolve the reviewer's last comment from the modal's own query
  // (ticketStageRequestsForTicket, joined via .related('reviewerCommentMessage')).
  // Reading via existingApproval prop is unreliable because the parent's query
  // may not include the relation.
  const requestForStage = (
    ticketStageRequestsForTicket as unknown as
      | Array<{
          stageId: string;
          reviewerCommentMessage?: {
            content?: string | null;
            metadata?: { rawComment?: string | null } | null;
          } | null;
        }>
      | undefined
  )?.find(r => r.stageId === targetStage.id);
  // Prefer metadata.rawComment so the modal shows the unprefixed text under its
  // own "Reason for rejection" label. Fall back to content for any legacy
  // messages stored before the prefix was introduced.
  const reviewerCommentContent =
    requestForStage?.reviewerCommentMessage?.metadata?.rawComment ??
    requestForStage?.reviewerCommentMessage?.content ??
    null;

  const showReviewButtons = hasApprovers && isReviewer && existingApproval !== null && !isDraft;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={onClose}
      title={isReviewer ? `${targetStage.name} Form Review` : `${targetStage.name} Form`}
    >
      <div className='p-6 max-h-[80vh] overflow-y-auto'>
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
            {/* Persisted reviewer comment — appears once the reviewer has approved
                or rejected with a comment. Pulled via the reviewerCommentMessage
                relation on the TicketStageRequest. Stays visible after
                resubmission (DRAFT/SUBMITTED) so the submitter has the prior
                reason on hand while fixing things. */}
            {reviewerCommentContent && (
              <div className='mb-4 px-3 py-2 bg-muted/60 border border-border rounded text-sm text-foreground'>
                <div className='text-xs text-muted-foreground mb-1'>
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
                onChange={e => setFormData(prev => ({ ...prev, [field.id]: [e.target.value] }))}
                disabled={isFormReadOnly}
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
                onChange={e => setFormData(prev => ({ ...prev, [field.id]: [e.target.value] }))}
                disabled={isFormReadOnly}
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
              <div
                className='inline-flex rounded-md border border-input overflow-hidden'
                role='radiogroup'
                aria-label={field.fieldName}
              >
                {(['true', 'false'] as const).map((option, index) => {
                  const label = option === 'true' ? 'Yes' : 'No';
                  const isSelected = formData[field.id]?.[0] === option;
                  return (
                    <button
                      key={option}
                      type='button'
                      role='radio'
                      aria-checked={isSelected}
                      onClick={() => setFormData(prev => ({ ...prev, [field.id]: [option] }))}
                      disabled={isFormReadOnly}
                      className={cn(
                        'px-4 py-2 text-sm font-medium transition-colors min-w-[72px]',
                        index > 0 && 'border-l border-input',
                        isSelected
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-background text-foreground hover:bg-muted',
                        'disabled:opacity-50 disabled:cursor-not-allowed',
                      )}
                      data-track-category='Tickets'
                      data-track-name={`StageFormBoolean${label}`}
                      data-track-metadata={JSON.stringify({
                        fieldId: field.id,
                        fieldName: field.fieldName,
                        value: option,
                      })}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
            {field.fieldType === FormFieldType.DATE && (
              <input
                type='date'
                value={formData[field.id]?.[0] || ''}
                onChange={e => setFormData(prev => ({ ...prev, [field.id]: [e.target.value] }))}
                disabled={isFormReadOnly}
                className='w-full px-3 py-2 border border-input rounded-md disabled:bg-muted disabled:text-muted-foreground'
                data-track-category='Tickets'
                data-track-name='StageFormDateInput'
                data-track-metadata={JSON.stringify({
                  fieldId: field.id,
                  fieldName: field.fieldName,
                })}
              />
            )}
            {field.fieldType === FormFieldType.SINGLE_SELECT && (
              <div className={cn(isFormReadOnly && 'pointer-events-none opacity-50')}>
                <SingleSelect
                  placeholder={`Select ${field.fieldName.toLowerCase()}`}
                  items={[
                    {
                      items:
                        (field.fieldEnum as string[] | undefined)?.map((option: string) => ({
                          label: option,
                          value: option,
                        })) || [],
                    },
                  ]}
                  selected={formData[field.id]?.[0] || ''}
                  onSelect={selected => {
                    setFormData(prev => ({
                      ...prev,
                      [field.id]: selected ? [selected] : [],
                    }));
                  }}
                  alignment={SelectMenuAlignment.START}
                />
              </div>
            )}
            {field.fieldType === FormFieldType.MULTI_SELECT && (
              <MultiSelect
                className='w-full'
                placeholder={`Select ${field.fieldName.toLowerCase()}`}
                options={
                  (field.fieldEnum as string[] | undefined)?.map((option: string) => ({
                    label: option,
                    value: option,
                  })) || []
                }
                selectedValues={formData[field.id] ?? []}
                onChange={newValues => {
                  setFormData(prev => ({ ...prev, [field.id]: newValues }));
                }}
                disabled={isFormReadOnly}
              />
            )}
            {field.fieldType === FormFieldType.USER && (
              <input
                type='text'
                placeholder='User ID'
                value={formData[field.id]?.[0] || ''}
                onChange={e => setFormData(prev => ({ ...prev, [field.id]: [e.target.value] }))}
                disabled={isFormReadOnly}
                className='w-full px-3 py-2 border border-input rounded-md disabled:bg-muted disabled:text-muted-foreground'
                data-track-category='Tickets'
                data-track-name='StageFormUserInput'
                data-track-metadata={JSON.stringify({
                  fieldId: field.id,
                  fieldName: field.fieldName,
                })}
              />
            )}
            {field.fieldType === FormFieldType.DOC &&
              (() => {
                // Latest persisted FormEntityValue for this DOC field at the target stage.
                // Its `attachments` (joined via the relation on form_entity_values) carries
                // the persisted MessageAttachment row from a prior submission.
                const latestValue = valuesForRender
                  .filter(
                    (fev: FormEntityValues) =>
                      fev.fieldId === field.id && fev.contextId === targetStage.id,
                  )
                  .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
                const persistedAttachment = latestValue?.attachments?.[0];
                // If the user marked this DOC as removed in-session, hide the
                // persisted preview so the dropzone shows.
                const change = localDocChanges.get(field.id);
                const effectiveExisting =
                  change && 'removed' in change ? undefined : persistedAttachment;
                return (
                  <StageFormDocField
                    fieldId={field.id}
                    existingAttachment={effectiveExisting}
                    onLocalChange={file => {
                      setLocalDocChanges(prev => {
                        const next = new Map(prev);
                        if (file) {
                          next.set(field.id, { file });
                        } else if (persistedAttachment) {
                          // Removing a persisted attachment — mark for clear on submit.
                          next.set(field.id, { removed: true });
                        } else {
                          // Removing an in-session pick — just drop the change.
                          next.delete(field.id);
                        }
                        return next;
                      });
                    }}
                    disabled={isFormReadOnly}
                    readOnly={isReviewer}
                  />
                );
              })()}
          </div>
        ))}

        {/* Reviewer comment textarea — visible only when the approver is acting
            (showReviewButtons). Required on REJECT, optional on APPROVE. The
            value is sent to the mutator as a USER message in the ticket
            conversation and linked on the request via reviewerCommentMessageId. */}
        {showReviewButtons && (
          <div className='mt-4'>
            <label
              htmlFor='reviewer-comment'
              className='block text-sm font-medium text-foreground mb-1'
            >
              Comment <span className='text-xs text-muted-foreground'>(required on reject)</span>
            </label>
            <textarea
              id='reviewer-comment'
              value={reviewerComment}
              onChange={e => setReviewerComment(e.target.value)}
              placeholder='Explain your decision…'
              rows={3}
              className='w-full px-3 py-2 border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y'
              disabled={isSubmitting}
              data-track-category='Tickets'
              data-track-name='StageFormReviewerCommentInput'
            />
          </div>
        )}

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
            <Button
              onClick={() => {
                void handleSubmit(TicketStageRequestStatus.SUBMITTED);
              }}
              disabled={isSubmitting || isFieldsLoading || !isFormValid || isFormReadOnly}
              data-track-category='Tickets'
              data-track-name='SubmitStageFormForApproval'
            >
              {isSubmitting ? 'Submitting...' : 'Submit for Approval'}
            </Button>
          ) : (
            <Button
              onClick={() => {
                // If no approvers, just save form data without approval workflow
                void handleSubmit(TicketStageRequestStatus.APPROVED);
              }}
              disabled={isSubmitting || isFieldsLoading || !isFormValid}
            >
              {isSubmitting ? 'Saving...' : isFieldsLoading ? 'Loading...' : 'Save'}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
};
