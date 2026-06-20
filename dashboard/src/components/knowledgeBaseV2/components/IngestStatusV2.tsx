import React from 'react';
import { cn } from '../../../utils/classNames';
import { Loader2, AlertCircle } from 'lucide-react';

interface IngestStatusV2Props {
  status: string | null | undefined;
}

export const IngestStatusV2: React.FC<IngestStatusV2Props> = ({ status }) => {
  if (!status || status === 'COMPLETED' || status === 'NONE') {
    return null;
  }

  const normalized = status.toUpperCase();

  if (normalized === 'PENDING') {
    return (
      <span className={cn('inline-flex h-4 w-4 items-center justify-center')} title='Pending'>
        <Loader2 className='h-3 w-3 animate-spin text-gray-400' strokeWidth={1.75} />
      </span>
    );
  }

  if (normalized === 'PROCESSING') {
    return (
      <span className={cn('inline-flex h-4 w-4 items-center justify-center')} title='Processing'>
        <Loader2 className='h-3 w-3 animate-spin text-blue-500' strokeWidth={1.75} />
      </span>
    );
  }

  if (normalized === 'FAILED') {
    return (
      <span className={cn('inline-flex h-4 w-4 items-center justify-center')} title='Failed'>
        <AlertCircle className='h-3 w-3 text-red-500' strokeWidth={1.75} />
      </span>
    );
  }

  return null;
};
