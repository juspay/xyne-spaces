import { ReactElement } from 'react';
import type { Form } from '@xyne/shared';

interface FormCardProps {
  form: Form;
  onClick: () => void;
}

const FormCard = ({ form, onClick }: FormCardProps): ReactElement => {
  return (
    <div
      role='button'
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onClick();
        }
      }}
      onClick={onClick}
      className='flex flex-col items-start justify-center gap-3 overflow-clip rounded-[20px] border border-border bg-background px-5 pb-4 pt-5 transition-colors hover:bg-muted/40 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
      data-track-category='Forms'
      data-track-name='OpenForm'
      data-track-metadata={JSON.stringify({ formId: form.id, formName: form.formName })}
    >
      <div className='flex w-full items-center'>
        <p className='truncate text-sm font-medium leading-none text-foreground'>{form.formName}</p>
      </div>
      <div className='flex w-full items-center gap-1'>
        <p className='truncate text-sm font-[450] leading-5 text-muted-foreground'>
          Entity: {form.entityType}
        </p>
        <div className='h-3 w-px shrink-0 rounded-[15px] bg-border' />
        <p className='shrink-0 text-center text-xs font-[450] leading-[22px] text-muted-foreground opacity-70'>
          Context: {form.contextType}
        </p>
      </div>
    </div>
  );
};

FormCard.displayName = 'FormCard';

export default FormCard;
