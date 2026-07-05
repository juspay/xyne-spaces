import React, { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Save } from 'lucide-react';
import type { ReenterMode, Ticket } from '@xyne/shared';
import type { Stage } from '../../../routes/KanbanBoardScreen/KanbanBoardScreen.types';
import Button from '../../ui/Button';
import Tooltip from '../../ui/Tooltip';
import { StageFormFields } from '../StageFormFields/StageFormFields';
import {
  useStageForm,
  type StageFormResolvedInputs,
  type StageVisitEta,
} from '../StageFormFields/useStageForm';
import { StageFormConflictDialog } from './StageFormConflictDialog';
import { useStageFormConflictFlow } from './useStageFormConflictFlow';

interface StageFormInlinePanelProps {
  ticket: Ticket;
  targetStage: Stage;
  sourceStageName: string;
  formId: string;
  hasApprovers: boolean;
  isNonLinearBoard: boolean;
  reenterMode?: ReenterMode | null;
  targetStageEtas?: readonly StageVisitEta[];
}

export const StageFormInlinePanel: React.FC<StageFormInlinePanelProps> = ({
  ticket,
  targetStage,
  sourceStageName,
  formId,
  hasApprovers,
  isNonLinearBoard,
  reenterMode,
  targetStageEtas,
}) => {
  const {
    fields,
    valuesForRender,
    isFieldsLoading,
    hydrated,
    formData,
    setFormData,
    localDocChanges,
    setLocalDocChanges,
    isSaving,
    isUploadingDocs,
    isDirty,
    missingRequiredFields,
    hasActiveRequestForDocPrefill,
    isApproved,
    isSubmitted,
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

  const [isMoving, setIsMoving] = useState(false);

  const performSave = async (overrides?: StageFormResolvedInputs): Promise<boolean> => {
    const effectiveFormData = await persistForm('save', overrides);
    if (!effectiveFormData) return false;
    toast.success('Form saved');
    return true;
  };

  const performMove = async (overrides?: StageFormResolvedInputs): Promise<boolean> => {
    setIsMoving(true);
    try {
      const effectiveFormData = await persistForm(hasApprovers ? 'submit' : 'move', overrides);
      if (!effectiveFormData) return false;

      if (hasApprovers) {
        toast.success('Form submitted for approval');
        return true;
      }

      await commitMove(effectiveFormData);
      toast.success('Stage updated');
      return true;
    } finally {
      setIsMoving(false);
    }
  };

  const conflict = useStageFormConflictFlow({
    getContentConflicts,
    applyConflictResolution,
    performSave,
    performMove,
  });

  const handleSave = async (): Promise<void> => {
    if (!hydrated || !isDirty || isSaving || isUploadingDocs || isMoving) return;
    await conflict.run('save');
  };

  const handleMove = async (): Promise<void> => {
    if (isSaving || isUploadingDocs) return;
    if (missingRequiredFields.length > 0) {
      toast.error(
        `Please fill in all required fields: ${missingRequiredFields
          .map(field => field.fieldName)
          .join(', ')}`,
      );
      return;
    }
    await conflict.run('move');
  };

  const hasPendingDocChanges = localDocChanges.size > 0;
  const canMove =
    missingRequiredFields.length === 0 && !isFieldsLoading && !isSubmitted && !isApproved;
  const canSave = hydrated && isDirty && !isFieldsLoading && !isSaving && !isUploadingDocs;
  const isBusy = isSaving || isUploadingDocs || conflict.isConfirming;

  return (
    <>
      <div className='mt-6 rounded-lg border border-border bg-background'>
        <div className='sticky -top-[20px] z-20 rounded-t-lg border-b border-border bg-background px-4 py-3'>
          <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
            <div className='min-w-0'>
              <p className='min-w-0 text-base font-semibold text-foreground'>
                <span>{sourceStageName}</span>
                <span className='mx-2 text-muted-foreground'>→</span>
                <span>{targetStage.name}</span>
                <span className='ml-1'>form</span>
              </p>
              {(hasPendingDocChanges || isSaving || isUploadingDocs || isDirty) && (
                <div className='mt-1 flex items-center gap-1.5 text-xs text-muted-foreground'>
                  {isUploadingDocs ? (
                    <>
                      <Loader2 size={14} className='animate-spin' />
                      <span>Uploading...</span>
                    </>
                  ) : isSaving || conflict.isConfirming ? (
                    <>
                      <Loader2 size={14} className='animate-spin' />
                      <span>Saving...</span>
                    </>
                  ) : isDirty ? (
                    <span>Unsaved changes</span>
                  ) : null}
                </div>
              )}
            </div>

            <div className='flex shrink-0 items-center justify-end gap-2'>
              <Tooltip content='Temporarily save your changes without moving to the next stage'>
                <Button
                  variant='outline'
                  onClick={() => void handleSave()}
                  disabled={!canSave || isMoving || conflict.isConfirming}
                  data-track-category='Tickets'
                  data-track-name='SaveInlineStageForm'
                >
                  {isBusy && !isMoving ? (
                    <Loader2 size={16} className='animate-spin' />
                  ) : (
                    <Save size={16} />
                  )}
                  Save
                </Button>
              </Tooltip>
              <Tooltip
                content={
                  hasApprovers
                    ? 'Submit the form for approval'
                    : 'Save your changes and move to the next stage'
                }
              >
                <Button
                  onClick={() => void handleMove()}
                  disabled={
                    !canMove || isMoving || isSaving || isUploadingDocs || conflict.isConfirming
                  }
                  data-track-category='Tickets'
                  data-track-name={
                    hasApprovers ? 'SubmitInlineStageFormForApproval' : 'MoveInlineStageForm'
                  }
                >
                  {isUploadingDocs ? (
                    <>
                      <Loader2 size={16} className='animate-spin' />
                      Uploading...
                    </>
                  ) : isMoving ? (
                    'Submitting...'
                  ) : hasApprovers ? (
                    'Submit for approval'
                  ) : (
                    'Submit'
                  )}
                </Button>
              </Tooltip>
            </div>
          </div>
        </div>

        <div className='p-4'>
          {isApproved && (
            <div className='mb-4 rounded-md bg-muted px-3 py-2 text-sm text-foreground'>
              Approved
            </div>
          )}
          {isSubmitted && (
            <div className='mb-4 rounded-md bg-muted px-3 py-2 text-sm text-foreground'>
              Awaiting review
            </div>
          )}

          {isFieldsLoading ? (
            <p className='text-sm text-muted-foreground'>Loading form...</p>
          ) : (
            <StageFormFields
              fields={fields}
              formData={formData}
              setFormData={setFormData}
              localDocChanges={localDocChanges}
              setLocalDocChanges={setLocalDocChanges}
              valuesForRender={valuesForRender}
              targetStageId={targetStage.id}
              disabled={isApproved || isSubmitted}
              showPersistedDocValues={hasActiveRequestForDocPrefill}
              idPrefix='inline-stage-field'
              trackNamePrefix='InlineStageForm'
            />
          )}
        </div>
      </div>

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
