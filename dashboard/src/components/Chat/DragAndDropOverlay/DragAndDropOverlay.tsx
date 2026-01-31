import React from 'react';
import { Upload } from 'lucide-react';

interface DragAndDropOverlayProps {
  isVisible: boolean;
}

export const DragAndDropOverlay: React.FC<DragAndDropOverlayProps> = ({ isVisible }) => {
  if (!isVisible) return null;

  return (
    <div
      className='absolute inset-0 z-50 bg-blue-50/90 backdrop-blur-sm border-2 border-dashed border-blue-300 rounded-lg flex items-center justify-center'
      data-component='DragAndDropOverlay'
    >
      <div className='text-center p-8'>
        <div className='flex justify-center mb-4'>
          <div className='p-4 bg-blue-100 rounded-full'>
            <Upload className='w-8 h-8 text-blue-600' />
          </div>
        </div>
        <h3 className='text-lg font-medium text-blue-900 mb-2'>Drop files here</h3>
        <p className='text-sm text-blue-700'>Release to attach files to your message</p>
      </div>
    </div>
  );
};

export default DragAndDropOverlay;
