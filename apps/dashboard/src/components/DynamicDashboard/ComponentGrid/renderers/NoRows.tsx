import { ReactElement } from 'react';

export const NoRows = (): ReactElement => (
  <div className='flex items-center justify-center h-full text-xs text-muted-foreground'>
    No rows to plot.
  </div>
);
