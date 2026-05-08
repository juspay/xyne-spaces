import React from 'react';
import { Upload } from 'lucide-react';
import { Button } from '../../ui/Button';
import Tooltip from '../../ui/Tooltip';

interface UploadButtonProps {
  onClick: () => void;
  disabled?: boolean;
}

/**
 * Upload Button Component
 * Simple button that opens upload modal
 */
export const UploadButton: React.FC<UploadButtonProps> = ({ onClick, disabled }) => {
  return (
    <Tooltip content='Upload files' side='top'>
      <Button
        size='sm'
        variant='outline'
        onClick={onClick}
        disabled={disabled}
        className='h-9 px-3 flex rounded-full items-center gap-1.5 transition-all duration-300 border-0 shadow-none'
      >
        <Upload size={16} />
      </Button>
    </Tooltip>
  );
};
