import React, { JSX, useState, useEffect } from 'react';
import { Download, X } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { detectFileType, formatFileSize } from './utils';
import { fetchFile, downloadFile } from '../../services/clients/fileFetchService';
import { downloadAttachment } from '../Chat/MessageAttachment/utils';
import { usePlatform } from '../../hooks/usePlatform';

interface FilePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileName: string;
  fileUrl: string;
  mimeType: string;
  fileSize: number;
  attachmentId?: string; // Optional: if provided, use downloadAttachment instead of downloadFile
}

// Inline Loading Component
const LoadingState: React.FC<{ message?: string }> = ({ message = 'Loading preview...' }) => (
  <div className='flex items-center justify-center h-full'>
    <div className='flex flex-col items-center gap-3'>
      <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-white'></div>
      <div className='text-gray-300 text-sm text-center max-w-xs'>{message}</div>
    </div>
  </div>
);

// Inline Error Component
const ErrorState: React.FC<{
  error: string;
  onRetry: () => void;
  onDownload: () => void;
}> = ({ error, onRetry, onDownload }) => (
  <div className='flex flex-col items-center justify-center h-full gap-4'>
    <div className='text-center'>
      <div className='text-red-400 font-medium mb-2'>Failed to load preview</div>
      <div className='text-red-300 text-sm mb-4'>{error}</div>
    </div>
    <div className='flex gap-2'>
      <button
        onClick={onRetry}
        className='px-4 py-2 bg-white/10 text-white rounded hover:bg-white/20 transition-colors text-sm backdrop-blur-sm'
      >
        Try Again
      </button>
      <button
        onClick={onDownload}
        className='px-4 py-2 bg-white/10 text-white rounded hover:bg-white/20 flex items-center gap-2 transition-colors text-sm backdrop-blur-sm'
      >
        <Download className='h-4 w-4' />
        Download
      </button>
    </div>
  </div>
);

// Inline Unsupported File Component
const UnsupportedFileState: React.FC<{
  onDownload: () => void;
}> = ({ onDownload }) => (
  <div className='flex flex-col items-center justify-center h-full gap-4'>
    <div className='text-gray-300 text-center'>
      <div className='text-6xl mb-4'>📄</div>
      <p className='text-lg font-semibold mb-2 text-white'>Preview not available</p>
      <p className='text-sm text-gray-400'>This file type cannot be previewed in the browser</p>
    </div>
    <button
      onClick={onDownload}
      className='px-4 py-2 bg-white/10 text-white rounded hover:bg-white/20 flex items-center gap-2 transition-colors backdrop-blur-sm'
    >
      <Download className='h-4 w-4' />
      Download File
    </button>
  </div>
);

