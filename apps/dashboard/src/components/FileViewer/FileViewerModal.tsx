import React, { JSX, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Download, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { CopyCopied, CopyDefault } from '@xyne/icons';
import { useClipboard } from '../../hooks/useClipboard';
import * as Dialog from '@radix-ui/react-dialog';
import { useLocation } from 'react-router-dom';
import { detectFileType, formatFileSize } from './utils';
import { fetchFile, downloadFile, createPreviewUrl } from '../../services/clients/fileFetchService';
import { downloadAttachment } from '../Chat/MessageAttachment/utils';
import { usePlatform } from '../../hooks/usePlatform';
import { useShortcut, useScope } from '../../shortcuts';
import { cn } from '../../utils/classNames';
import { useSelector } from '@xstate/react';
import { PreviewSplitDialog, PreviewThreadPanel } from '../ui/PreviewSplitDialog';
import { ChatBubble } from '../Chat/ChatBubble/ChatBubble';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { useGetChannelUserStatus } from '../../hooks/useChannels';
import { queries } from '../../zero/queries';
import { QueryResultType } from '@rocicorp/zero';
import {
  AttachmentRef,
  attachmentViewerActor,
  AttachmentViewerState,
} from '../../machines/attachmentViewerMachine';
import { ZoomState } from './utils';
import { FileSearchControls, FileSearchProvider, useFileSearchContext } from './search';

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
  /**
   * Tailwind z-index class for the overlay and content. Raise it when the modal
   * is opened from inside a higher-stacked surface — the Cmd+K palette sits at
   * z-[9999], so the default would render the preview behind it.
   */
  zIndexClass?: string;
}

