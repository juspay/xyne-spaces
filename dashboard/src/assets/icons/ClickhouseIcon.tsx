import type { ReactElement } from 'react';

export const ClickhouseIcon = (): ReactElement => {
  return (
    <span className='flex items-end gap-[2px] h-4' aria-hidden>
      <span className='block w-[2.5px] h-4 bg-xyne-yellow-400 rounded-[0.5px]' />
      <span className='block w-[2.5px] h-4 bg-xyne-yellow-400 rounded-[0.5px]' />
      <span className='block w-[2.5px] h-4 bg-xyne-yellow-400 rounded-[0.5px]' />
      <span className='block w-[2.5px] h-2 bg-xyne-yellow-400 rounded-[0.5px]' />
    </span>
  );
};
