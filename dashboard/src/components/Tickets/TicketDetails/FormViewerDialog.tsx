import React, { useMemo, type ReactNode } from 'react';
import { Dialog } from '../../ui/Dialog/Dialog';
import { FileText } from 'lucide-react';
import { FormFieldType, type FormEntityValues, type MessageAttachment } from '@xyne/shared';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';

export type FormEntityValuesWithField = FormEntityValues & {
  formField?: { fieldName: string; fieldType?: string } | null;
  attachments?: readonly MessageAttachment[] | null;
};

const stringValuesFromJson = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  }
  if (typeof value === 'string' && value.length > 0) {
    return [value];
  }
  return [];
};

const renderFieldValue = (
  fv: FormEntityValuesWithField,
  attachmentById: ReadonlyMap<string, MessageAttachment>,
): ReactNode => {
  const raw = fv.actualFieldValue ?? fv.fieldValue;
  if (raw === null || raw === undefined) return '—';
  if (fv.formField?.fieldType === FormFieldType.DOC) {
    const attachmentId = stringValuesFromJson(raw)[0];
    const attachment =
      fv.attachments?.[0] ?? (attachmentId ? attachmentById.get(attachmentId) : undefined);

    if (attachment) {
      return (
        <div className='flex min-w-0 items-center gap-2'>
          <FileText size={16} className='shrink-0 text-muted-foreground' />
          <div className='min-w-0'>
            <p className='truncate font-medium'>{attachment.originalFilename}</p>
            <p className='truncate text-xs text-muted-foreground'>
              {attachment.mimetype || 'Document'}
            </p>
          </div>
        </div>
      );
    }

    return attachmentId ? 'Uploaded document' : '—';
  }
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
}) => {
  const docAttachmentIds = useMemo(() => {
    const ids = new Set<string>();
    formValues.forEach(fv => {
      if (fv.formField?.fieldType !== FormFieldType.DOC) return;
      stringValuesFromJson(fv.actualFieldValue ?? fv.fieldValue).forEach(id => ids.add(id));
    });
    return Array.from(ids);
  }, [formValues]);

  const [attachmentsByIdResult] = useCachedQuery(
    queries.attachmentsByIds({ attachmentIds: docAttachmentIds }),
    { enabled: docAttachmentIds.length > 0 },
  );

  const attachmentById = useMemo(() => {
    const attachments = Array.isArray(attachmentsByIdResult) ? attachmentsByIdResult : [];
    return new Map(attachments.map(attachment => [attachment.id, attachment]));
  }, [attachmentsByIdResult]);

  return (
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
                  {renderFieldValue(fv, attachmentById)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
};