// Inline Loading Component
const LoadingState: React.FC<{ message?: string }> = ({ message = 'Loading preview...' }) => (
  <div className='flex items-center justify-center h-full'>
    <div className='flex flex-col items-center gap-3'>
      <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-white'></div>
      <div className='text-muted text-sm text-center max-w-xs'>{message}</div>
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
  isActive: boolean;
  disableGestures?: boolean;
  initialTime?: number | undefined;
  autoPlay?: boolean;
  onInteractionStateChange?: (state: ZoomState) => void;
}> = ({ file, isActive, disableGestures, initialTime, autoPlay, onInteractionStateChange }) => {
  const [fileData, setFileData] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fileType = detectFileType(file.mimeType, file.fileName);
  const isVideo = fileType?.displayName === 'Video';
  const isCarouselMode = Boolean(disableGestures);

  const [viewerResetKey, setViewerResetKey] = useState(0);
  const prevActiveRef = useRef(isActive);

  useEffect(() => {
    if (prevActiveRef.current && !isActive) {
      // Slide just became inactive — remount the viewer so zoom/state is
      // cleared before the user potentially swipes back to this slide.
      setViewerResetKey(k => k + 1);
    }
    prevActiveRef.current = isActive;
  }, [isActive]);

  useEffect(() => {
    // Only fetch when this slide is active (visible)
    if (!isActive) return;

    if (isVideo) return;

    fetchFile(file.fileUrl, file.fileName, file.mimeType)
      .then(setFileData)
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load file'));
  }, [file.fileUrl, file.fileName, file.mimeType, isVideo, isActive]);

  if (error) {
    return (
      <div className='flex flex-col items-center gap-3'>
        <p className='text-red-400 text-sm'>{error}</p>
      </div>
    );
  }

  if (!fileType) {
    return (
      <div className='text-muted text-center'>
        <p>Preview not available</p>
      </div>
    );
  }

  if (isVideo) {
    // Only render video player when this slide is active to prevent background streaming when grouped with non-video attachments
    if (!isActive) {
      return <SlidePlaceholder file={file} />;
    }

    if (file.attachmentId) {
      const ViewerComponent = fileType.component;
      return (
        <div className={fileType.wrapperClass}>
          <ViewerComponent
            source={null}
            fileName={file.fileName}
            attachmentId={file.attachmentId}
            autoPlay={Boolean(autoPlay)}
            {...(initialTime !== undefined && { initialTime })}
            {...(isCarouselMode && { disableGestures: true })}
            {...(isCarouselMode && onInteractionStateChange && { onInteractionStateChange })}
          />
        </div>
      );
    }
    // Fallback for videos without attachmentId
    return (
      <div className='flex flex-col items-center justify-center h-full gap-3'>
        <p className='text-gray-400'>Video cannot be streamed</p>
        <button
          onClick={() => {
            void downloadFile(file.fileUrl, file.fileName);
          }}
          data-track-category='FILE_VIEWER'
          data-track-name='DownloadVideo'
          className='px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-2'
        >
          <Download className='h-4 w-4' />
          Download Video
        </button>
      </div>
    );
  }

  // No loader - render file if we have it, otherwise nothing (keeps stale content)
  if (!fileData) {
    return null;
  }

  const ViewerComponent = fileType.component;
  return (
    <div className={`${fileType.wrapperClass} max-w-full max-h-full`}>
      <ViewerComponent
        key={viewerResetKey}
        source={fileData}
        fileName={file.fileName}
        // Only the visible slide participates in search; adjacent mounted slides
        // must not register as the find bar's target.
        searchable={isActive}
        {...(isCarouselMode && { disableGestures: true })}
        {...(isCarouselMode && onInteractionStateChange && { onInteractionStateChange })}
      />
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
        className='px-4 py-2 bg-background/10 text-white rounded hover:bg-background/20 transition-colors text-sm backdrop-blur-sm'
        data-track-category='FileViewer'
        data-track-name='RETRY_LOAD_FILE'
        data-track-metadata={JSON.stringify({ error })}
      >
        Try Again
      </button>
      <button
        onClick={onDownload}
        className='px-4 py-2 bg-background/10 text-white rounded hover:bg-background/20 flex items-center gap-2 transition-colors text-sm backdrop-blur-sm'
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
    <div className='text-muted text-center'>
      <div className='text-6xl mb-4'>📄</div>
      <p className='text-lg font-semibold mb-2 text-white'>Preview not available</p>
      <p className='text-sm text-muted-foreground'>
        This file type cannot be previewed in the browser
      </p>
    </div>
    <button
      onClick={onDownload}
      className='px-4 py-2 bg-background/10 text-white rounded hover:bg-background/20 flex items-center gap-2 transition-colors backdrop-blur-sm'
      data-track-category='FileViewer'
      data-track-name='DOWNLOAD_UNSUPPORTED_FILE'
    >
      <Download className='h-4 w-4' />
      Download File
    </button>
  </div>
);

const FilePreviewModalInner: React.FC<FilePreviewModalProps> = ({
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
  zIndexClass = 'z-[56]',
}) => {
  // Simple state - service handles all caching and complexity
  const [fileData, setFileData] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const { isMobile } = usePlatform();
  const search = useFileSearchContext();

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const constraintsRef = useRef(null);
  const touchStartRef = useRef<{ x: number; y: number; scrollLeft: number } | null>(null);
  const touchMoveRef = useRef<{ x: number; y: number } | null>(null);

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

  // Update index when user scrolls/swipes the carousel
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget;
    const { scrollLeft, clientWidth } = container;
    if (scrollLeft % clientWidth !== 0) return;
    const newIndex = Math.round(scrollLeft / clientWidth);
    if (newIndex !== currentFileIndex && newIndex >= 0 && newIndex < totalFiles) {
      onNavigate?.(newIndex);
    }
  };

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
        <ErrorState
          error={error}
          onRetry={() => {
            setIsLoading(true);
            setError(null);
            fetchFile(currentFileUrl, currentFileName, currentMimeType)
              .then(setFileData)
              .catch(err => setError(err instanceof Error ? err.message : 'Failed to load file'))
              .finally(() => setIsLoading(false));
          }}
          onDownload={() => void handleDownload()}
        />
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
          <p className='text-muted-foreground'>Video cannot be streamed</p>
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
  const disableCarouselGestures = Boolean(isMobile && hasStackNavigation);

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!isMobile || !hasStackNavigation) return;
    const touch = e.touches[0];
    if (!touch) return;
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      scrollLeft: scrollContainerRef.current?.scrollLeft ?? 0,
    };
    touchMoveRef.current = null;
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!isMobile || !hasStackNavigation) return;
    const touch = e.touches[0];
    if (!touch) return;
    touchMoveRef.current = { x: touch.clientX, y: touch.clientY };

    // Allow vertical scrolling - don't block if vertical movement dominates
    const start = touchStartRef.current;
    if (start) {
      const dx = Math.abs(touch.clientX - start.x);
      const dy = Math.abs(touch.clientY - start.y);
      // If vertical movement is greater than horizontal, allow default scroll
      if (dy > dx) {
        return;
      }
    }
  };

  const handleTouchEnd = () => {
    if (!isMobile || !hasStackNavigation) return;
    const start = touchStartRef.current;
    const end = touchMoveRef.current;
    touchStartRef.current = null;
    touchMoveRef.current = null;
    if (!start || !end) return;

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const scrollDelta = Math.abs((scrollContainerRef.current?.scrollLeft ?? 0) - start.scrollLeft);

    if (scrollDelta > 4) return;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return;

    if (dx < 0) {
      handleNext();
    } else {
      handlePrevious();
    }
  };

  const renderCarousel = () => {
    return (
      <div
        ref={scrollContainerCallbackRef}
        onScroll={handleScroll}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
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
              <SlideContent
                file={file}
                isActive={index === currentFileIndex}
                {...(disableCarouselGestures && { disableGestures: true })}
                {...(index === currentFileIndex && {
                  onInteractionStateChange: (state: ZoomState) => {
                    activeSlideZoomStateRef.current = state;
                  },
                })}
              />
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

  // Track zoom state for conditional carousel swipe
  const activeSlideZoomStateRef = useRef<ZoomState>({
    scale: 1,
    isAtLeftEdge: true,
    isAtRightEdge: true,
  });

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

  const { copyImage } = useClipboard();
  const [copied, setCopied] = useState(false);

  const handleCopyImage = async (): Promise<void> => {
    if (!fileData || !isImage) return;
    await copyImage(fileData);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

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
          {isImage && (
            <button
              onClick={() => void handleCopyImage()}
              className='inline-flex items-center gap-2 justify-center w-9 h-9 text-sm font-medium text-white/90 hover:text-white hover:bg-background/10 rounded-md transition-colors'
              data-track-category='FileViewer'
              data-track-name='COPY_IMAGE_FROM_MODAL'
              title='Copy Image'
            >
              {copied ? <CopyCopied className='h-4 w-4' /> : <CopyDefault className='h-4 w-4' />}
            </button>
          )}
          <button
            onClick={() => void handleDownload()}
            className='inline-flex items-center gap-2 justify-center w-9 h-9 text-sm font-medium text-white/90 hover:text-white hover:bg-background/10 rounded-md transition-colors'
            data-track-category='FileViewer'
            data-track-name='DOWNLOAD_FILE_FROM_MODAL'
          >
            <Download className='h-4 w-4' />
          </button>
          {includeCloseButton && (
            <button
              type='button'
              onClick={onClose}
              data-track-category='FileViewer'
              data-track-name='CloseFilePreview'
              className='inline-flex items-center justify-center w-9 h-9 text-white/90 hover:text-white hover:bg-background/10 rounded-md transition-colors'
              aria-label='Close'
            >
              <X className='h-5 w-5' />
            </button>
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
    <Dialog.Root
      open={isOpen}
      onOpenChange={open => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay
          className={`fixed inset-0 flex items-center justify-center bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 ${zIndexClass}`}
        />
        <Dialog.Content
          className={`fixed ${zIndexClass} bg-black focus:outline-none
          data-[state=closed]:fade-out transition-all ease-in-out duration-300
          data-[state=open]:fade-in overflow-hidden
          ${
            isMobile
              ? 'inset-0 w-screen h-screen'
              : 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[95vw] h-[95vh] rounded-2xl before:absolute before:inset-0 before:bg-black/80 before:z-0 before:backdrop-blur-md bg-black/30'
          }`}
          style={{
            backgroundImage: backgroundImageUrl ? `url(${backgroundImageUrl})` : undefined,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
          }}
          onInteractOutside={() => onClose()}
          onEscapeKeyDown={event => {
            // Escape closes the find bar first; only a second Escape closes the
            // whole preview. Radix would otherwise dismiss the dialog outright.
            if (search?.isOpen) {
              event.preventDefault();
              search.close();
            }
          }}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          {/* Content - Full surface with padding for floating controls */}
          <div className='absolute inset-0 bg-background'>
            <div
              ref={constraintsRef}
              className={cn(
                'relative w-full h-full',
                isImage
                  ? 'overflow-hidden before:absolute before:inset-0 before:bg-black/80 before:z-0 before:backdrop-blur-md bg-black/30'
                  : 'overflow-auto bg-background',
              )}
            >
              {/* Floating top bar */}
              {renderFloatingTopBar(true)}
              {/* Outside the top bar: that bar fades out on mouse-leave, and the
                  find bar has to stay put while the user reads results. */}
              <FileSearchControls />
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

/**
 * The provider wraps the modal rather than living inside it so the modal itself
 * can read search state — `onEscapeKeyDown` on Dialog.Content needs to know
 * whether the find bar is open.
 */
export const FilePreviewModal: React.FC<FilePreviewModalProps> = props => {
  const { files, currentIndex = 0, fileUrl, isOpen } = props;
  // Reset the search when the visible file changes (carousel navigation) or the
  // modal is reopened — a stale query and match count would otherwise carry over
  // to a completely different file.
  const activeFileKey = files?.[currentIndex]?.fileUrl ?? fileUrl;
  const resetKey = `${isOpen ? 'open' : 'closed'}|${currentIndex}|${activeFileKey}`;

  return (
    <FileSearchProvider resetKey={resetKey}>
      <FilePreviewModalInner {...props} />
    </FileSearchProvider>
  );
};

// Global modal instance - connected to attachment viewer machine
const AttachmentGalleryModalInner: React.FC = () => {
  const state = useSelector(attachmentViewerActor, (s: AttachmentViewerState) => s);
  const context = state.context;
  const location = useLocation();
  const search = useFileSearchContext();

  const isOpen = state.value !== 'closed';
  const currentAttachment = context.attachments[context.currentIndex];

  const machineFileData = context.fileData;
  const status = context.status;
  const machineError = context.error;
  const attachments = context.attachments;
  const currentIndex = context.currentIndex;

  const { isMobile } = usePlatform();
  const [isHovered, setIsHovered] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [mountedSlides, setMountedSlides] = useState<Set<number>>(() => new Set());
  const isProgrammaticScrollRef = useRef(false);
  const touchStartRef = useRef<{ x: number; y: number; scrollLeft: number } | null>(null);
  const touchMoveRef = useRef<{ x: number; y: number } | null>(null);
  const processedThreadIdRef = useRef<string | null>(null);
  const initialPathRef = useRef<string | null>(null);
  const prevIsOpenRef = useRef(false);
  // Track zoom state for conditional carousel swipe in AttachmentGalleryModal
  const activeSlideZoomStateRef = useRef<ZoomState>({
    scale: 1,
    isAtLeftEdge: true,
    isAtRightEdge: true,
  });
  // True once Zero has delivered complete thread data and UPDATE has been sent to the machine.
  // Used to hold renderContent() in a loading state until the full carousel is ready.
  const [threadDataLoaded, setThreadDataLoaded] = useState(false);

  // Capture path synchronously during render when modal opens
  if (isOpen && !prevIsOpenRef.current) {
    initialPathRef.current = location.pathname + location.hash;
  }
  prevIsOpenRef.current = isOpen;

  const hasStackNavigation = attachments.length > 1;
  const totalFiles = attachments.length;
  const currentFileIndex = currentIndex;

  // Callback ref to handle initial scroll when modal opens
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

  // Determine if thread panel should show
  const showThreadPanel =
    !isMobile &&
    currentAttachment?.conversationId &&
    currentAttachment?.channelId &&
    (currentAttachment?.replyCount ?? 0) > 0;

  const threadChannelId = currentAttachment?.channelId ?? '';
  const participationStatus = useGetChannelUserStatus(threadChannelId);
  const isMember = !!participationStatus;

  const shouldQueryThread =
    !!currentAttachment?.conversationId &&
    !!currentAttachment?.channelId &&
    (currentAttachment.replyCount ?? 0) > 0;

  const threadConversationQuery = useMemo(
    () =>
      queries.threadConversationV2({
        conversationId: currentAttachment?.conversationId ?? ' ',
        ...(threadChannelId ? { channelId: threadChannelId, isMember } : {}),
      }),
    [currentAttachment?.conversationId, threadChannelId, isMember],
  );
  const [threadConversation] = useCachedQuery(threadConversationQuery, {
    enabled: shouldQueryThread,
  });
  // threadConversation is a conversation object (`.one()`); extract its messages array.
  // Row shape == conversationMessagesV2 rows (same messageTable + attachments relation),
  // so this satisfies the ThreadList/ThreadMessages expected prop type via the cast.
  const threadMessages = useMemo(
    () =>
      threadConversation?.messages
        ? ([...threadConversation.messages] as QueryResultType<
            typeof queries.conversationMessagesV2
          >)
        : undefined,
    [threadConversation?.messages],
  );

  // Reset refs and thread-ready gate when modal closes
  useEffect(() => {
    if (!isOpen) {
      processedThreadIdRef.current = null;
      initialPathRef.current = null;
      prevIsOpenRef.current = false;
      setThreadDataLoaded(false);
    }
  }, [isOpen]);

  // Close modal on route change (including hash changes for canvas overlay navigation)
  useEffect(() => {
    if (!isOpen) return;

    const currentPath = location.pathname + location.hash;
    if (initialPathRef.current !== null && currentPath !== initialPathRef.current) {
      attachmentViewerActor.send({ type: 'CLOSE' });
    }
  }, [location.pathname, location.hash, isOpen]);

  // Update machine with full thread attachments when loaded
  useEffect(() => {
    if (!threadMessages || !shouldQueryThread || !currentAttachment) return;

    // Prevent duplicate updates - check if we already processed this conversation
    const threadId = currentAttachment.conversationId;
    if (processedThreadIdRef.current === threadId) return;

    // Compute all attachments from thread messages
    const allAttachments: AttachmentRef[] = threadMessages.flatMap(msg => {
      if (!msg.hasAttachment || !msg.attachments?.length) return [];

      const ordered = [...msg.attachments].sort(
        (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
      );

      return ordered.map(att => {
        const ref: AttachmentRef = {
          attachmentId: att.id,
          fileName: att.originalFilename,
          fileUrl: `/attachments/${att.id}/download`,
          mimeType: att.mimetype,
          fileSize: att.size,
          thumbnailUrl: att.thumbnailUrl,
          conversationId: msg.conversationId,
        };
        if (currentAttachment.channelId) ref.channelId = currentAttachment.channelId;
        if (currentAttachment.replyCount !== undefined)
          ref.replyCount = currentAttachment.replyCount;
        // Preserve initialTime for the originally clicked attachment
        if (
          att.id === currentAttachment.attachmentId &&
          currentAttachment.initialTime !== undefined
        ) {
          ref.initialTime = currentAttachment.initialTime;
        }
        return ref;
      });
    });

    // Guard: Zero is still syncing — no attachment messages loaded yet.
    // Don't send UPDATE and don't lock the ref so the next Zero update can retry.
    if (allAttachments.length === 0) return;

    // Find the index of the originally clicked attachment
    const startIndex = allAttachments.findIndex(
      att => att.attachmentId === currentAttachment.attachmentId,
    );

    // Guard: our specific attachment isn't in the thread data yet.
    // Zero may still be syncing older messages — wait for more data.
    if (startIndex === -1) return;

    // Lock the ref only after we have valid data so that partial Zero syncs
    // don't permanently block future retries.
    processedThreadIdRef.current = threadId ?? null;

    // Mark thread data as ready — renderContent() will stop showing the loading gate
    // and render the full carousel on the next React render cycle.
    setThreadDataLoaded(true);

    // Update machine with full thread attachments
    attachmentViewerActor.send({
      type: 'UPDATE',
      attachments: allAttachments,
      startIndex,
    });
  }, [
    threadMessages,
    shouldQueryThread,
    currentAttachment?.conversationId,
    currentAttachment?.channelId,
    currentAttachment?.replyCount,
    currentAttachment?.attachmentId,
  ]);

  // Convert attachments to FileItems for carousel
  const files: FileItem[] = useMemo(
    () =>
      attachments.map(att => ({
        fileName: att.fileName,
        fileUrl: att.fileUrl,
        mimeType: att.mimeType,
        fileSize: att.fileSize,
        attachmentId: att.attachmentId,
      })),
    [attachments],
  );

  // Get current file info
  const currentFile = hasStackNavigation ? files[currentFileIndex] : null;
  const currentFileName = currentFile?.fileName ?? currentAttachment?.fileName ?? '';
  const currentMimeType = currentFile?.mimeType ?? currentAttachment?.mimeType ?? '';
  const currentFileSize = currentFile?.fileSize ?? currentAttachment?.fileSize ?? 0;
  const currentAttachmentId = currentFile?.attachmentId ?? currentAttachment?.attachmentId;
  const initialTime = currentAttachment?.initialTime;
  const shouldAutoPlayVideo = currentAttachment?.autoPlay ?? false;

  const fileType = detectFileType(currentMimeType, currentFileName);
  const isVideo = fileType?.displayName === 'Video';
  const isImage = fileType?.displayName === 'Image';
  const isPdf = fileType?.displayName === 'PDF Document';

  // Track mounted slides
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

  // Navigation handlers
  const handlePrevious = useCallback(() => {
    if (!hasStackNavigation || currentFileIndex <= 0) return;
    isProgrammaticScrollRef.current = true;
    attachmentViewerActor.send({ type: 'PREV' });
  }, [hasStackNavigation, currentFileIndex]);

  const handleNext = useCallback(() => {
    if (!hasStackNavigation || currentFileIndex >= totalFiles - 1) return;
    isProgrammaticScrollRef.current = true;
    attachmentViewerActor.send({ type: 'NEXT' });
  }, [hasStackNavigation, currentFileIndex, totalFiles]);

  // Keyboard shortcuts
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

  // Scroll to current index
  useEffect(() => {
    if (scrollContainerRef.current && hasStackNavigation) {
      scrollContainerRef.current.scrollTo({
        left: currentFileIndex * scrollContainerRef.current.clientWidth,
        behavior: 'smooth',
      });
      // Reset flag after scroll animation (300ms is typical smooth scroll duration)
      setTimeout(() => {
        isProgrammaticScrollRef.current = false;
      }, 300);
    }
  }, [currentFileIndex, hasStackNavigation]);

  // Handle download
  const handleDownload = async (): Promise<void> => {
    if (currentAttachmentId) {
      await downloadAttachment(currentAttachmentId, currentFileName);
    }
  };

  // Render content for current file
  const renderContent = (): JSX.Element => {
    // Videos stream via the /stream endpoint and never need a downloaded File blob.
    // Render the VideoViewer immediately — before any machine-state loading checks —
    // so we don't block on `waitingForData` or `loading` while the machine resolves
    // the short-circuit null return for video mime types.
    if (isVideo && fileType) {
      if (currentAttachmentId) {
        const ViewerComponent = fileType.component;
        return (
          <div className={fileType.wrapperClass}>
            <ViewerComponent
              source={null}
              fileName={currentFileName}
              attachmentId={currentAttachmentId}
              onExpand={() => attachmentViewerActor.send({ type: 'CLOSE' })}
              autoPlay={shouldAutoPlayVideo}
              {...(initialTime !== undefined && { initialTime })}
            />
          </div>
        );
      }
      // Video present but no attachmentId to stream with
      return (
        <div className='flex flex-col items-center justify-center h-full gap-3'>
          <p className='text-gray-400'>Video cannot be streamed</p>
          <button
            onClick={() => void handleDownload()}
            data-track-category='FILE_VIEWER'
            data-track-name='DownloadVideo'
            className='px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-2'
          >
            <Download className='h-4 w-4' />
            Download Video
          </button>
        </div>
      );
    }

    if (status === 'loading') {
      return <LoadingState message={'Loading preview...'} />;
    }

    if (status === 'error' && machineError) {
      return (
        <ErrorState
          error={machineError}
          onRetry={() => attachmentViewerActor.send({ type: 'RETRY' })}
          onDownload={() => void handleDownload()}
        />
      );
    }

    if (!fileType) {
      return <UnsupportedFileState onDownload={() => void handleDownload()} />;
    }

    if (!machineFileData) {
      return <LoadingState message='Loading file data...' />;
    }

    const ViewerComponent = fileType.component;
    const initialPage: number | undefined = currentAttachment?.initialPage;
    return (
      <div className={`${fileType.wrapperClass} max-w-full max-h-full`}>
        <ViewerComponent
          source={machineFileData}
          fileName={currentFileName}
          {...(initialPage !== undefined && { initialPage })}
        />
      </div>
    );
  };

  // Background image for images
  const backgroundImageUrl = useMemo(() => {
    if (isImage && machineFileData) {
      return URL.createObjectURL(machineFileData);
    }
    return null;
  }, [isImage, machineFileData]);

  // Cleanup background URL
  useEffect(() => {
    return () => {
      if (backgroundImageUrl) {
        URL.revokeObjectURL(backgroundImageUrl);
      }
    };
  }, [backgroundImageUrl]);

  // Carousel scroll handler
  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current || !hasStackNavigation || isProgrammaticScrollRef.current)
      return;
    const container = scrollContainerRef.current;
    const slideWidth = container.clientWidth;
    const newIndex = Math.round(container.scrollLeft / slideWidth);
    if (newIndex !== currentFileIndex && newIndex >= 0 && newIndex < totalFiles) {
      if (newIndex > currentFileIndex) attachmentViewerActor.send({ type: 'NEXT' });
      else attachmentViewerActor.send({ type: 'PREV' });
    }
  }, [hasStackNavigation, currentFileIndex, totalFiles]);

  // Render carousel
  const disableCarouselGestures = Boolean(isMobile && hasStackNavigation);

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!isMobile || !hasStackNavigation) return;
    const touch = e.touches[0];
    if (!touch) return;
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      scrollLeft: scrollContainerRef.current?.scrollLeft ?? 0,
    };
    touchMoveRef.current = null;
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!isMobile || !hasStackNavigation) return;
    const touch = e.touches[0];
    if (!touch) return;
    touchMoveRef.current = { x: touch.clientX, y: touch.clientY };

    // Allow vertical scrolling - don't block if vertical movement dominates
    const start = touchStartRef.current;
    if (start) {
      const dx = Math.abs(touch.clientX - start.x);
      const dy = Math.abs(touch.clientY - start.y);
      // If vertical movement is greater than horizontal, allow default scroll
      if (dy > dx) {
        return;
      }
    }
  };

  const handleTouchEnd = () => {
    if (!isMobile || !hasStackNavigation) return;
    const start = touchStartRef.current;
    const end = touchMoveRef.current;
    touchStartRef.current = null;
    touchMoveRef.current = null;
    if (!start || !end) return;

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const scrollDelta = Math.abs((scrollContainerRef.current?.scrollLeft ?? 0) - start.scrollLeft);

    if (scrollDelta > 4) return;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return;

    // Check zoom state for conditional navigation
    const zoomState = activeSlideZoomStateRef.current;
    if (zoomState.scale > 1) {
      // User is zoomed in - only navigate if swiping from edge toward opposite direction
      if (dx < 0) {
        // Swiping left (want next slide) - only allow if at right edge
        if (!zoomState.isAtRightEdge) return;
      } else {
        // Swiping right (want previous slide) - only allow if at left edge
        if (!zoomState.isAtLeftEdge) return;
      }
    }

    if (dx < 0) {
      handleNext();
    } else {
      handlePrevious();
    }
  };

  const renderCarousel = () => {
    return (
      <div
        ref={scrollContainerCallbackRef}
        onScroll={handleScroll}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className='flex w-full h-full overflow-x-auto overflow-y-hidden'
        style={{
          scrollSnapType: 'x mandatory',
          scrollbarWidth: 'none',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {files.map((file, index) => (
          <div
            key={file.attachmentId || file.fileUrl}
            className='flex-shrink-0 w-full h-full flex items-center justify-center'
            style={{ scrollSnapAlign: 'center' }}
          >
            {mountedSlides.has(index) ? (
              <SlideContent
                file={file}
                isActive={index === currentFileIndex}
                {...(disableCarouselGestures && { disableGestures: true })}
                // Pass initialTime to active video
                initialTime={initialTime}
                autoPlay={index === currentFileIndex && shouldAutoPlayVideo}
                {...(index === currentFileIndex && {
                  onInteractionStateChange: (state: ZoomState) => {
                    activeSlideZoomStateRef.current = state;
                  },
                })}
              />
            ) : (
              <SlidePlaceholder file={file} />
            )}
          </div>
        ))}
      </div>
    );
  };

  const { copyImage: copyImageGallery } = useClipboard();
  const [copiedGallery, setCopiedGallery] = useState(false);

  const handleCopyImageGallery = async (): Promise<void> => {
    if (!machineFileData || !isImage) return;
    await copyImageGallery(machineFileData);
    setCopiedGallery(true);
    window.setTimeout(() => setCopiedGallery(false), 1200);
  };

  // Floating top bar
  const renderFloatingTopBar = (includeCloseButton: boolean): JSX.Element => (
    <div
      className={`absolute gap-6 p-5 top-0 left-0 z-20 flex transition-opacity duration-300 ${
        isHovered ? 'opacity-100' : 'opacity-0'
      } w-full`}
    >
      <div className='absolute inset-0 bg-gradient-to-b from-black/60 to-transparent w-full' />
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
          {isImage && (
            <button
              onClick={() => void handleCopyImageGallery()}
              data-track-category='FILE_VIEWER'
              data-track-name='CopyImageGallery'
              title='Copy Image'
              className='inline-flex items-center gap-2 justify-center w-9 h-9 text-sm font-medium text-white/90 hover:text-white hover:bg-white/10 rounded-md transition-colors'
            >
              {copiedGallery ? (
                <CopyCopied className='h-4 w-4' />
              ) : (
                <CopyDefault className='h-4 w-4' />
              )}
            </button>
          )}
          <button
            onClick={() => void handleDownload()}
            data-track-category='FILE_VIEWER'
            data-track-name='DownloadFile'
            className='inline-flex items-center gap-2 justify-center w-9 h-9 text-sm font-medium text-white/90 hover:text-white hover:bg-white/10 rounded-md transition-colors'
          >
            <Download className='h-4 w-4' />
          </button>
          {includeCloseButton && (
            <Dialog.Close asChild>
              <button
                onClick={() => attachmentViewerActor.send({ type: 'CLOSE' })}
                data-track-category='FILE_VIEWER'
                data-track-name='Close'
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

  // Navigation arrows
  const renderNavigationArrows = (): JSX.Element | null => {
    if (!hasStackNavigation) return null;
    const canGoPrevious = currentFileIndex > 0;
    const canGoNext = currentFileIndex < totalFiles - 1;

    return (
      <>
        {canGoPrevious && (
          <button
            onClick={handlePrevious}
            data-track-category='FILE_VIEWER'
            data-track-name='NavigatePrevious'
            className={cn(
              'absolute left-4 top-1/2 -translate-y-1/2 z-50 rounded-full p-3 bg-black/10 hover:bg-black/20 text-white transition-all duration-200',
              isMobile ? 'opacity-100' : isHovered ? 'opacity-100' : 'opacity-0',
            )}
            aria-label='Previous file'
            title='Previous (←)'
            type='button'
          >
            <ChevronLeft className='h-6 w-6' />
          </button>
        )}
        {canGoNext && (
          <button
            onClick={handleNext}
            data-track-category='FILE_VIEWER'
            data-track-name='NavigateNext'
            className={cn(
              'absolute right-4 top-1/2 -translate-y-1/2 z-50 rounded-full p-3 bg-black/10 hover:bg-black/20 text-white transition-all duration-200',
              isMobile ? 'opacity-100' : isHovered ? 'opacity-100' : 'opacity-0',
            )}
            aria-label='Next file'
            title='Next (→)'
            type='button'
          >
            <ChevronRight className='h-6 w-6' />
          </button>
        )}
      </>
    );
  };

  const renderMainContent = () => (hasStackNavigation ? renderCarousel() : renderContent());

  // Synthetic message bubble for showing parent message while thread loads
  const renderSyntheticMessageBubble = (): JSX.Element | null => {
    const parentMessage = currentAttachment?.parentMessage;
    if (!parentMessage) return null;

    // Convert parent message to the format expected by ChatBubble
    const message = {
      ...parentMessage,
      msgType: parentMessage.msgType,
      // Ensure required fields are present
      isSent: true,
      showInChannel: false,
      childConversationId: null,
      visibleTo: null,
      nudgeCount: 0,
      link_preview_md: null,
      hasAttachment: parentMessage.hasAttachment ?? false,
      edited: parentMessage.edited ?? false,
      isDeleted: parentMessage.isDeleted ?? false,
      // Cast metadata to satisfy ReadonlyJSONValue type
      metadata: parentMessage.metadata ?? null,
    };

    return (
      <div className='flex-1 overflow-auto py-4'>
        <ChatBubble
          message={message as unknown as Parameters<typeof ChatBubble>[0]['message']}
          channelId={currentAttachment?.channelId || ''}
          showAvatar={true}
          context='thread'
          isFirstInThread={true}
          isTicketThread={false}
          disableAskAI={true}
        />
      </div>
    );
  };

  // Render thread panel content
  const renderThreadPanel = (): JSX.Element => {
    const hasParentMessage = !!currentAttachment?.parentMessage;
    const isLoadingThread =
      (shouldQueryThread && !threadDataLoaded) || state.value === 'waitingForData';

    // While loading: a synthetic parent-message bubble if we have one, else a spinner.
    const loading = isLoadingThread ? (
      hasParentMessage ? (
        renderSyntheticMessageBubble()
      ) : (
        <div className='flex-1 flex items-center justify-center'>
          <div className='flex flex-col items-center gap-3'>
            <div className='animate-spin rounded-full h-6 w-6 border-b-2 border-primary'></div>
            <div className='text-muted-foreground text-sm'>Loading thread...</div>
          </div>
        </div>
      )
    ) : null;

    return (
      <PreviewThreadPanel
        onClose={() => attachmentViewerActor.send({ type: 'CLOSE' })}
        {...(currentAttachment?.channelId ? { channelId: currentAttachment.channelId } : {})}
        {...(currentAttachment?.conversationId
          ? { conversationId: currentAttachment.conversationId }
          : {})}
        {...(threadMessages && threadMessages.length > 0 ? { threadMessages } : {})}
        {...(loading ? { loading } : {})}
      />
    );
  };

  // The attachment itself — the left/main panel. Identical whether or not the
  // thread panel is shown; the floating bar only carries the close button when
  // there is no thread panel to carry it (full-view mode).
  const attachmentPanel = (
    <div
      className={cn(
        'h-full w-full relative',
        isImage
          ? 'overflow-hidden before:absolute before:inset-0 before:bg-black/80 before:z-0 before:backdrop-blur-md bg-black/30'
          : isPdf
            ? 'bg-background'
            : isVideo
              ? 'overflow-hidden bg-black'
              : 'overflow-auto bg-background',
      )}
    >
      {renderFloatingTopBar(!showThreadPanel)}
      <FileSearchControls />
      <div
        className={cn(
          'relative z-10 h-full w-full flex',
          isPdf ? '' : 'items-center justify-center',
        )}
      >
        {renderMainContent()}
      </div>
      {renderNavigationArrows()}
    </div>
  );

  // Shared preview shell (also used by the plan preview). It owns the dialog,
  // the resize group, and the resize-aware dismiss guard; we just hand it the
  // attachment as the main panel and the thread as the (optional) side panel.
  return (
    <PreviewSplitDialog
      open={isOpen}
      onClose={() => attachmentViewerActor.send({ type: 'CLOSE' })}
      idPrefix='attachment-viewer'
      isMobile={isMobile}
      left={attachmentPanel}
      right={showThreadPanel ? renderThreadPanel() : undefined}
      preventDrawer
      overlayClassName='flex items-center justify-center bg-black/80'
      contentClassName='bg-black data-[state=closed]:fade-out transition-all ease-in-out duration-300 data-[state=open]:fade-in'
      contentStyle={{
        backgroundImage: backgroundImageUrl ? `url(${backgroundImageUrl})` : undefined,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }}
      bodyClassName={isVideo ? 'bg-black' : 'bg-background'}
      onEscapeKeyDown={event => {
        // Escape closes the find bar first; only a second Escape closes the whole
        // gallery. Radix would otherwise dismiss the dialog outright.
        if (search?.isOpen) {
          event.preventDefault();
          search.close();
        }
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onTouchStart={e => e.stopPropagation()}
    />
  );
};

export const AttachmentGalleryModal: React.FC = () => {
  const currentIndex = useSelector(
    attachmentViewerActor,
    (s: AttachmentViewerState) => s.context.currentIndex,
  );
  const attachmentId = useSelector(
    attachmentViewerActor,
    (s: AttachmentViewerState) => s.context.attachments[s.context.currentIndex]?.attachmentId,
  );
  const isOpen = useSelector(
    attachmentViewerActor,
    (s: AttachmentViewerState) => s.value !== 'closed',
  );

  return (
    <FileSearchProvider
      resetKey={`${isOpen ? 'open' : 'closed'}|${currentIndex}|${attachmentId ?? ''}`}
    >
      <AttachmentGalleryModalInner />
    </FileSearchProvider>
  );
};

export default FilePreviewModal;
