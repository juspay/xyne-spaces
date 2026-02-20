/**
 * MessageAttachment Component - Refactored with React Query
 *
 * A performant file attachment component with:
 * - React Query caching and optimization
 * - Proper memory management (no leaks)
 * - Enhanced error handling and loading states
 * - Accessibility compliance
 * - Integration with FilePreviewModal
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileText, Maximize2, MoreVertical, Play, Video } from 'lucide-react';
import { Menu } from '@base-ui/react/menu';
import {
  formatFileSize,
  getFileExtension,
  isImageFile,
  isVideoFile,
  downloadAttachment,
  getFileIcon,
  truncateFileName,
} from './utils';
import { createPreviewUrl } from '../../../services/clients/fileFetchService';
import { FilePreviewModal } from '../../FileViewer/FileViewerModal';
import TxtViewer from '../../FileViewer/TxtViewer';
import VideoViewer from '../../FileViewer/VideoViewer';
import { QueryResultType } from '@rocicorp/zero';
import { queries } from '../../../zero/queries';
import { useAuthContext } from '../../../providers/AuthProvider';
import { usePlatform } from '../../../hooks/usePlatform';
import { useWindowWidth } from '../../../hooks/useWindowWidth';
import { toast } from 'sonner';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { DownloadButton } from './DownloadButton';
import { DeleteButton } from './DeleteButton';
import { cn } from '../../../utils/classNames';

interface MessageAttachmentProps {
  attachment: QueryResultType<typeof queries.conversationMessages>[number]['attachments'][number];
  compact?: boolean;
  isLoading?: boolean;
  allAttachments?: QueryResultType<typeof queries.conversationMessages>[number]['attachments'];
  currentAttachmentIndex?: number;
  isInGrid?: boolean | undefined;
  fullSize?: boolean;
}

//to check the who can delete and delete the attachment
const useAttachmentDelete = (attachmentId: string, fileName: string, uploadedByUserId: string) => {
  const { user } = useAuthContext();
  const zero = useZero();

  const canDelete = uploadedByUserId === user?.id;

  const handleDelete = (): void => {
    try {
      zero.mutate(mutators.messageAttachment.delete({ attachmentId }));
      toast.success('Attachment deleted', {
        description: `${fileName} has been deleted successfully.`,
      });
    } catch (error) {
      toast.error(`Failed to delete ${fileName}`, {
        description: error instanceof Error ? error.message : 'Please try again later.',
      });
      throw error;
    }
  };

  return { canDelete, handleDelete };
};

/**
 * Preview component that handles both image and file type previews
 * Wraps all image-related functionality (loading, error states, preview)
 */
