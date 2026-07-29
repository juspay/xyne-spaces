import type { ReactElement } from 'react';

export const StackedCardsIllustration = (): ReactElement => (
  <div className='relative w-[180px] h-[72px] mb-5 opacity-80'>
    <div className='absolute left-1/2 -translate-x-1/2 top-3 w-[120px] h-[58px] rounded-lg border border-xyne-gray-200 bg-xyne-gray-50 rotate-[-6deg]' />
    <div className='absolute left-1/2 -translate-x-1/2 top-1.5 w-[120px] h-[58px] rounded-lg border border-xyne-gray-200 bg-xyne-gray-50 rotate-[6deg]' />
    <div className='absolute left-1/2 -translate-x-1/2 top-0 w-[124px] h-[60px] rounded-lg border border-xyne-gray-200 bg-white shadow-[0px_2px_4px_0px_rgba(0,0,0,0.04)] flex flex-col gap-1.5 p-2.5'>
      <div className='h-1.5 w-10 rounded-full bg-xyne-gray-200' />
      <div className='flex-1 flex items-end gap-1'>
        <div className='w-3 h-4 rounded-sm bg-xyne-gray-200' />
        <div className='w-3 h-6 rounded-sm bg-xyne-gray-200' />
        <div className='w-3 h-3 rounded-sm bg-xyne-gray-200' />
        <div className='w-3 h-5 rounded-sm bg-xyne-gray-200' />
      </div>
    </div>
  </div>
);
