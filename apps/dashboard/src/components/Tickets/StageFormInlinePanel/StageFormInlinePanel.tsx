import React, { useState } from 'react';
import { toast } from 'sonner';
import { Save } from 'lucide-react';
import {
  CheckTickCircle as CircleCheck,
  Spinner as Loader2,
  PencilEdit as Pencil,
} from '@xyne/icons';
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
  ticket: Pick<Ticket, 'id'>;
  targetStage: Stage;
  sourceStageName: string;
  formId: string;
  hasApprovers: boolean;
  isNonLinearBoard: boolean;
  reenterMode?: ReenterMode | null;
  targetStageEtas?: readonly StageVisitEta[];
  headerTitle?: string;
  headerSubtitle?: string;
  /** Replaces the stage move on submit (flow steps complete the ticket instead) */
  onCommit?: (formData: Record<string, string[]>) => Promise<void> | void;
  commitSuccessMessage?: string;
  /** Keeps submitted forms editable without replaying their stage transition. */
  saveOnly?: boolean;
  saveSuccessMessage?: string;
  /** Shows submitted values read-only until the user explicitly clicks Edit. */
  editableOnDemand?: boolean;
  /** Uses the compact success treatment for a submitted FLOW form. */
  submittedHeader?: boolean;
  /** Flow side panels keep actions below fields; ticket details default to header actions. */
  actionsPlacement?: 'header' | 'footer';
  /** Removes page-level spacing and gives fields their own scroll region. */
  embedded?: boolean;
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
  headerTitle,
  headerSubtitle,
  onCommit,
  commitSuccessMessage,
  saveOnly = false,
  saveSuccessMessage,
  editableOnDemand = false,
  submittedHeader = false,
  actionsPlacement = 'header',
  embedded = false,
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
  const [isEditing, setIsEditing] = useState(!editableOnDemand);

  const performSave = async (overrides?: StageFormResolvedInputs): Promise<boolean> => {
    const effectiveFormData = await persistForm('save', overrides);
    if (!effectiveFormData) return false;
    toast.success(saveSuccessMessage ?? 'Form saved');
    if (editableOnDemand) setIsEditing(false);
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

      if (onCommit) {
        await onCommit(effectiveFormData);
      } else {
        await commitMove(effectiveFormData);
      }
      toast.success(commitSuccessMessage ?? 'Stage updated');
      return true;
    } catch (error) {
      // onCommit / commitMove can reject (e.g. flow step completion fails on
      // the server). Surface it instead of leaking an unhandled rejection.
      toast.error(error instanceof Error ? error.message : 'Failed to update stage');
      return false;
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
  const actions = (
    <div className={`flex shrink-0 items-center justify-end gap-2 ${embedded ? 'w-full' : ''}`}>
      <Tooltip
        content={
          saveOnly
            ? 'Save changes to the submitted form'
            : 'Temporarily save your changes without moving to the next stage'
        }
      >
        <Button
          variant='outline'
          className={embedded ? 'flex-1' : undefined}
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
      {!saveOnly && (
        <Tooltip
          content={
            hasApprovers
              ? 'Submit the form for approval'
              : 'Save your changes and move to the next stage'
          }
        >
          <Button
            className={embedded ? 'flex-1' : undefined}
            onClick={() => void handleMove()}
            disabled={!canMove || isMoving || isSaving || isUploadingDocs || conflict.isConfirming}
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
      )}
    </div>
  );
  const editAction = (
    <Tooltip content='Edit submitted form'>
      <button
        type='button'
        onClick={() => setIsEditing(true)}
        className='inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
        aria-label='Edit submitted form'
        data-track-category='Tickets'
        data-track-name='EditSubmittedInlineStageForm'
      >
        <Pencil size={15} />
      </button>
    </Tooltip>
  );
  const headerActions =
    editableOnDemand && !isEditing ? editAction : actionsPlacement === 'header' ? actions : null;

  return (
    <>
      <div
        className={
          embedded
            ? 'flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-background'
            : 'mt-6 rounded-lg border border-border bg-background'
        }
      >
        <div
          className={
            submittedHeader && !isEditing
              ? 'z-20 shrink-0 rounded-t-lg border-b border-emerald-500/15 bg-emerald-500/[0.05] px-3 py-2.5'
              : embedded
                ? 'z-20 shrink-0 rounded-t-lg border-b border-border bg-background px-4 py-3'
                : 'sticky -top-[20px] z-20 rounded-t-lg border-b border-border bg-background px-4 py-3'
          }
        >
          <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
            <div className='flex min-w-0 items-center gap-2.5'>
              {submittedHeader && !isEditing && (
                <span className='flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600'>
                  <CircleCheck size={14} />
                </span>
              )}
              <div className='min-w-0'>
                <p
                  className={
                    submittedHeader && !isEditing
                      ? 'min-w-0 text-[11px] font-semibold uppercase tracking-[0.5px] text-emerald-700 dark:text-emerald-400'
                      : 'min-w-0 text-base font-semibold text-foreground'
                  }
                >
                  {submittedHeader && !isEditing
                    ? 'Form submitted'
                    : (headerTitle ?? (
                        <>
                          <span>{sourceStageName}</span>
                          <span className='mx-2 text-muted-foreground'>→</span>
                          <span>{targetStage.name}</span>
                          <span className='ml-1'>form</span>
                        </>
                      ))}
                </p>
                {(submittedHeader && !isEditing ? headerTitle : headerSubtitle) && (
                  <p className='mt-0.5 truncate text-xs text-muted-foreground'>
                    {submittedHeader && !isEditing ? headerTitle : headerSubtitle}
                  </p>
                )}
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
            </div>

            {headerActions}
          </div>
        </div>

        <div
          className={
            embedded
              ? `min-h-0 flex-1 overflow-y-auto ${submittedHeader && !isEditing ? 'px-3 py-3' : 'p-4'}`
              : 'p-4'
          }
        >
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
              disabled={isApproved || isSubmitted || !isEditing}
              readOnlyDocs={!isEditing}
              readOnlySummary={!isEditing}
              showPersistedDocValues={editableOnDemand || hasActiveRequestForDocPrefill}
              idPrefix='inline-stage-field'
              trackNamePrefix='InlineStageForm'
              booleanButtonsFullWidth={embedded}
            />
          )}
        </div>
        {isEditing && actionsPlacement === 'footer' && (
          <div
            className={
              embedded
                ? 'z-20 flex shrink-0 justify-end rounded-b-lg border-t border-border bg-background px-4 py-3'
                : 'sticky -bottom-[20px] z-20 flex justify-end rounded-b-lg border-t border-border bg-background px-4 py-3'
            }
          >
            {actions}
          </div>
        )}
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
