import type { ReactElement } from 'react';
import { Plus } from 'lucide-react';
import { StackedCardsIllustration } from './StackedCardsIllustration';

export const EmptyState = ({ onCreate }: { onCreate: () => void }): ReactElement => (
  <div className='flex flex-col items-center justify-center h-full text-center px-6'>
    <StackedCardsIllustration />
    <h3 className='text-sm font-medium text-xyne-gray-500 mb-3 max-w-[260px]'>
      No dashboard created yet!
    </h3>
    <button
      type='button'
      onClick={onCreate}
      className='inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-xyne-primary-500 text-[13px] leading-[18px] font-medium text-white transition-colors hover:bg-xyne-primary-600'
      data-track-category='DYNAMIC_DASHBOARD'
      data-track-name='Open_Create_Dashboard_Modal'
    >
      <Plus size={16} />
      Create Dashboard
    </button>
  </div>
);
