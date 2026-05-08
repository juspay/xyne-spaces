import React from 'react';
import { Download } from 'lucide-react';
import { XyneAIStar } from '../../icons/xyne-ai';
import Tooltip from '../../ui/Tooltip';
import { formatFileSize } from '../../FileViewer/utils';
import { detectFileType } from '../../FileViewer/utils';

interface FileViewerHeaderProps {
  file: {
    id: string;
    name: string;
    type: string;
    size?: number;
  };
  onDownload?: (() => void) | undefined;
  onOpenChat?: (() => void) | undefined;
}

/**
 * Header component for file viewer with transparent gradient styling
 */
export const FileViewerHeader: React.FC<FileViewerHeaderProps> = ({
  file,
  onDownload,
  onOpenChat,
}) => {
  const fileType = detectFileType(file.type, file.name);

  const handleDownload = (): void => {
    if (onDownload) {
      onDownload();
    }
  };

  return (
    <div className='absolute bg-gradient-to-b from-black/60 to-transparent gap-6 p-5 w-full top-0 left-0 z-20 flex'>
      <div className='flex-1 min-w-0'>
        <h1 className='text-base font-medium text-white truncate drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]'>
          {file.name}
        </h1>
        <p className='text-xs text-white/90 mt-0.5 drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]'>
          {file.size ? formatFileSize(file.size) : ''}
          {fileType ? ` • ${fileType.displayName}` : ''}
        </p>
      </div>
      <div className='flex items-center gap-3'>
        {onOpenChat && (
          <Tooltip content='Ask AI about this file' side='bottom'>
            <button
              onClick={onOpenChat}
              data-track-category='knowledge-base'
              data-track-name='open-ai-chat'
              className='inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white/90 hover:text-white bg-white/10 hover:bg-white/20 rounded-md transition-colors'
            >
              <XyneAIStar size={16} />
              <span>Ask AI</span>
            </button>
          </Tooltip>
        )}
        <button
          onClick={handleDownload}
          data-track-category='knowledge-base'
          data-track-name='download-file'
          className='inline-flex items-center gap-2 justify-center w-9 h-9 text-sm font-medium text-white/90 hover:text-white hover:bg-white/10 rounded-md transition-colors'
          aria-label='Download file'
        >
          <Download className='h-4 w-4' />
        </button>
      </div>
    </div>
  );
};
