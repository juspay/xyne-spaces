import React from 'react';
import { GridCardData } from './GridCard';
import { formatFileBrowserDate } from '../../../utils/dateUtils';

interface GridCardMetadataProps {
  file: GridCardData;
}

export const GridCardMetadata: React.FC<GridCardMetadataProps> = ({ file }) => {
  return (
    <div className='text-xs text-gray-500 space-y-0.5'>
      <div>Updated {formatFileBrowserDate(new Date(file.updatedAt))}</div>
    </div>
  );
};