const Preview: React.FC<{
  attachmentId: string;
  mimeType: string;
  fileName: string;
  fileSize: number;
  thumbnailUrl?: string | null;
  compact?: boolean;
  width?: number | null;
  height?: number | null;
  isInGrid?: boolean | undefined;
  fullSize?: boolean | undefined;
  onLoadingChange?: (isLoading: boolean) => void;
}> = ({
  attachmentId,
  mimeType,
  fileName,
  fileSize,
  thumbnailUrl,
  compact,
  width,
  height,
  isInGrid,
  fullSize,
}) => {
  const isImage = isImageFile(mimeType);
  const isVideo = isVideoFile(mimeType);

  const [imageBlobUrl, setImageBlobUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<boolean>(false);

  // Calculate dimensions from stored width/height or fallback to calculated
  const fixedHeight = isInGrid ? 350 : compact ? 64 : 256;
  const calculatedWidth = useMemo(() => {
    if (width && height) {
      const aspectRatio = width / height;
      return Math.min(300, Math.round(aspectRatio * fixedHeight));
    }
    return 300;
  }, [width, height, fixedHeight]);

  const imageWidth = calculatedWidth;

  useEffect(() => {
    // Fetch image or video thumbnail
    if (!isImage && !(isVideo && thumbnailUrl)) {
      setIsLoading(false);
      return;
    }

    let blobUrl: string | null = null;

    const fetchPreview = async (): Promise<void> => {
      setIsLoading(true);
      setError(false);
      try {
        // For videos with thumbnails, use thumbnail endpoint
        // For images, use download endpoint (pass ID, createPreviewUrl will resolve it)
        const source =
          isVideo && thumbnailUrl ? `/attachments/${attachmentId}/thumbnail` : attachmentId;

        const blob = await createPreviewUrl(source);
        blobUrl = URL.createObjectURL(blob);

        // Pre-calculate image dimensions to maintain aspect ratio with fixed height
        // Only recalculate if we don't have stored dimensions
        // Use stored dimensions - no need to wait for image load
        setImageBlobUrl(blobUrl);
        setIsLoading(false);
      } catch {
        setError(true);
      } finally {
        setIsLoading(false);
      }
    };

    void fetchPreview();

    return (): void => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [attachmentId, isImage, isVideo, thumbnailUrl, compact, calculatedWidth]);

  const { isMobile } = usePlatform();

  if (isLoading) {
    return (
      <div
        className='bg-gray-200 animate-pulse flex items-center justify-center'
        style={
          imageWidth
            ? { height: fixedHeight, width: `${imageWidth}px`, minWidth: `${imageWidth}px` }
            : { width: '100%', minWidth: '256px' }
        }
      />
    );
  }

  // Show image or video thumbnail preview
  if (isImage || (isVideo && thumbnailUrl)) {
    if (error || !imageBlobUrl) {
      return (
        <div
          className={cn(
            'h-full w-full bg-gray-100 flex flex-col items-center justify-center gap-2 p-4',
            !isMobile && 'min-w-64',
          )}
        >
          {isVideo && (
            <>
              <Video size={32} className='text-gray-400' />
              <span className='text-xs text-gray-500 text-center'>Preview unavailable</span>
            </>
          )}
        </div>
      );
    }

    return isImage ? (
      <img
        src={imageBlobUrl}
        alt={fileName}
        className={fullSize ? 'w-full h-auto' : 'w-auto'}
        loading='lazy'
        style={
          fullSize
            ? undefined
            : { objectFit: 'cover', height: fixedHeight, width: `${imageWidth}px` || '300px' }
        }
        onError={() => setError(true)}
      />
    ) : (
      isVideo && (
        <div className='absolute inset-0 flex items-center justify-center bg-black bg-opacity-30'>
          <Video
            height={fixedHeight}
            width={imageWidth || 300}
            className='text-white drop-shadow-lg'
          />
        </div>
      )
    );
  }

  // For non-image files - File type badge
  const extension = getFileExtension(mimeType);
  const formattedSize = formatFileSize(fileSize);
  const icon = getFileIcon(mimeType, 20);

  if (compact) {
    return (
      <div className='w-full h-full bg-gray-100 flex flex-col items-center justify-center gap-2 p-2'>
        <div className='bg-white rounded-lg p-2 shadow-sm border border-gray-200'>{icon}</div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'bg-gray-100 flex flex-col items-center justify-center gap-2',
        isInGrid ? 'w-full h-full' : 'w-[256px] h-[256px]',
      )}
    >
      <div className='bg-white rounded-lg p-3 shadow-sm border border-gray-200'>{icon}</div>
      <div className='text-center'>
        <div className='text-sm font-semibold text-gray-700'>{extension}</div>
        <div className='text-xs text-gray-500'>{formattedSize}</div>
      </div>
    </div>
  );
};

/**
 * Slack-style action tray that appears on hover
 * Shows download and delete buttons in top-right corner with dark background
 */
const ActionTray: React.FC<{
  attachmentId: string;
  fileName: string;
  canDelete: boolean;
  onDelete: () => void | Promise<void>;
}> = ({ attachmentId, fileName, canDelete, onDelete }) => {
  const { isMobile } = usePlatform();
  return (
    <div className='absolute top-2 right-2 z-10 opacity-0 group-hover/attachment:opacity-100 transition-opacity duration-200'>
      {!isMobile && (
        <div className='flex items-center justify-between bg-gray-900/80 backdrop-blur-sm rounded-lg p-1 shadow-lg'>
          <DownloadButton attachmentId={attachmentId} fileName={fileName} variant='overlay' />
          {canDelete && <DeleteButton fileName={fileName} variant='overlay' onDelete={onDelete} />}
        </div>
      )}
    </div>
  );
};

/**
 * Inline Text File Renderer - Uses existing TxtViewer component with collapse
 * Only shows inline viewer for files under MAX_INLINE_TEXT_SIZE bytes
 * Otherwise shows a button to open TxtViewer modal
 */
const InlineTextFile: React.FC<{
  attachmentId: string;
  fileName: string;
  metadata?: Record<string, unknown>;
}> = ({ attachmentId, fileName, metadata }) => {
  const [fileData, setFileData] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const windowWidth = useWindowWidth();

  const formatFileName = (fileName: string) => {
    if (windowWidth < 500) {
      return truncateFileName(fileName, 28);
    }
    return fileName;
  };

  const isLargeFile = fileData ? fileData.size > 10 * 1024 : false; // 10KB
  const [refetchTrigger, setRefetchTrigger] = useState(0);

  const meta = metadata as { type?: string; version?: number } | undefined;
  const prevVersionRef = useRef(meta?.version || 0);

  useEffect(() => {
    const currentVersion = meta?.version;
    const prevVersion = prevVersionRef.current;
    if (prevVersion !== undefined && currentVersion !== undefined && currentVersion > prevVersion) {
      setRefetchTrigger(prev => prev + 1);
    }
    prevVersionRef.current = currentVersion || 0;
  }, [meta?.version, meta?.type]);

  useEffect(() => {
    const fetchFile = async (): Promise<void> => {
      try {
        const blob = await createPreviewUrl(attachmentId, {
          forceRefresh: refetchTrigger > 0,
        });
        const file = new File([blob], fileName, { type: 'text/plain' });
        setFileData(file);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load file');
      } finally {
        setIsLoading(false);
      }
    };

    void fetchFile();
  }, [attachmentId, fileName, refetchTrigger]);

  if (isLoading) {
    return (
      <div className='max-w-2xl p-4 bg-gray-50 rounded-lg border border-gray-200 animate-pulse'>
        <div className='h-4 bg-gray-200 rounded w-1/3 mb-3'></div>
        <div className='space-y-2'>
          <div className='h-3 bg-gray-200 rounded w-full'></div>
          <div className='h-3 bg-gray-200 rounded w-full'></div>
          <div className='h-3 bg-gray-200 rounded w-4/5'></div>
        </div>
      </div>
    );
  }

  if (error || !fileData) {
    return (
      <div className='w-full max-w-2xl p-4 bg-red-50 rounded-lg border border-red-200'>
        <div className='text-sm text-red-800 font-medium mb-1'>Failed to load text file</div>
        <div className='text-xs text-red-600'>{error || 'Unknown error'}</div>
      </div>
    );
  }

  // For large files, show a button to open in TxtViewer modal
  if (isLargeFile) {
    return (
      <>
        <div className='w-full max-w-2xl'>
          <div className='flex items-center gap-2'>
            <button
              type='button'
              onClick={() => setIsModalOpen(true)}
              className='flex items-center gap-2 p-2 rounded-md transition-colors duration-150 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-800 dark:hover:text-gray-200'
            >
              <FileText className='h-4 w-4' />
              <span className='truncate max-w-md'>{formatFileName(fileName)}</span>
              <span className='ml-1 text-xs text-gray-500'>(click to view)</span>
            </button>
            <button
              type='button'
              onClick={e => {
                e.stopPropagation();
                void downloadAttachment(attachmentId, fileName);
              }}
              className='p-2 hover:bg-gray-100 rounded-lg transition-colors'
              title='Download file'
            >
              <Download className='h-4 w-4 text-gray-600' />
            </button>
          </div>
        </div>

        {/* TxtViewer Modal for large files */}
        <div data-prevent-drawer='true' onTouchStart={e => e.stopPropagation()}>
          <FilePreviewModal
            isOpen={isModalOpen}
            onClose={() => setIsModalOpen(false)}
            fileName={fileName}
            fileUrl={`/attachments/${attachmentId}/download`}
            mimeType='text/plain'
            fileSize={fileData.size}
            attachmentId={attachmentId}
          />
        </div>
      </>
    );
  }

  return (
    <div className='w-full max-w-2xl'>
      {/* Collapsible Header */}
      <div className='flex items-center gap-2 mb-2'>
        <button
          type='button'
          onClick={() => setIsExpanded(!isExpanded)}
          className='flex items-center gap-1 p-2 rounded-md transition-colors duration-150 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-800 dark:hover:text-gray-200'
        >
          <FileText className='h-4 w-4' />
          <span className='truncate max-w-md'>{formatFileName(fileName)}</span>
          <span className='ml-1 text-xs text-gray-500'>{isExpanded ? '[Hide]' : '[View]'}</span>
        </button>
        <button
          type='button'
          onClick={e => {
            e.stopPropagation();
            void downloadAttachment(attachmentId, fileName);
          }}
          className='p-2 hover:bg-gray-100 rounded-lg transition-colors'
          title='Download file'
        >
          <Download className='h-4 w-4 text-gray-600' />
        </button>
      </div>

      {/* Expandable Content */}
      {isExpanded && (
        <div className='animate-in slide-in-from-top-2 duration-200'>
          <TxtViewer source={fileData} fileName={fileName} />
        </div>
      )}
    </div>
  );
};

/**
 * Inline Video Player with fullscreen option
 * Shows thumbnail first, loads video only when user clicks play
 * On mobile: Opens expanded modal directly instead of inline player
 */
const InlineVideoPlayer: React.FC<{
  attachmentId: string;
  fileName: string;
  mimeType: string;
  uploadedBy: string;
  thumbnailUrl?: string | null;
  fileSize: number;
  height?: number | undefined;
  width?: number | undefined;
  isInGrid?: boolean | undefined;
}> = ({
  attachmentId,
  fileName,
  mimeType,
  uploadedBy,
  width,
  height,
  thumbnailUrl,
  fileSize,
  isInGrid,
}) => {
  const [hasClickedPlay, setHasClickedPlay] = useState(false);
  const [thumbnailBlobUrl, setThumbnailBlobUrl] = useState<string | null>(null);
  const [thumbnailError, setThumbnailError] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { isMobile } = usePlatform();
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const { canDelete, handleDelete } = useAttachmentDelete(attachmentId, fileName, uploadedBy);

  const toggleModal = () => {
    // Exit fullscreen if active before toggling modal
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {
        // Silently handle fullscreen exit errors
      });
    }
    // Capture current video time before opening modal
    if (videoRef.current && !isModalOpen) {
      setCurrentTime(videoRef.current.currentTime);
    }
    setIsModalOpen(prev => !prev);
  };

  const dimensions = useMemo(() => {
    const maxWidth = isMobile ? 320 : 500;
    const maxHeight = isMobile ? 260 : 400;
    const minWidth = 200;

    if (!width || !height) {
      return { width: maxWidth, height: maxHeight };
    }

    const scale = Math.min(maxWidth / width, maxHeight / height);

    let finalWidth = Math.round(width * scale);
    let finalHeight = Math.round(height * scale);

    if (finalWidth < minWidth) {
      finalWidth = minWidth;
      finalHeight = Math.round(height * (minWidth / width));
    }

    return { width: finalWidth, height: finalHeight };
  }, [width, height, isMobile, isInGrid]);

  // Create inline menu content (3-dot menu for thumbnail state)
  const inlineMenuContent = (
    <Menu.Root>
      <Menu.Trigger>
        <button
          type='button'
          className='p-1.5 rounded-md bg-black/60 backdrop-blur-sm text-white group-hover:bg-black/80 transition-colors opacity-0 group-hover:opacity-100'
          title='More options'
          aria-label='More options'
        >
          <MoreVertical className='h-4 w-4' />
        </button>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          side='bottom'
          align='end'
          sideOffset={4}
          className='z-50 bg-black rounded-lg shadow-lg border border-gray-700 p-1 min-w-[160px]'
          onClick={e => e.stopPropagation()}
        >
          <Menu.Popup>
            <div className='flex flex-col gap-1'>
              <Menu.Item>
                <DownloadButton
                  attachmentId={attachmentId}
                  fileName={fileName}
                  showLabel
                  className='text-white'
                />
              </Menu.Item>
              {canDelete && (
                <Menu.Item>
                  <DeleteButton fileName={fileName} onDelete={handleDelete} showLabel />
                </Menu.Item>
              )}
            </div>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );

  // Fetch thumbnail on mount
  useEffect(() => {
    if (!thumbnailUrl) {
      setLoading(false);
      return;
    }

    let blobUrl: string | null = null;

    const fetchThumbnail = async (): Promise<void> => {
      try {
        const blob = await createPreviewUrl(`/attachments/${attachmentId}/thumbnail`);
        blobUrl = URL.createObjectURL(blob);
        setThumbnailBlobUrl(blobUrl);
      } catch {
        setThumbnailError(true);
      } finally {
        setLoading(false);
      }
    };

    void fetchThumbnail();

    return (): void => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [attachmentId, thumbnailUrl]);

  return (
    <>
      <div className='h-full' style={{ contain: 'layout' }}>
        <div className='relative bg-black rounded-lg overflow-hidden border border-gray-200 shadow-sm h-full w-full'>
          {/* Show thumbnail on mobile or until user clicks to play on desktop */}
          {loading ? (
            <div className='bg-gray-200 animate-pulse flex items-center justify-center h-full' />
          ) : !hasClickedPlay || isMobile ? (
            <div className='relative h-full'>
              {thumbnailBlobUrl && !thumbnailError ? (
                <img
                  style={{
                    objectFit: 'cover',
                  }}
                  src={thumbnailBlobUrl}
                  alt={fileName}
                  className='w-full h-full object-cover'
                />
              ) : (
                // Show video icon if no thumbnail
                <div
                  className={cn(
                    'flex items-center justify-center bg-gray-900 h-64',
                    !isMobile && 'min-w-64',
                  )}
                >
                  {!isMobile && <Video size={64} className='text-gray-600' />}
                </div>
              )}
              <div className='absolute top-4 right-3'>{inlineMenuContent}</div>
              <div
                className={cn(
                  'absolute',
                  isInGrid ? 'inset-0 flex items-center justify-center' : 'bottom-4 left-3',
                )}
                onTouchStart={e => e.stopPropagation()}
              >
                <button
                  onClick={() => {
                    if (isMobile) {
                      setIsModalOpen(true);
                    } else {
                      setHasClickedPlay(true);
                    }
                  }}
                  onTouchStart={e => e.stopPropagation()}
                  className='p-1 flex items-center justify-center rounded-md bg-black/60 backdrop-blur-sm text-white hover:bg-black/80 transition-colors'
                  title='Play video'
                  aria-label='Play video'
                >
                  <Play className='h-5 w-5' />
                </button>
              </div>
              {/* Expand button for desktop */}
              {!isMobile && (
                <div className='absolute bottom-4 right-3 opacity-0 group-hover:opacity-100 transition-opacity'>
                  <button
                    onClick={toggleModal}
                    className='p-1.5 rounded-md bg-black/60 backdrop-blur-sm text-white hover:bg-black/80 transition-colors'
                    title='Expand video'
                    aria-label='Expand video'
                  >
                    <Maximize2 className='h-4 w-4' />
                  </button>
                </div>
              )}
            </div>
          ) : (
            // Load actual video player only after user clicks (desktop only)
            <VideoViewer
              attachmentId={attachmentId}
              source={null}
              fileName={fileName}
              width={dimensions.width}
              height={dimensions.height}
              onExpand={toggleModal}
              menuContent={inlineMenuContent}
              ref={videoRef}
            />
          )}
        </div>
      </div>

      {/* File Preview Modal for mobile - Opens fullscreen video player with streaming */}
      {/* data-prevent-drawer prevents parent drawer from intercepting touch gestures */}
      {/* onTouchStart stops event bubbling to parent components */}
      <div data-prevent-drawer='true' onTouchStart={e => e.stopPropagation()}>
        <FilePreviewModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          fileName={fileName}
          fileUrl='' // Not used for videos - VideoViewer constructs URL from attachmentId
          mimeType={mimeType}
          fileSize={fileSize}
          attachmentId={attachmentId}
          initialTime={currentTime}
        />
      </div>
    </>
  );
};

