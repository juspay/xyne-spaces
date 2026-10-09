import { ReactElement, useMemo } from 'react';
import { X } from 'lucide-react';
import { Button } from '../../ui/Button/Button';
import { FormBuilder, type FormBuilderData } from '../../Form/FormBuilder';
import { queries } from '../../../zero/queries';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useFormEditLock } from '../../../hooks/useFormEditLock';
import {
  fromLegacyFormFieldArray,
  toLegacyFormFieldArray,
} from '../../../utils/form/formBuilderMapper';
import { type CreateFormSlideOutProps } from './CreateFormSlideOut.types';

/**
 * Board/flow form panel: slide-out or embedded chrome around the shared FormBuilder. The
 * host keeps performing the write — the builder hands back the same `FormField[]` shape the
 * board screens have always received.
 */
const CreateFormSlideOutPanel = ({
  onClose,
  onSave,
  onUpdate,
  formId,
  projectId,
  initialData,
  title = 'Create Form',
  embedded = false,
  submitLabel = 'Save',
}: CreateFormSlideOutProps): ReactElement => {
  const [existingForm] = useCachedQuery(queries.getFormById({ formId: formId ?? '' }), {
    enabled: !!formId,
  });
  const { locked, lockedReason } = useFormEditLock(existingForm?.createdBy);

  const builderData = useMemo<FormBuilderData | undefined>(
    () =>
      initialData
        ? {
            formName: initialData.formName,
            formDescription: initialData.formDescription,
            fields: fromLegacyFormFieldArray(initialData.fields),
          }
        : undefined,
    [initialData],
  );

  const handleSubmit = async (data: FormBuilderData): Promise<void> => {
    const formData = {
      formName: data.formName,
      formDescription: data.formDescription,
      fields: toLegacyFormFieldArray(data.fields),
    };
    if (formId && onUpdate) {
      await onUpdate({ formId, ...formData });
    } else {
      await onSave(formData);
    }
  };

  return (
    <div
      className={
        embedded
          ? 'flex w-full min-h-0 flex-col'
          : 'fixed right-[130px] top-[280px] bottom-[120px] z-50'
      }
    >
      <div
        className={
          embedded
            ? 'flex w-full min-h-0 flex-col overflow-hidden rounded-[12px] border border-border bg-background'
            : 'w-[500px] h-full bg-background rounded-[12px] shadow-[0px_0px_4px_0px_rgba(0,0,0,0.14),0px_8px_24px_0px_rgba(43,45,47,0.08)] flex flex-col overflow-hidden relative'
        }
      >
        <div className='flex items-center justify-between px-[16px] pt-[14px]'>
          <h2 className='text-[14px] font-medium text-foreground'>{title}</h2>
          <Button
            type='button'
            onClick={onClose}
            variant='ghost'
            size='iconSm'
            className='text-muted-foreground hover:text-foreground'
            data-track-category='board_config'
            data-track-name='close_create_form'
          >
            <X size={16} />
          </Button>
        </div>

        <FormBuilder
          mode={formId ? 'edit' : 'create'}
          formId={formId}
          initialData={builderData}
          projectId={projectId}
          onSubmit={handleSubmit}
          submitLabel={submitLabel}
          locked={locked}
          lockedReason={lockedReason}
          trackingCategory='board_config'
          className={embedded ? undefined : 'flex-1'}
          contentClassName={embedded ? 'p-[12px]' : 'flex-1 overflow-y-auto p-[16px]'}
        />
      </div>
    </div>
  );
};

export const CreateFormSlideOut = (props: CreateFormSlideOutProps): ReactElement | null => {
  // Unmounting while closed gives every open a freshly seeded builder.
  if (!props.isOpen) return null;
  return <CreateFormSlideOutPanel {...props} />;
};
