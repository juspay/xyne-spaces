import type { Dispatch, ReactElement, SetStateAction } from 'react';
import { FileText, Settings2, UserCheck, X } from 'lucide-react';
import { FormFieldType, type FlowPlanNode, type FlowStepGate } from '@xyne/shared';
import Textarea from '../../ui/Textarea';
import { Button } from '../../ui/Button';
import { TransitionFormPicker } from '../TransitionFormPicker/TransitionFormPicker';
import { CreateFormSlideOut } from '../CreateFormSlideOut/CreateFormSlideOut';
import type { FormField } from '../CreateFormSlideOut/CreateFormSlideOut.types';
import { getFieldTypeLabel } from '../../../utils/board/formFieldApiMapper';
import { StepAssigneePicker } from './FlowPlanNodes';

export interface FormBuilderData {
  formName: string;
  formDescription: string;
  fields: FormField[];
}

export type ConfirmationGate = Extract<FlowStepGate, { type: 'confirmation' }>;
export type FormGate = Extract<FlowStepGate, { type: 'form' }>;

interface AttachedFieldRow {
  id: string;
  fieldName: string | null;
  fieldType: FormFieldType | null;
  fieldEnum: unknown;
  isOptional: boolean | null;
  globalField:
    | {
        fieldName?: string | null;
        fieldType?: FormFieldType | null;
        fieldEnum?: unknown;
      }
    | null
    | undefined;
}

interface FlowStepConfigPanelProps {
  configNode: FlowPlanNode;
  onClose: () => void;
  draftAssignedTo: string | null;
  setDraftAssignedTo: Dispatch<SetStateAction<string | null>>;
  draftGate: FlowStepGate;
  setDraftGateType: Dispatch<SetStateAction<FlowStepGate['type']>>;
  draftConfirmationGate: ConfirmationGate;
  setDraftConfirmationGate: Dispatch<SetStateAction<ConfirmationGate>>;
  draftFormGate: FormGate;
  setDraftFormGate: Dispatch<SetStateAction<FormGate>>;
  formBuilderMode: 'create' | 'edit' | null;
  setFormBuilderMode: Dispatch<SetStateAction<'create' | 'edit' | null>>;
  closeFormBuilder: () => void;
  handleCreateForm: (formData: FormBuilderData) => Promise<void>;
  handleOpenAttachedForm: () => Promise<void>;
  projectId?: string;
  editingFormData: FormBuilderData | null;
  handleUpdateAttachedForm: (formData: FormBuilderData & { formId: string }) => Promise<void>;
  formNameById: Map<string, string>;
  attachedFieldRows: AttachedFieldRow[] | undefined;
  formOptions: Array<{ id: string; formName: string }>;
  canSavePanel: boolean;
  handleSavePanel: () => void;
}

