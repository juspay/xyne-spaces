import { ReactElement } from 'react';
import { Clipboard } from 'lucide-react';
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
      className='bg-white border border-gray-200 rounded-lg p-4 hover:border-blue-300 hover:shadow-sm transition-all cursor-pointer'
      data-track-category='Forms'
      data-track-name='OpenForm'
      data-track-metadata={JSON.stringify({ formId: form.id, formName: form.formName })}
    >
      <div className='flex items-start gap-3'>
        <div className='flex-shrink-0 w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center'>
          <Clipboard size={20} className='text-blue-600' />
        </div>
        <div className='flex-1 min-w-0'>
          <h3 className='font-semibold text-gray-900 truncate'>{form.formName}</h3>
          <div className='mt-1 space-y-1'>
            <div className='flex items-center gap-2 text-sm'>
              <span className='text-gray-500'>Context:</span>
              <span className='text-gray-700 font-medium'>{form.contextType}</span>
            </div>
            <div className='flex items-center gap-2 text-sm'>
              <span className='text-gray-500'>Entity:</span>
              <span className='text-gray-700 font-medium'>{form.entityType}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

FormCard.displayName = 'FormCard';

export default FormCard;
