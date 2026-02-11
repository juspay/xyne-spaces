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

import React, { useEffect, useRef, useState } from 'react';
import { Download, FileText, Trash2, Video } from 'lucide-react';
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
import { Modal, ButtonType } from '@juspay/blend-design-system';
import { useZero } from '@rocicorp/zero/react';
import { mutators } from '../../../zero/mutators';

interface MessageAttachmentProps {
  attachment: QueryResultType<typeof queries.conversationMessages>[number]['attachments'][number];
  compact?: boolean;
  isLoading?: boolean;
}

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
  onLoadingChange?: (isLoading: boolean) => void;
}> = ({ attachmentId, mimeType, fileName, fileSize, thumbnailUrl, compact, width, height }) => {
  const isImage = isImageFile(mimeType);
  const isVideo = isVideoFile(mimeType);

  const [imageBlobUrl, setImageBlobUrl] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<boolean>(false);

  // Calculate dimensions from stored width/height or fallback to calculated
  const fixedHeight = compact ? 64 : 256;
  const calculatedWidth = React.useMemo(() => {
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
        <div className='h-full w-full min-w-64 bg-gray-100 flex flex-col items-center justify-center gap-2 p-4'>
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
        className='w-auto'
        loading='lazy'
        style={{ objectFit: 'contain', height: fixedHeight, width: `${imageWidth}px` || '300px' }}
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
    <div className='w-[256px] h-[256px] bg-gray-100 flex flex-col items-center justify-center gap-2'>
      <div className='bg-white  rounded-lg p-3 shadow-sm border border-gray-200'>{icon}</div>
      <div className='text-center'>
        <div className='text-sm font-semibold text-gray-700'>{extension}</div>
        <div className='text-xs text-gray-500'>{formattedSize}</div>
      </div>
    </div>
  );
};

/**
 * Download button with loading and error states
 * Supports overlay variant for dark background
 */
const DownloadButton: React.FC<{
  attachmentId: string;
  fileName: string;
  variant?: 'default' | 'overlay';
}> = ({ attachmentId, fileName, variant = 'default' }) => {
  const [isDownloading, setIsDownloading] = React.useState(false);

  const handleDownload = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation();

    setIsDownloading(true);

    try {
      await downloadAttachment(attachmentId, fileName);
    } catch {
      toast.error(`Failed to download ${fileName}`, {
        description: 'Please try again later.',
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const isOverlay = variant === 'overlay';

  return (
    <button
      type='button'
      onClick={e => void handleDownload(e)}
      disabled={isDownloading}
      className={`p-2 rounded-md transition-colors disabled:opacity-50 ${
        isOverlay
          ? 'hover:bg-white/20 text-white'
          : 'hover:bg-gray-200 text-gray-600 flex-shrink-0 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1'
      }`}
      title={isDownloading ? 'Downloading...' : 'Download file'}
      aria-label={isDownloading ? 'Downloading...' : `Download ${fileName}`}
    >
      <Download size={isOverlay ? 18 : 14} className={isDownloading ? 'animate-pulse' : ''} />
    </button>
  );
};

/**
 * Delete button with loading and error states
 * Supports overlay variant for dark background
 */
const DeleteButton: React.FC<{
  attachmentId: string;
  fileName: string;
  variant?: 'default' | 'overlay';
}> = ({ attachmentId, fileName, variant = 'default' }) => {
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);
  const zero = useZero();

  const handleDelete = (e: React.MouseEvent): void => {
    e.stopPropagation();
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = (): void => {
    setIsDeleting(true);

    try {
      zero.mutate(mutators.messageAttachment.delete({ attachmentId }));
      toast.success('Attachment deleted', {
        description: `${fileName} has been deleted successfully.`,
      });
      setShowDeleteConfirm(false);
    } catch (error) {
      toast.error(`Failed to delete ${fileName}`, {
        description: error instanceof Error ? error.message : 'Please try again later.',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const isOverlay = variant === 'overlay';

  return (
    <>
      <button
        type='button'
        onClick={handleDelete}
        disabled={isDeleting}
        className={`p-2 rounded-md transition-colors ${
          isOverlay
            ? 'hover:bg-white/20 text-white hover:text-red-300'
            : 'flex-shrink-0 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-red-600 dark:hover:text-red-400'
        }`}
        title={isDeleting ? 'Deleting...' : 'Delete file'}
        aria-label={isDeleting ? 'Deleting...' : `Delete ${fileName}`}
      >
        <Trash2 size={isOverlay ? 18 : 14} className={isDeleting ? 'animate-pulse' : ''} />
      </button>

      <div
        onClick={e => e.stopPropagation()}
        onKeyDown={e => e.stopPropagation()}
        role='button'
        tabIndex={0}
      >
        <Modal
          isOpen={showDeleteConfirm}
          onClose={() => setShowDeleteConfirm(false)}
          title='Delete Attachment'
          subtitle='Are you sure you want to delete this attachment?'
          showCloseButton={true}
          closeOnBackdropClick={true}
          showDivider={true}
          primaryAction={{
            text: isDeleting ? 'Deleting...' : 'Delete',
            onClick: handleConfirmDelete,
            buttonType: ButtonType.DANGER,
            loading: isDeleting,
            disabled: isDeleting,
          }}
          secondaryAction={{
            text: 'Cancel',
            onClick: () => setShowDeleteConfirm(false),
            buttonType: ButtonType.SECONDARY,
          }}
        >
          <div className='space-y-3'>
            <p className='text-sm text-gray-600'>This action cannot be undone.</p>
            <div className='bg-gray-50 rounded-md p-3 border border-gray-200'>
              <p className='text-sm font-medium text-gray-900 truncate'>{fileName}</p>
            </div>
          </div>
        </Modal>
      </div>
    </>
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
}> = ({ attachmentId, fileName, canDelete }) => {
  return (
    <div className='absolute top-2 right-2 z-10 opacity-0 group-hover/attachment:opacity-100 transition-opacity duration-200'>
      <div className='flex items-center justify-between bg-gray-900/80 backdrop-blur-sm rounded-lg p-1 shadow-lg'>
        <DownloadButton attachmentId={attachmentId} fileName={fileName} variant='overlay' />
        {canDelete && (
          <DeleteButton attachmentId={attachmentId} fileName={fileName} variant='overlay' />
        )}
      </div>
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
}> = ({ attachmentId, fileName, mimeType, uploadedBy, width, height, thumbnailUrl, fileSize }) => {
  const [hasClickedPlay, setHasClickedPlay] = useState(false);
  const [thumbnailBlobUrl, setThumbnailBlobUrl] = useState<string | null>(null);
  const [thumbnailError, setThumbnailError] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const { user } = useAuthContext();
  const { isMobile } = usePlatform();
  const canDelete = uploadedBy === user?.id;
  const [loading, setLoading] = useState(true);

  const dimensions = React.useMemo(() => {
    const maxWidth = isMobile ? 320 : 360;
    const maxHeight = isMobile ? 260 : 320;
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
  }, [width, height]);

  // Fetch thumbnail on mount
  useEffect(() => {
    if (!thumbnailUrl) return;

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
      <div style={{ contain: 'layout' }}>
        {/* Video Header with controls */}
        <div
          style={{ width: `${dimensions.width}px`, minWidth: `${dimensions.width}px` }}
          className='flex items-center justify-between mb-1'
        >
          <div className='flex text-xs font-medium text-gray-900 truncate  items-center gap-2'>
            {fileName}
          </div>

          <div className='flex flex-1 items-center gap-1 flex-shrink-0'>
            <DownloadButton attachmentId={attachmentId} fileName={fileName} />
            {canDelete && <DeleteButton attachmentId={attachmentId} fileName={fileName} />}
          </div>
        </div>

        {/* Inline Video Player - Compact Slack-like size */}
        <div
          role='button'
          tabIndex={0}
          className='relative bg-black rounded-lg overflow-hidden border border-gray-200 shadow-sm cursor-pointer'
          onClick={() => {
            if (isMobile) {
              setIsModalOpen(true);
            } else if (!hasClickedPlay) {
              setHasClickedPlay(true);
            }
          }}
          onKeyDown={e => {
            if ((e.key === 'Enter' || e.key === ' ') && !hasClickedPlay) {
              e.preventDefault();
              if (isMobile) {
                setIsModalOpen(true);
              } else if (!hasClickedPlay) {
                setHasClickedPlay(true);
              }
            }
          }}
          style={{
            height: dimensions.height,
            width: `${dimensions.width}px`,
            minWidth: `${dimensions.width}px`,
          }}
        >
          {/* Show thumbnail on mobile or until user clicks to play on desktop */}
          {loading ? (
            <div className='bg-gray-200 animate-pulse flex items-center justify-center' />
          ) : !hasClickedPlay || isMobile ? (
            <>
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
                <div className='absolute inset-0 flex items-center justify-center bg-gray-900'>
                  <Video size={64} className='text-gray-600' />
                </div>
              )}
            </>
          ) : (
            // Load actual video player only after user clicks (desktop only)
            <VideoViewer
              attachmentId={attachmentId}
              source={null}
              fileName={fileName}
              width={dimensions.width}
              height={dimensions.height}
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
        />
      </div>
    </>
  );
};

/**
 * Main MessageAttachment component
 */
export const MessageAttachment: React.FC<MessageAttachmentProps> = ({ attachment, compact }) => {
  const { user } = useAuthContext();
  const { isMobile } = usePlatform();
  const [isPreviewOpen, setIsPreviewOpen] = React.useState(false);

  const isTextFile =
    attachment.mimetype === 'text/plain' || attachment.originalFilename.endsWith('.txt');
  const isVideo = isVideoFile(attachment.mimetype);

  const canDelete = attachment.uploadedByUserId === user?.id;

  const handleCardClick = (): void => {
    setIsPreviewOpen(true);
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
      />
    );
  }

  // Regular attachment card for other file types - Slack style
  return (
    <>
      <div
        className={`message-attachment group/attachment relative flex flex-col bg-white border border-gray-200 rounded-lg overflow-hidden hover:shadow-md transition-all duration-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${compact ? 'w-16 h-16' : isMobile ? 'w-full h-56' : 'w-full h-64'}`}
        onClick={handleCardClick}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role='button'
        aria-label={`Open ${attachment.originalFilename} preview`}
      >
        {/* Preview Section with Action Tray */}
        <div
          className={
            compact
              ? 'relative h-16 w-16 bg-gray-100 overflow-hidden rounded-md'
              : isMobile
                ? 'relative bg-gray-50 overflow-hidden'
                : 'relative bg-gray-100 overflow-hidden'
          }
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
          />

          {/* Slack-style hover action tray */}
          {!compact && (
            <ActionTray
              attachmentId={attachment.id}
              fileName={attachment.originalFilename}
              canDelete={canDelete}
            />
          )}
        </div>

        {/* Hover overlay for better UX feedback */}
        <div className='absolute inset-0 bg-black bg-opacity-0 group-hover/attachment:bg-opacity-5 transition-all duration-200 pointer-events-none' />
      </div>

      {/* File Preview Modal */}
      <div data-prevent-drawer='true' onTouchStart={e => e.stopPropagation()}>
        <FilePreviewModal
          isOpen={isPreviewOpen}
          onClose={() => setIsPreviewOpen(false)}
          fileName={attachment.originalFilename}
          fileUrl={`/attachments/${attachment.id}/download`}
          mimeType={attachment.mimetype}
          fileSize={attachment.size}
          attachmentId={attachment.id}
        />
      </div>
    </>
  );
};

// Memoize the component for performance
export default React.memo(MessageAttachment);