export function FlowStepConfigPanel({
  configNode,
  onClose,
  draftAssignedTo,
  setDraftAssignedTo,
  draftGate,
  setDraftGateType,
  draftConfirmationGate,
  setDraftConfirmationGate,
  draftFormGate,
  setDraftFormGate,
  formBuilderMode,
  setFormBuilderMode,
  closeFormBuilder,
  handleCreateForm,
  handleOpenAttachedForm,
  projectId,
  editingFormData,
  handleUpdateAttachedForm,
  formNameById,
  attachedFieldRows,
  formOptions,
  canSavePanel,
  handleSavePanel,
}: FlowStepConfigPanelProps): ReactElement {
  return (
    <aside className='w-[360px] flex-shrink-0 h-full border-l border-border bg-muted/40 flex flex-col overflow-y-auto'>
      <div className='flex items-center justify-between px-4 py-3 border-b border-border bg-muted/60'>
        <span className='text-[11px] font-semibold text-foreground uppercase tracking-wide truncate'>
          {configNode.title || 'Step'}
        </span>
        <button
          type='button'
          onClick={onClose}
          data-track-category='flow_plan_editor'
          data-track-name='close_gate_config'
          className='p-1.5 rounded-md hover:bg-muted text-muted-foreground transition-colors'
        >
          <X size={13} />
        </button>
      </div>
      <div className='flex flex-col gap-4 px-4 py-4'>
        <div>
          <p className='text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.5px] mb-2'>
            Default assignee
          </p>
          <StepAssigneePicker
            value={draftAssignedTo}
            onChange={userId => setDraftAssignedTo(userId)}
          />
          <p className='text-[10px] text-muted-foreground mt-1.5 leading-[14px]'>
            Every run assigns this step&apos;s ticket to this user.
          </p>
        </div>

        <div className='border-t border-border pt-4'>
          <p className='text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.5px] mb-2'>
            This step waits for
          </p>
          <div className='grid grid-cols-2 gap-1.5'>
            <button
              type='button'
              onClick={() => setDraftGateType('confirmation')}
              data-track-category='flow_plan_editor'
              data-track-name='gate_type_confirmation'
              className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg border text-[11px] font-medium transition-colors ${
                draftGate.type === 'confirmation'
                  ? 'bg-[#6276be] border-[#6276be] text-white'
                  : 'bg-background border-border text-muted-foreground hover:bg-muted'
              }`}
            >
              <UserCheck size={12} />
              Confirmation
            </button>
            <button
              type='button'
              onClick={() => setDraftGateType('form')}
              data-track-category='flow_plan_editor'
              data-track-name='gate_type_form'
              className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg border text-[11px] font-medium transition-colors ${
                draftGate.type === 'form'
                  ? 'bg-[#6276be] border-[#6276be] text-white'
                  : 'bg-background border-border text-muted-foreground hover:bg-muted'
              }`}
            >
              <FileText size={12} />
              Form
            </button>
          </div>
        </div>

        <div className={draftGate.type === 'confirmation' ? '' : 'hidden'}>
          <p className='text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.5px] mb-2'>
            What needs to be confirmed?
          </p>
          <Textarea
            value={draftConfirmationGate.prompt ?? ''}
            onChange={e =>
              setDraftConfirmationGate({ type: 'confirmation', prompt: e.target.value })
            }
            placeholder='e.g. KYC documents verified against the registry'
            rows={3}
            data-track-category='flow_plan_editor'
            data-track-name='input_confirmation_prompt'
            className='min-h-[72px] text-[12px]'
          />
        </div>
        <div className={draftGate.type === 'form' ? '' : 'hidden'}>
          <p className='text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.5px] mb-2'>
            Form to fill
          </p>
          {formBuilderMode === 'create' ? (
            <CreateFormSlideOut
              embedded
              isOpen={true}
              onClose={closeFormBuilder}
              onSave={handleCreateForm}
              submitLabel='Create & attach'
              title='Create Step Form'
              {...(projectId && { projectId })}
            />
          ) : formBuilderMode === 'edit' && draftFormGate.formId && editingFormData ? (
            <CreateFormSlideOut
              embedded
              isOpen={true}
              onClose={closeFormBuilder}
              onSave={() => {}}
              onUpdate={handleUpdateAttachedForm}
              formId={draftFormGate.formId}
              initialData={editingFormData}
              submitLabel='Update form'
              title='Edit Step Form'
              {...(projectId && { projectId })}
            />
          ) : draftFormGate.formId ? (
            <div className='flex flex-col gap-2.5 rounded-lg border border-border bg-background p-3'>
              <div className='flex items-start justify-between gap-2'>
                <div className='min-w-0'>
                  <p className='truncate text-[12px] font-semibold text-foreground'>
                    {formNameById.get(draftFormGate.formId) ?? 'Form'}
                  </p>
                  <p className='text-[10px] text-muted-foreground'>
                    {attachedFieldRows?.length ?? 0} field
                    {(attachedFieldRows?.length ?? 0) === 1 ? '' : 's'}
                  </p>
                </div>
                <div className='flex items-center gap-1'>
                  <button
                    type='button'
                    title='Edit form'
                    onClick={() => void handleOpenAttachedForm()}
                    data-track-category='flow_plan_editor'
                    data-track-name='edit_gate_form'
                    className='p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors'
                  >
                    <Settings2 size={12} />
                  </button>
                  <button
                    type='button'
                    title='Detach form'
                    onClick={() => setDraftFormGate({ type: 'form', formId: '' })}
                    data-track-category='flow_plan_editor'
                    data-track-name='remove_gate_form'
                    className='p-1 rounded hover:bg-red-50 text-muted-foreground hover:text-red-500 transition-colors'
                  >
                    <X size={11} />
                  </button>
                </div>
              </div>
              {attachedFieldRows === undefined ? (
                <p className='text-[11px] text-muted-foreground'>Loading fields…</p>
              ) : (
                <div className='flex flex-col divide-y divide-border'>
                  {attachedFieldRows.map(row => {
                    const fieldName = row.globalField?.fieldName ?? row.fieldName;
                    const fieldType = row.globalField?.fieldType ?? row.fieldType;
                    const fieldEnum = row.globalField?.fieldEnum ?? row.fieldEnum;
                    if (!fieldName || !fieldType) return null;
                    return (
                      <div key={row.id} className='py-2 first:pt-0 last:pb-0'>
                        <div className='flex items-start justify-between gap-2'>
                          <span className='text-[11px] font-medium text-foreground'>
                            {fieldName}
                            {!row.isOptional && <span className='text-red-500'> *</span>}
                          </span>
                          <span className='shrink-0 text-[10px] text-muted-foreground'>
                            {getFieldTypeLabel(fieldType)}
                          </span>
                        </div>
                        {Array.isArray(fieldEnum) && fieldEnum.length > 0 && (
                          <p className='mt-0.5 line-clamp-2 text-[10px] text-muted-foreground'>
                            {(fieldEnum as string[]).join(' · ')}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <TransitionFormPicker
              allForms={formOptions}
              onCreateForm={() => setFormBuilderMode('create')}
              onSelectForm={formId => setDraftFormGate({ type: 'form', formId })}
              variant='dashed-button'
              triggerLabel='Attach form'
            />
          )}
          <p className='text-[11px] text-muted-foreground mt-2 leading-[16px]'>
            At runtime the assignee fills this form on the step; submitting it completes the step.
          </p>
        </div>
      </div>
      <div className='sticky bottom-0 mt-auto flex gap-2 border-t border-border bg-background px-4 py-3'>
        <Button
          variant='secondary'
          size='sm'
          className='flex-1'
          onClick={onClose}
          data-track-category='flow_plan_editor'
          data-track-name='cancel_gate_config'
        >
          Cancel
        </Button>
        <Button
          size='sm'
          className='flex-1 bg-[#6276BE] hover:bg-[#5060A0] text-white'
          disabled={!canSavePanel}
          onClick={handleSavePanel}
          data-track-category='flow_plan_editor'
          data-track-name='save_gate_config'
        >
          Save
        </Button>
      </div>
    </aside>
  );
}