export const FilePreviewModal: React.FC<FilePreviewModalProps> = ({
  isOpen,
  onClose,
  fileName,
  fileUrl,
  mimeType,
  fileSize,
  attachmentId,
}) => {
  // Simple state - service handles all caching and complexity
  const [fileData, setFileData] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const { isMobile } = usePlatform();

  // Detect file type using utility function
  const fileType = detectFileType(mimeType, fileName);

  // For videos, skip the download and use streaming directly
  const isVideo = fileType?.displayName === 'Video';

  // Simple fetch - service handles everything (but skip for videos)
  useEffect(() => {
    if (!isOpen || !fileUrl || isVideo) {
      setFileData(null);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    fetchFile(fileUrl, fileName, mimeType)
      .then(setFileData)
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load file'))
      .finally(() => setIsLoading(false));
  }, [isOpen, fileUrl, fileName, mimeType, isVideo]);

  // Handle download with utility function
  const handleDownload = async (): Promise<void> => {
    if (attachmentId) {
      // Use shared downloadAttachment function for attachment downloads
      await downloadAttachment(attachmentId, fileName);
    } else {
      // Fall back to downloadFile for generic file URLs
      await downloadFile(fileUrl, fileName);
    }
  };

  // React Query handles cleanup automatically

  const renderContent = (): JSX.Element => {
    if (isLoading) {
      return <LoadingState message={'Loading preview...'} />;
    }

    if (error) {
      return (
        <ErrorState error={error} onRetry={() => {}} onDownload={() => void handleDownload()} />
      );
    }

    if (!fileType) {
      return <UnsupportedFileState onDownload={() => void handleDownload()} />;
    }

    // For videos, we need an attachmentId to stream
    if (isVideo) {
      if (attachmentId) {
        const ViewerComponent = fileType.component;
        return (
          <div className={fileType.wrapperClass}>
            <ViewerComponent source={null} fileName={fileName} attachmentId={attachmentId} />
          </div>
        );
      }
      // Handle the case where it's a video but there's no attachmentId
      return (
        <div className='flex flex-col items-center justify-center h-full gap-3'>
          <p className='text-gray-600'>Video cannot be streamed</p>
          <button
            onClick={() => void handleDownload()}
            className='px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-2'
          >
            <Download className='h-4 w-4' />
            Download Video
          </button>
        </div>
      );
    }

    // For non-video files, ensure we have file data before rendering
    if (!fileData) {
      return <LoadingState message='Loading file data...' />;
    }

    // Render the appropriate viewer component
    const ViewerComponent = fileType.component;
    return (
      <div className={`${fileType.wrapperClass} max-w-full max-h-full`}>
        <ViewerComponent source={fileData} fileName={fileName} />
      </div>
    );
  };

  const isImage = fileType?.displayName === 'Image';

  const [backgroundImageUrl, setBackgroundImageUrl] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;

    if (isImage && fileData) {
      objectUrl = URL.createObjectURL(fileData);
      setBackgroundImageUrl(objectUrl);
    } else {
      setBackgroundImageUrl(null);
    }

    return (): void => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [isImage, fileData]);

  return (
    <Dialog.Root open={isOpen} onOpenChange={onClose}>
      <Dialog.Portal>
        <Dialog.Overlay className='fixed inset-0 flex items-center justify-center bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 z-50' />
        <Dialog.Content
          className={`fixed z-50 bg-black focus:outline-none 
          data-[state=closed]:fade-out transition-all ease-in-out duration-300
          data-[state=open]:fade-in overflow-hidden
          ${
            isMobile
              ? 'inset-0 w-screen h-screen' // Fullscreen on mobile
              : 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[95vw] h-[95vh] rounded-2xl before:absolute before:inset-0 before:bg-black/80 before:z-0 before:backdrop-blur-md bg-black/30'
          }`}
          style={{
            transformOrigin: 'center',
            backgroundImage: backgroundImageUrl ? `url(${backgroundImageUrl})` : undefined,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
          }}
          onInteractOutside={onClose}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          {/* Content - Full surface with padding for floating controls */}
          <div className='absolute inset-0 flex items-center justify-center bg-white'>
            <div className='w-full h-full'>{renderContent()}</div>
          </div>

          {/* Floating Top Bar */}
          <div
            className={`absolute bg-gradient-to-b from-black/60 to-transparent gap-6 p-5 w-full top-0 left-0 z-20 flex transition-opacity duration-300 ${
              isHovered ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <div className='flex-1 min-w-0'>
              <Dialog.Title className='text-base font-medium text-white truncate drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]'>
                {fileName}
              </Dialog.Title>
              <Dialog.Description className='text-xs text-white/90 mt-0.5 drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]'>
                {`${formatFileSize(fileSize)}${fileType ? ` • ${fileType.displayName}` : ''}`}
              </Dialog.Description>
            </div>
            <div className='flex items-center gap-3'>
              <button
                onClick={() => void handleDownload()}
                className='inline-flex items-center gap-2 justify-center w-9 h-9 text-sm font-medium text-white/90 hover:text-white hover:bg-white/10 rounded-md transition-colors'
              >
                <Download className='h-4 w-4' />
              </button>
              <Dialog.Close asChild>
                <button
                  className='inline-flex items-center justify-center w-9 h-9 text-white/90 hover:text-white hover:bg-white/10 rounded-md transition-colors'
                  aria-label='Close'
                >
                  <X className='h-5 w-5' />
                </button>
              </Dialog.Close>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
