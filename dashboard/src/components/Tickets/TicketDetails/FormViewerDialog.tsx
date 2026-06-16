import React from 'react';
import { Dialog } from '../../ui/Dialog/Dialog';
import type { FormEntityValues } from '@xyne/shared';

export type FormEntityValuesWithField = FormEntityValues & {
  formField?: { fieldName: string; fieldType?: string } | null;
};

const renderFieldValue = (fv: FormEntityValuesWithField): string => {
  const raw = fv.actualFieldValue ?? fv.fieldValue;
  if (raw === null || raw === undefined) return '—';
  if (typeof raw === 'object') return JSON.stringify(raw);
  return String(raw);
};

interface FormViewerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  stageName: string;
  visitIndex: number;
  formValues: FormEntityValuesWithField[];
}

export const FormViewerDialog: React.FC<FormViewerDialogProps> = ({
  isOpen,
  onClose,
  stageName,
  visitIndex,
  formValues,
}) => (
  <Dialog
    open={isOpen}
    onOpenChange={open => {
      if (!open) onClose();
    }}
    title={`Form — ${stageName}${visitIndex > 1 ? ` (Visit #${visitIndex})` : ''}`}
  >
    <div className='px-6 pb-6 pt-2 min-w-[320px] max-w-md'>
      {formValues.length === 0 ? (
        <p className='text-sm text-muted-foreground'>No form values recorded for this visit.</p>
      ) : (
        <div className='space-y-4'>
          {formValues.map(fv => (
            <div key={fv.id}>
              <p className='text-xs font-medium text-muted-foreground mb-1'>
                {fv.formField?.fieldName ?? fv.fieldId}
              </p>
              <div className='rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground min-h-[36px]'>
                {renderFieldValue(fv)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  </Dialog>
);
