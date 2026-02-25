import React, { JSX, useState, useEffect, useCallback, useRef } from 'react';
import { Download, X, ChevronLeft, ChevronRight } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { detectFileType, formatFileSize } from './utils';
import { fetchFile, downloadFile, createPreviewUrl } from '../../services/clients/fileFetchService';
import { downloadAttachment } from '../Chat/MessageAttachment/utils';
import { usePlatform } from '../../hooks/usePlatform';
import { useShortcut, useScope } from '../../shortcuts';
import { cn } from '../../utils/classNames';

export interface FileItem {
  fileName: string;
  fileUrl: string;
  mimeType: string;
  fileSize: number;
  attachmentId?: string;
  thumbnailUrl?: string | null;
}

interface FilePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileName: string;
  fileUrl: string;
  mimeType: string;
  fileSize: number;
  attachmentId?: string;
  initialTime?: number;
  files?: FileItem[];
  currentIndex?: number;
  onNavigate?: (index: number) => void;
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

// Placeholder for non-mounted carousel slides
const SlidePlaceholder: React.FC<{ file: FileItem }> = ({ file }) => {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  const isImage = file.mimeType.startsWith('image/');
  const isVideo = file.mimeType.startsWith('video/');

  useEffect(() => {
    // For images, fetch the preview thumbnail so user sees the image during swipe
    if (!isImage && !(isVideo && file.thumbnailUrl)) return;

    const source =
      isVideo && file.thumbnailUrl && file.attachmentId
        ? `/attachments/${file.attachmentId}/thumbnail`
        : file.attachmentId || file.fileUrl;

    createPreviewUrl(source)
      .then(blob => {
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        setBlobUrl(url);
      })
      .catch(() => {});

    return () => {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, [file.attachmentId, file.fileUrl, file.thumbnailUrl, isImage, isVideo]);

  if (blobUrl) {
    return (
      <div className='w-full h-full flex items-center justify-center'>
        <img src={blobUrl} alt={file.fileName} className='max-w-full max-h-full object-contain' />
      </div>
    );
  }

  return <LoadingState />;
};

// Individual slide component - fetches its own file
const SlideContent: React.FC<{
  file: FileItem;
}> = ({ file }) => {
  const [fileData, setFileData] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fileType = detectFileType(file.mimeType, file.fileName);
  const isVideo = fileType?.displayName === 'Video';

  useEffect(() => {
    if (isVideo) {
      setIsLoading(false);
      return;
    }

    fetchFile(file.fileUrl, file.fileName, file.mimeType)
      .then(setFileData)
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load file'))
      .finally(() => setIsLoading(false));
  }, [file.fileUrl, file.fileName, file.mimeType, isVideo]);

  if (isLoading) return <LoadingState />;

  if (error) {
    return (
      <div className='flex flex-col items-center gap-3'>
        <p className='text-red-400 text-sm'>{error}</p>
      </div>
    );
  }

  if (!fileType) {
    return (
      <div className='text-gray-300 text-center'>
        <p>Preview not available</p>
      </div>
    );
  }

  if (isVideo && file.attachmentId) {
    const ViewerComponent = fileType.component;
    return (
      <div className={fileType.wrapperClass}>
        <ViewerComponent source={null} fileName={file.fileName} attachmentId={file.attachmentId} />
      </div>
    );
  }

  if (!fileData) return <LoadingState />;

  const ViewerComponent = fileType.component;
  return (
    <div className={`${fileType.wrapperClass} max-w-full max-h-full`}>
      <ViewerComponent source={fileData} fileName={file.fileName} />
    </div>
  );
};

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
        data-track-category='FileViewer'
        data-track-name='RETRY_LOAD_FILE'
        data-track-metadata={JSON.stringify({ error })}
      >
        Try Again
      </button>
      <button
        onClick={onDownload}
        className='px-4 py-2 bg-white/10 text-white rounded hover:bg-white/20 flex items-center gap-2 transition-colors text-sm backdrop-blur-sm'
        data-track-category='FileViewer'
        data-track-name='DOWNLOAD_FILE'
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
      data-track-category='FileViewer'
      data-track-name='DOWNLOAD_UNSUPPORTED_FILE'
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
  initialTime,
  files,
  currentIndex = 0,
  onNavigate,
}) => {
  // Simple state - service handles all caching and complexity
  const [fileData, setFileData] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const { isMobile } = usePlatform();

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const constraintsRef = useRef(null);

  // Track which slides have been mounted so they stay alive once loaded
  const [mountedSlides, setMountedSlides] = useState<Set<number>>(() => new Set());

  const hasStackNavigation = files && files.length > 1;
  const totalFiles = hasStackNavigation ? files.length : 1;
  const currentFileIndex = hasStackNavigation
    ? Math.max(0, Math.min(currentIndex, files.length - 1))
    : 0;

  // Get current file info from stack or props
  const currentFile = hasStackNavigation ? files[currentFileIndex] : null;
  const currentFileName = currentFile?.fileName ?? fileName;
  const currentFileUrl = currentFile?.fileUrl ?? fileUrl;
  const currentMimeType = currentFile?.mimeType ?? mimeType;
  const currentFileSize = currentFile?.fileSize ?? fileSize;
  const currentAttachmentId = currentFile?.attachmentId ?? attachmentId;

  // Detect file type using utility function
  const fileType = detectFileType(currentMimeType, currentFileName);

  // For videos, skip the download and use streaming directly
  const isVideo = fileType?.displayName === 'Video';

  // Expand mounted slides as user navigates (current ±1), reset on close
  useEffect(() => {
    if (!isOpen || !hasStackNavigation) {
      setMountedSlides(new Set());
      return;
    }
    setMountedSlides(prev => {
      const next = new Set(prev);
      for (
        let i = Math.max(0, currentFileIndex - 1);
        i <= Math.min(totalFiles - 1, currentFileIndex + 1);
        i++
      ) {
        next.add(i);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [isOpen, hasStackNavigation, currentFileIndex, totalFiles]);

  // Push viewer scope for keyboard shortcuts
  useScope('viewer', isOpen);

  // Navigation handlers - scroll is handled by useEffect when currentFileIndex changes
  const handlePrevious = useCallback(() => {
    if (!hasStackNavigation || currentFileIndex <= 0) return;
    onNavigate?.(currentFileIndex - 1);
  }, [hasStackNavigation, currentFileIndex, onNavigate]);

  const handleNext = useCallback(() => {
    if (!hasStackNavigation || currentFileIndex >= totalFiles - 1) return;
    onNavigate?.(currentFileIndex + 1);
  }, [hasStackNavigation, currentFileIndex, totalFiles, onNavigate]);

  // Register keyboard shortcuts for navigation
  useShortcut(
    'left',
    e => {
      e.preventDefault();
      handlePrevious();
    },
    {
      scope: 'viewer',
      enabled: Boolean(isOpen && hasStackNavigation && currentFileIndex > 0),
      preventDefault: true,
      priority: 200,
    },
  );

  useShortcut(
    'right',
    e => {
      e.preventDefault();
      handleNext();
    },
    {
      scope: 'viewer',
      enabled: Boolean(isOpen && hasStackNavigation && currentFileIndex < totalFiles - 1),
      preventDefault: true,
      priority: 200,
    },
  );

  // Scroll to current index when modal opens (for carousel navigation)
  const scrollContainerCallbackRef = useCallback(
    (node: HTMLDivElement | null) => {
      scrollContainerRef.current = node;
      if (node && hasStackNavigation) {
        requestAnimationFrame(() => {
          node.scrollTo({
            left: currentFileIndex * node.clientWidth,
            behavior: 'auto',
          });
        });
      }
    },
    [hasStackNavigation, currentFileIndex],
  );

  // Also scroll when currentFileIndex changes via button/keyboard navigation
  useEffect(() => {
    if (scrollContainerRef.current && hasStackNavigation) {
      scrollContainerRef.current.scrollTo({
        left: currentFileIndex * scrollContainerRef.current.clientWidth,
        behavior: 'smooth',
      });
    }
  }, [currentFileIndex, hasStackNavigation]);

  // Fetch current file - simple fetch like old code
  useEffect(() => {
    if (!isOpen || !currentFileUrl || isVideo || hasStackNavigation) {
      setFileData(null);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    fetchFile(currentFileUrl, currentFileName, currentMimeType)
      .then(setFileData)
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load file'))
      .finally(() => setIsLoading(false));
  }, [isOpen, currentFileUrl, currentFileName, currentMimeType, isVideo, hasStackNavigation]);

  // Handle download with utility function
  const handleDownload = async (): Promise<void> => {
    if (currentAttachmentId) {
      // Use shared downloadAttachment function for attachment downloads
      await downloadAttachment(currentAttachmentId, currentFileName);
    } else {
      // Fall back to downloadFile for generic file URLs
      await downloadFile(currentFileUrl, currentFileName);
    }
  };

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
      if (currentAttachmentId) {
        const ViewerComponent = fileType.component;
        return (
          <div className={fileType.wrapperClass}>
            <ViewerComponent
              source={null}
              fileName={currentFileName}
              attachmentId={currentAttachmentId}
              onExpand={onClose}
              {...(initialTime !== undefined && { initialTime })}
            />
          </div>
        );
      }
      // Handle the case where it's a video but there's no attachmentId
      return (
        <div className='flex flex-col items-center justify-center h-full gap-3'>
          <p className='text-gray-400'>Video cannot be streamed</p>
          <button
            onClick={() => void handleDownload()}
            className='px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-2'
            data-track-category='FileViewer'
            data-track-name='DOWNLOAD_VIDEO'
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
        <ViewerComponent source={fileData} fileName={currentFileName} />
      </div>
    );
  };

  // Scroll-snap carousel — lazy mount ±1 slides, show thumbnail placeholder for others
  const renderCarousel = () => {
    return (
      <div
        ref={scrollContainerCallbackRef}
        className='flex w-full h-full overflow-x-auto overflow-y-hidden'
        style={{
          scrollSnapType: 'x mandatory',
          scrollbarWidth: 'none',
          WebkitOverflowScrolling: 'auto',
        }}
      >
        {files!.map((file, index) => (
          <div
            key={file.attachmentId || `file-${index}-${file.fileName}`}
            className='flex-shrink-0 w-full h-full flex items-center justify-center [scroll-snap-align:center] [scroll-snap-stop:always]'
          >
            {mountedSlides.has(index) ? (
              <SlideContent file={file} />
            ) : (
              <SlidePlaceholder file={file} />
            )}
          </div>
        ))}
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

  // Helper function to render floating top bar with optional close button
  const renderFloatingTopBar = (includeCloseButton: boolean): JSX.Element => (
    <div
      className={`absolute gap-6 p-5 top-0 left-0 z-20 flex transition-opacity duration-300 ${
        isHovered ? 'opacity-100' : 'opacity-0'
      } w-full`}
    >
      {/* Gradient overlay - always full width */}
      <div className='absolute inset-0 bg-gradient-to-b from-black/60 to-transparent w-full' />
      {/* Content */}
      <div className='relative flex items-center justify-between w-full'>
        <div className='flex-1 min-w-0'>
          <Dialog.Title className='text-base font-medium text-white truncate drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]'>
            {currentFileName}
          </Dialog.Title>
          <Dialog.Description className='text-xs text-white/90 mt-0.5 drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]'>
            {hasStackNavigation
              ? `${currentFileIndex + 1} of ${totalFiles} • ${formatFileSize(currentFileSize)}${fileType ? ` • ${fileType.displayName}` : ''}`
              : `${formatFileSize(currentFileSize)}${fileType ? ` • ${fileType.displayName}` : ''}`}
          </Dialog.Description>
        </div>
        <div className='flex items-center gap-3'>
          <button
            onClick={() => void handleDownload()}
            className='inline-flex items-center gap-2 justify-center w-9 h-9 text-sm font-medium text-white/90 hover:text-white hover:bg-white/10 rounded-md transition-colors'
            data-track-category='FileViewer'
            data-track-name='DOWNLOAD_FILE_FROM_MODAL'
          >
            <Download className='h-4 w-4' />
          </button>
          {includeCloseButton && (
            <Dialog.Close asChild>
              <button
                className='inline-flex items-center justify-center w-9 h-9 text-white/90 hover:text-white hover:bg-white/10 rounded-md transition-colors'
                aria-label='Close'
              >
                <X className='h-5 w-5' />
              </button>
            </Dialog.Close>
          )}
        </div>
      </div>
    </div>
  );

  // Navigation arrow buttons
  const renderNavigationArrows = (): JSX.Element | null => {
    if (!hasStackNavigation) return null;

    const canGoPrevious = currentFileIndex > 0;
    const canGoNext = currentFileIndex < totalFiles - 1;

    return (
      <>
        {/* Previous Button */}
        {canGoPrevious && (
          <button
            onClick={handlePrevious}
            className={cn(
              'absolute left-4 top-1/2 -translate-y-1/2 z-50 rounded-full p-3 bg-black/10 hover:bg-black/20 text-white transition-all duration-200',
              isMobile ? 'opacity-100' : isHovered ? 'opacity-100' : 'opacity-0',
            )}
            aria-label='Previous file'
            title='Previous (←)'
            type='button'
            data-track-category='FILE_VIEWER'
            data-track-name='PreviousFile'
          >
            <ChevronLeft className='h-6 w-6' />
          </button>
        )}

        {/* Next Button */}
        {canGoNext && (
          <button
            onClick={handleNext}
            className={cn(
              'absolute right-4 top-1/2 -translate-y-1/2 z-50 rounded-full p-3 bg-black/10 hover:bg-black/20 text-white transition-all duration-200',
              isMobile ? 'opacity-100' : isHovered ? 'opacity-100' : 'opacity-0',
            )}
            aria-label='Next file'
            title='Next (→)'
            type='button'
            data-track-category='FILE_VIEWER'
            data-track-name='NextFile'
          >
            <ChevronRight className='h-6 w-6' />
          </button>
        )}
      </>
    );
  };

  const renderMainContent = () => (hasStackNavigation ? renderCarousel() : renderContent());

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
          <div className='absolute inset-0 bg-white'>
            <div
              ref={constraintsRef}
              className={cn(
                'relative w-full h-full',
                isImage
                  ? 'overflow-hidden before:absolute before:inset-0 before:bg-black/80 before:z-0 before:backdrop-blur-md bg-black/30'
                  : 'overflow-auto bg-white',
              )}
            >
              {/* Floating top bar */}
              {renderFloatingTopBar(true)}
              <div className='relative z-10 h-full w-full flex items-center justify-center'>
                {renderMainContent()}
              </div>

              {/* Navigation arrow*/}
              {renderNavigationArrows()}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
