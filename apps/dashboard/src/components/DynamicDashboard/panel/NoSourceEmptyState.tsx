import type { ReactElement } from 'react';
import { Zap } from 'lucide-react';
import { StackedCardsIllustration } from './StackedCardsIllustration';

export const NoSourceEmptyState = ({ onConnect }: { onConnect: () => void }): ReactElement => (
  <div className='flex flex-col items-center justify-center h-full text-center px-6'>
    <StackedCardsIllustration />
    <p className='text-sm font-medium text-xyne-gray-500 mb-4 max-w-[320px]'>
      No dashboard created yet! Connect your sources and start creating dashboards
    </p>
    <button
      type='button'
      onClick={onConnect}
      className='inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-xyne-primary-500 text-[13px] leading-[18px] font-medium text-white transition-colors hover:bg-xyne-primary-600'
      data-track-category='DYNAMIC_DASHBOARD'
      data-track-name='Open_Data_Sources_Admin'
    >
      <Zap size={14} />
      Connect Sources
    </button>
  </div>
);