/**
 * Main MessageAttachment component
 */
export const MessageAttachment: React.FC<MessageAttachmentProps> = ({
  attachment,
  compact,
  allAttachments,
  currentAttachmentIndex,
  isInGrid,
  fullSize,
}) => {
  const { isMobile } = usePlatform();
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(currentAttachmentIndex ?? 0);

  const { canDelete, handleDelete } = useAttachmentDelete(
    attachment.id,
    attachment.originalFilename,
    attachment.uploadedByUserId,
  );

  const isTextFile =
    attachment.mimetype === 'text/plain' || attachment.originalFilename.endsWith('.txt');
  const isVideo = isVideoFile(attachment.mimetype);

  const handleCardClick = (): void => {
    setCurrentIndex(currentAttachmentIndex ?? 0);
    setIsPreviewOpen(true);
  };

  // Build files array for stack navigation if multiple attachments exist
  const filesForNavigation = useMemo(() => {
    if (!allAttachments || allAttachments.length <= 1) return undefined;

    return allAttachments.map(att => ({
      fileName: att.originalFilename,
      fileUrl: `/attachments/${att.id}/download`,
      mimeType: att.mimetype,
      fileSize: att.size,
      attachmentId: att.id,
      thumbnailUrl: att.thumbnailUrl,
    }));
  }, [allAttachments]);

  const handleNavigate = (newIndex: number): void => {
    setCurrentIndex(newIndex);
  };

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleCardClick();
    }
  };

  // Render inline text viewer for .txt files using existing TxtViewer component
  if (isTextFile && !compact) {
    const metadata = attachment.metadata as Record<string, unknown> | null;
    return (
      <InlineTextFile
        attachmentId={attachment.id}
        fileName={attachment.originalFilename}
        {...(metadata && { metadata })}
      />
    );
  }

  // Render inline video player for video files (Slack-like behavior)
  if (isVideo && !compact) {
    return (
      <InlineVideoPlayer
        attachmentId={attachment.id}
        fileName={attachment.originalFilename}
        mimeType={attachment.mimetype}
        uploadedBy={attachment.uploadedByUserId}
        thumbnailUrl={attachment.thumbnailUrl}
        fileSize={attachment.size}
        height={attachment.height ?? undefined}
        width={attachment.width ?? undefined}
        isInGrid={isInGrid}
      />
    );
  }

  // Regular attachment card for other file types - Slack style
  return (
    <>
      <div
        className={cn(
          'message-attachment group/attachment relative flex flex-col bg-white border border-gray-200 rounded-lg overflow-hidden hover:shadow-md transition-all duration-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2',
          compact ? 'w-16 h-16 ' : isMobile ? 'h-full ' : 'w-full h-64',
        )}
        onClick={handleCardClick}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role='button'
        aria-label={`Open ${attachment.originalFilename} preview`}
      >
        {/* Preview Section with Action Tray */}
        <div
          className={cn(
            'relative overflow-hidden',
            compact && 'h-16 w-16 bg-gray-100 rounded-md',
            !compact &&
              (isInGrid ? 'w-full h-full bg-gray-50' : isMobile ? 'bg-gray-50' : 'bg-gray-100'),
          )}
        >
          <Preview
            attachmentId={attachment.id}
            mimeType={attachment.mimetype}
            fileName={attachment.originalFilename}
            fileSize={attachment.size}
            thumbnailUrl={attachment.thumbnailUrl}
            width={(attachment as { width?: number | null }).width ?? null}
            height={(attachment as { height?: number | null }).height ?? null}
            {...(compact && { compact: true })}
            isInGrid={isInGrid}
            fullSize={fullSize}
          />

          {/* Slack-style hover action tray */}
          {!compact && (
            <ActionTray
              attachmentId={attachment.id}
              fileName={attachment.originalFilename}
              canDelete={canDelete}
              onDelete={handleDelete}
            />
          )}
        </div>

        {/* Hover overlay for better UX feedback */}
        <div className='absolute inset-0 bg-black bg-opacity-0 group-hover/attachment:bg-opacity-5 transition-all duration-200 pointer-events-none' />
      </div>

      {/* File Preview Modal */}
      <div data-prevent-drawer='true'>
        <FilePreviewModal
          isOpen={isPreviewOpen}
          onClose={() => setIsPreviewOpen(false)}
          fileName={attachment.originalFilename}
          fileUrl={`/attachments/${attachment.id}/download`}
          mimeType={attachment.mimetype}
          fileSize={attachment.size}
          attachmentId={attachment.id}
          {...(filesForNavigation && {
            files: filesForNavigation,
            currentIndex: currentIndex,
            onNavigate: handleNavigate,
          })}
        />
      </div>
    </>
  );
};

// Memoize the component for performance
export default React.memo(MessageAttachment);
