import React, { useCallback, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import Dialog from '../../ui/Dialog';
import { Button } from '../../ui/Button';
import type { PendingHumanInterventionStep, ResponseSchemaField } from '@xyne/shared';
import DynamicFormField from './DynamicFormField';

interface ApprovalDialogProps {
  step: PendingHumanInterventionStep;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (response: Record<string, unknown>) => Promise<void>;
  isSubmitting?: boolean;
}

const ApprovalDialog: React.FC<ApprovalDialogProps> = ({
  step,
  open,
  onOpenChange,
  onSubmit,
  isSubmitting = false,
}) => {
  const defaultValues = useMemo(() => {
    const values: Record<string, unknown> = {};

    if (!step.responseSchema?.fields) {
      return values;
    }

    for (const field of step.responseSchema.fields) {
      if (field.default !== undefined) {
        values[field.name] = field.default;
      } else {
        // Set appropriate default based on type
        switch (field.type) {
          case 'boolean':
            values[field.name] = false;
            break;
          case 'number':
            values[field.name] = 0;
            break;
          default:
            values[field.name] = '';
        }
      }
    }

    return values;
  }, [step.responseSchema]);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm({
    defaultValues,
  });

  const handleFormSubmit = useCallback(
    async (data: Record<string, unknown>) => {
      await onSubmit(data);
    },
    [onSubmit],
  );

  const fields = step.responseSchema?.fields ?? [];

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={step.title || 'Approval Required'}
      description='Please review and provide the required information'
    >
      <div className='p-6'>
        {/* Header */}
        <div className='mb-6'>
          <h2 className='text-lg font-semibold text-foreground'>
            {step.title || 'Approval Required'}
          </h2>
          {step.responseSchema?.description && (
            <p className='mt-2 text-sm text-muted-foreground'>{step.responseSchema.description}</p>
          )}
        </div>

        {/* Form */}
        <form onSubmit={e => void handleSubmit(handleFormSubmit)(e)} className='space-y-5'>
          {fields.length > 0 ? (
            fields.map((field: ResponseSchemaField) => {
              const errorMessage = errors[field.name]?.message;
              const errorProp = typeof errorMessage === 'string' ? { error: errorMessage } : {};
              return (
                <div key={field.name}>
                  <DynamicFormField
                    field={field}
                    register={register}
                    setValue={setValue}
                    {...errorProp}
                  />
                </div>
              );
            })
          ) : (
            <p className='text-sm text-muted-foreground'>
              No additional information required. Click submit to approve.
            </p>
          )}

          {/* Actions */}
          <div className='flex justify-end gap-3 pt-5 mt-6 border-t border-border'>
            <Button
              type='button'
              variant='outline'
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
              data-track-category='Tickets'
              data-track-name='CancelApprovalDialog'
            >
              {step.responseSchema?.cancelLabel ?? 'Cancel'}
            </Button>
            <Button type='submit' disabled={isSubmitting} loading={isSubmitting}>
              {step.responseSchema?.submitLabel ?? 'Submit Response'}
            </Button>
          </div>
        </form>
      </div>
    </Dialog>
  );
};

export default ApprovalDialog;
