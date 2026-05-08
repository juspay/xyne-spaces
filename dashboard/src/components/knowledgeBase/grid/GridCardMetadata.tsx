import React from 'react';
import { GridCardData } from './GridCard';

interface GridCardMetadataProps {
  file: GridCardData;
}

/**
 * Metadata component for grid cards
 * Shows file size and last updated time
 */
export const GridCardMetadata: React.FC<GridCardMetadataProps> = ({ file }) => {
  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className='text-xs text-gray-500 space-y-0.5'>
      <div>Updated {formatDate(file.updatedAt)}</div>
    </div>
  );
};
