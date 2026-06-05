import React from 'react';
import { createPortal } from 'react-dom';
import { Loader2, FileArchive, FileDown, X } from 'lucide-react';
import Tooltip from '../../ui/Tooltip';

interface DownloadOverlayProps {
  isOpen: boolean;
  itemName: string;
  itemType: 'file' | 'folder';
  onDismiss?: () => void;
}

/**
 * Download Overlay Component
 * Shows a floating bottom-right card while downloading files or zipping folders
 * Similar to GlobalUploadProgress - non-blocking, positioned in corner
 */
export const DownloadOverlay: React.FC<DownloadOverlayProps> = ({
  isOpen,
  itemName,
  itemType,
  onDismiss,
}) => {
  if (!isOpen) return null;

  const isFolder = itemType === 'folder';

  return createPortal(
    <div className='fixed bottom-4 right-4 z-[60] w-80 rounded-lg shadow-2xl border border-gray-200 bg-white overflow-hidden animate-in slide-in-from-bottom-4 fade-in duration-300'>
      {/* Header */}
      <div className='flex items-center justify-between px-3 py-2.5 bg-gray-50 border-b border-gray-100'>
        <div className='flex items-center gap-2 min-w-0 flex-1'>
          {isFolder ? (
            <FileArchive size={16} className='text-blue-500 flex-shrink-0' />
          ) : (
            <FileDown size={16} className='text-blue-500 flex-shrink-0' />
          )}
          <span className='text-sm font-medium text-gray-800 truncate'>
            {isFolder ? 'Zipping folder...' : 'Downloading file...'}
          </span>
        </div>

        {onDismiss && (
          <Tooltip content='Dismiss' side='top'>
            <button
              onClick={onDismiss}
              data-track-category='knowledge-base'
              data-track-name='dismiss-download'
              className='p-1 rounded hover:bg-gray-200 transition-colors text-gray-500 flex-shrink-0 ml-2'
            >
              <X size={14} />
            </button>
          </Tooltip>
        )}
      </div>

      {/* Content */}
      <div className='px-3 py-3'>
        <div className='flex items-center gap-3'>
          {/* Animated icon */}
          <div className='relative flex-shrink-0'>
            <div className='w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center'>
              {isFolder ? (
                <FileArchive size={20} className='text-blue-600' />
              ) : (
                <FileDown size={20} className='text-blue-600' />
              )}
            </div>
            <div className='absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-white rounded-full flex items-center justify-center'>
              <Loader2 size={12} className='text-blue-600 animate-spin' />
            </div>
          </div>

          {/* File info */}
          <div className='flex-1 min-w-0'>
            <Tooltip content={itemName} side='top'>
              <p className='text-sm text-gray-700 truncate cursor-default'>{itemName}</p>
            </Tooltip>
            <p className='text-xs text-gray-500 mt-0.5'>
              {isFolder ? 'Preparing zip archive...' : 'Downloading...'}
            </p>
          </div>
        </div>

        {/* Progress bar */}
        <div className='mt-3'>
          <div className='w-full bg-gray-100 rounded-full h-1.5 overflow-hidden'>
            <div className='bg-blue-500 h-full rounded-full animate-pulse w-full' />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};
