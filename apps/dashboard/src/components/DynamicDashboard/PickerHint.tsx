import { ReactElement } from 'react';
import { LayoutDashboard } from 'lucide-react';

export const PickerHint = (): ReactElement => (
  <div className='flex flex-col items-center justify-center h-full text-center px-6'>
    <LayoutDashboard className='w-8 h-8 text-xyne-gray-300 mb-3' />
    <p className='text-sm text-xyne-gray-500'>
      Select a dashboard from the left rail, or create a new one.
    </p>
  </div>
);
