import React from 'react';
import { AlertCircle } from 'lucide-react';
import Tooltip from '../../ui/Tooltip';

interface FileFailedBadgeV2Props {
  status: string | null | undefined;
}

/**
 * Small circular status indicator overlaid on a file's icon, matching
 * CollectionStatusBadgeV2's folder styling — but only ever rendered for a
 * FAILED file (PENDING/PROCESSING keep IngestStatusV2's text pill instead).
 */
export const FileFailedBadgeV2: React.FC<FileFailedBadgeV2Props> = ({ status }) => {
  if ((status ?? '').toUpperCase() !== 'FAILED') return null;

  return (
    <Tooltip content='Failed to process this file' side='top'>
      <span
        aria-label='Failed to process this file'
        className='grid h-5 w-5 place-items-center rounded-full bg-background ring-1 ring-border'
      >
        <AlertCircle className='h-3.5 w-3.5 text-red-500' strokeWidth={2} />
      </span>
    </Tooltip>
  );
};
