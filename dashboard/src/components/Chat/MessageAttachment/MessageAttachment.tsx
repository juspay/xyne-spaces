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
import {
  Download,
  FileCode,
  FileText,
  Image,
  Maximize2,
  MoreVertical,
  Play,
  Video,
} from 'lucide-react';
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
import { isPreviewableDocument } from '../../../services/documentThumbnailService';
import { createPreviewUrl } from '../../../services/clients/fileFetchService';
import { AttachmentRef } from '../../../machines/attachmentViewerMachine';
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
import { useSelector } from '@xstate/react';
import {
  attachmentViewerActor,
  AttachmentViewerState,
} from '../../../machines/attachmentViewerMachine';

interface MessageAttachmentProps {
  attachment: QueryResultType<typeof queries.conversationMessagesV2>[number]['attachments'][number];
  compact?: boolean;
  isLoading?: boolean;
  allAttachments?: QueryResultType<typeof queries.conversationMessagesV2>[number]['attachments'];
  isInGrid?: boolean | undefined;
  fullSize?: boolean;
  // Thread context props
  conversationId?: string;
  channelId?: string;
  replyCount?: number;
  allThreadAttachments?: AttachmentRef[];
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
  const isDocumentWithThumbnail = isPreviewableDocument(mimeType) && !!thumbnailUrl;

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
    // Fetch image, video thumbnail, or document thumbnail
    if (!isImage && !(isVideo && thumbnailUrl) && !isDocumentWithThumbnail) {
      setIsLoading(false);
      return;
    }

    let blobUrl: string | null = null;

    const fetchPreview = async (): Promise<void> => {
      setIsLoading(true);
      setError(false);
      try {
        // For videos/documents with thumbnails, use the thumbnail endpoint
        // For images, use download endpoint (pass ID, createPreviewUrl will resolve it)
        const source =
          (isVideo || isDocumentWithThumbnail) && thumbnailUrl
            ? `/attachments/${attachmentId}/thumbnail`
            : attachmentId;

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
  }, [
    attachmentId,
    isImage,
    isVideo,
    isDocumentWithThumbnail,
    thumbnailUrl,
    compact,
    calculatedWidth,
  ]);

  const { isMobile } = usePlatform();

  if (isLoading) {
    return (
      <div
        className={cn(
          'bg-muted animate-pulse flex items-center justify-center min-w-[256px] min-h-[256px]',
          (isInGrid || fullSize) && 'w-full h-full',
        )}
        style={
          isInGrid || fullSize
            ? undefined
            : imageWidth
              ? {
                  height: fixedHeight,
                  width: `${imageWidth}px`,
                  minWidth: `${imageWidth}px`,
                }
              : {
                  width: '100%',
                  minWidth: '256px',
                }
        }
      />
    );
  }

  // Show image, video thumbnail, or document thumbnail preview
  if (isImage || (isVideo && thumbnailUrl) || isDocumentWithThumbnail) {
    if (error || !imageBlobUrl) {
      if (isDocumentWithThumbnail) {
        const ext = getFileExtension(mimeType);
        const size = formatFileSize(fileSize);
        const docIcon = getFileIcon(mimeType, 20);
        return (
          <div
            className={cn(
              'bg-muted flex flex-col items-center justify-center gap-2',
              isInGrid ? 'w-full h-full' : 'w-full h-full min-h-[180px]',
            )}
          >
            <div className='bg-card rounded-lg p-3 shadow-sm border border-border'>{docIcon}</div>
            <div className='text-center'>
              <div className='text-sm font-semibold text-foreground'>{ext}</div>
              <div className='text-xs text-muted-foreground'>{size}</div>
            </div>
          </div>
        );
      }
      return (
        <div
          className={cn(
            'h-full w-full bg-muted flex flex-col items-center justify-center gap-2 p-4',
            !isMobile && 'min-w-64 min-h-[256px]',
            fullSize && 'min-h-[256px]',
          )}
        >
          {isVideo ? (
            <>
              <Video size={32} className='text-muted-foreground' />
              <span className='text-xs text-muted-foreground text-center'>Preview unavailable</span>
            </>
          ) : (
            <>
              <Image size={32} className='text-muted-foreground' />
              <span className='text-xs text-muted-foreground text-center'>No Preview</span>
            </>
          )}
        </div>
      );
    }

    // Document thumbnail — render as a contained image (no fixed aspect ratio)
    if (isDocumentWithThumbnail) {
      const extension = getFileExtension(mimeType).toUpperCase();

      // Document type configuration map
      const documentConfig: Record<string, { icon: string; label: string }> = {
        'application/pdf': {
          icon: '/svgs/icons/attachment-icons/pdf.svg',
          label: 'PDF Document',
        },
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
          icon: '/svgs/icons/attachment-icons/docx.svg',
          label: 'Word Document',
        },
        'application/msword': {
          icon: '/svgs/icons/attachment-icons/docx.svg',
          label: 'Word Document',
        },
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
          icon: '/svgs/icons/attachment-icons/excel.svg',
          label: 'Excel Spreadsheet',
        },
        'application/vnd.ms-excel': {
          icon: '/svgs/icons/attachment-icons/excel.svg',
          label: 'Excel Spreadsheet',
        },
        'text/csv': {
          icon: '/svgs/icons/attachment-icons/csv.svg',
          label: 'CSV Document',
        },
        'text/comma-separated-values': {
          icon: '/svgs/icons/attachment-icons/csv.svg',
          label: 'CSV Document',
        },
      };

      const config = documentConfig[mimeType] ?? {
        icon: '/svgs/icons/attachment-icons/pdf.svg',
        label: `${extension} Document`,
      };

      // Truncate filename if too long
      const displayFileName = fileName.length > 30 ? `${fileName.substring(0, 27)}...` : fileName;

      return (
        <div className='w-full h-full min-h-0 flex flex-col'>
          {/* File metadata header - Slack style */}
          <div className='bg-muted px-3 py-2.5 border-b border-border flex items-center gap-3 shrink-0'>
            {/* File icon */}
            <div className='shrink-0 w-8 h-8'>
              <img src={config.icon} alt={extension} className='w-full h-full' />
            </div>
            {/* File info - truncate to prevent overflow on mobile */}
            <div className='flex flex-col min-w-0 flex-1 overflow-hidden'>
              <span className='text-sm text-foreground font-medium'>{displayFileName}</span>
              <span className='text-xs text-muted-foreground'>{config.label}</span>
            </div>
          </div>
          {/* Document preview - fixed height area, content clipped */}
          <div className='flex-1 min-h-0 overflow-hidden'>
            <img
              src={imageBlobUrl}
              alt={fileName}
              className='w-full h-full'
              loading='lazy'
              style={{ objectFit: 'cover', objectPosition: 'top' }}
              onError={() => setError(true)}
            />
          </div>
        </div>
      );
    }

    return isImage ? (
      <img
        src={imageBlobUrl}
        alt={fileName}
        className={cn(fullSize ? 'w-full h-auto' : isInGrid ? 'w-full h-full' : 'w-auto')}
        loading='lazy'
        style={
          fullSize
            ? undefined
            : isInGrid
              ? { objectFit: 'cover' }
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
      <div className='w-full h-full bg-muted flex flex-col items-center justify-center gap-2 p-2'>
        <div className='bg-card rounded-lg p-2 shadow-sm border border-border'>{icon}</div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'bg-muted flex flex-col items-center justify-center gap-2 w-full h-full',
        !isInGrid && 'min-h-[256px]',
      )}
    >
      <div className='bg-card rounded-lg p-3 shadow-sm border border-border'>{icon}</div>
      <div className='text-center'>
        <div className='text-sm font-semibold text-foreground'>{extension}</div>
        <div className='text-xs text-muted-foreground'>{formattedSize}</div>
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
  conversationId?: string;
  channelId?: string;
  replyCount?: number;
}> = ({ attachmentId, fileName, metadata, conversationId, channelId, replyCount }) => {
  const [fileData, setFileData] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
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
      <div className='max-w-2xl p-4 bg-muted rounded-lg border border-border animate-pulse'>
        <div className='h-4 bg-accent rounded w-1/3 mb-3'></div>
        <div className='space-y-2'>
          <div className='h-3 bg-accent rounded w-full'></div>
          <div className='h-3 bg-accent rounded w-full'></div>
          <div className='h-3 bg-accent rounded w-4/5'></div>
        </div>
      </div>
    );
  }

  if (error || !fileData) {
    return (
      <div className='w-full max-w-2xl p-4 bg-destructive/10 rounded-lg border border-destructive/30'>
        <div className='text-sm text-destructive font-medium mb-1'>Failed to load text file</div>
        <div className='text-xs text-destructive/80'>{error || 'Unknown error'}</div>
      </div>
    );
  }

  // For large files, show a button to open in TxtViewer modal
  const openLargeTextFile = () => {
    const attachment: AttachmentRef = {
      attachmentId,
      fileName,
      fileUrl: `/attachments/${attachmentId}/download`,
      mimeType: 'text/plain',
      fileSize: fileData.size,
      ...(conversationId && { conversationId }),
      ...(channelId && { channelId }),
      ...(replyCount !== undefined && { replyCount }),
    };
    attachmentViewerActor.send({ type: 'OPEN', attachments: [attachment] });
  };

  if (isLargeFile) {
    return (
      <div className='w-full max-w-2xl'>
        <div className='flex items-center gap-2'>
          <button
            type='button'
            onClick={openLargeTextFile}
            className='flex items-center gap-2 p-2 rounded-md transition-colors duration-150 text-muted-foreground hover:bg-accent hover:text-foreground'
            data-track-category='MESSAGE'
            data-track-name='OPEN_TEXT_FILE'
            data-track-metadata={JSON.stringify({ fileName, attachmentId })}
          >
            <FileText className='h-4 w-4' />
            <span className='truncate max-w-md'>{formatFileName(fileName)}</span>
            <span className='ml-1 text-xs text-muted-foreground'>(click to view)</span>
          </button>
          <button
            type='button'
            onClick={e => {
              e.stopPropagation();
              void downloadAttachment(attachmentId, fileName);
            }}
            className='p-2 hover:bg-accent rounded-lg transition-colors'
            title='Download file'
            data-track-category='MESSAGE'
            data-track-name='DOWNLOAD_TEXT_FILE'
            data-track-metadata={JSON.stringify({ fileName, attachmentId })}
          >
            <Download className='h-4 w-4 text-muted-foreground' />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className='w-full max-w-2xl'>
      {/* Collapsible Header */}
      <div className='flex items-center gap-2 mb-2'>
        <button
          type='button'
          onClick={() => setIsExpanded(!isExpanded)}
          className='flex items-center gap-1 p-2 rounded-md transition-colors duration-150 text-muted-foreground hover:bg-accent hover:text-foreground'
          data-track-category='MESSAGE'
          data-track-name='TOGGLE_TEXT_PREVIEW'
          data-track-metadata={JSON.stringify({ fileName, attachmentId, isExpanded })}
        >
          <FileText className='h-4 w-4' />
          <span className='truncate max-w-md'>{formatFileName(fileName)}</span>
          <span className='ml-1 text-xs text-muted-foreground'>
            {isExpanded ? '[Hide]' : '[View]'}
          </span>
        </button>
        <button
          type='button'
          onClick={e => {
            e.stopPropagation();
            void downloadAttachment(attachmentId, fileName);
          }}
          className='p-2 hover:bg-accent rounded-lg transition-colors'
          title='Download file'
          data-track-category='MESSAGE'
          data-track-name='DOWNLOAD_TEXT_FILE_INLINE'
          data-track-metadata={JSON.stringify({ fileName, attachmentId })}
        >
          <Download className='h-4 w-4 text-muted-foreground' />
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

const CODE_FILE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.py',
  '.rb',
  '.go',
  '.java',
  '.c',
  '.cpp',
  '.cs',
  '.sql',
  '.yml',
  '.yaml',
  '.json',
  '.md',
  '.markdown',
]);

const isCodeFileByName = (fileName: string): boolean => {
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex === -1) return false;
  return CODE_FILE_EXTENSIONS.has(fileName.slice(dotIndex).toLowerCase());
};

/**
 * Inline Code File Renderer - always opens modal on click (no inline expansion)
 * No pre-fetching needed — CodeViewer inside the modal handles its own loading.
 */
const InlineCodeFile: React.FC<{
  attachmentId: string;
  fileName: string;
  mimeType: string;
  conversationId?: string;
  channelId?: string;
  replyCount?: number;
}> = ({ attachmentId, fileName, mimeType, conversationId, channelId, replyCount }) => {
  const windowWidth = useWindowWidth();
  const formatFileName = (name: string) => (windowWidth < 500 ? truncateFileName(name, 28) : name);

  const openCodeFile = () => {
    const attachment: AttachmentRef = {
      attachmentId,
      fileName,
      fileUrl: `/attachments/${attachmentId}/download`,
      mimeType,
      fileSize: 0,
      ...(conversationId && { conversationId }),
      ...(channelId && { channelId }),
      ...(replyCount !== undefined && { replyCount }),
    };
    attachmentViewerActor.send({ type: 'OPEN', attachments: [attachment] });
  };

  return (
    <div className='w-full max-w-2xl'>
      <div className='flex items-center gap-2'>
        <button
          type='button'
          onClick={openCodeFile}
          className='flex items-center gap-2 p-2 rounded-md transition-colors duration-150 text-muted-foreground hover:bg-accent hover:text-foreground'
          data-track-category='MESSAGE'
          data-track-name='OPEN_CODE_FILE'
          data-track-metadata={JSON.stringify({ fileName, attachmentId })}
        >
          <FileCode className='h-4 w-4' />
          <span className='truncate max-w-md'>{formatFileName(fileName)}</span>
          <span className='ml-1 text-xs text-muted-foreground'>[View]</span>
        </button>
        <button
          type='button'
          onClick={e => {
            e.stopPropagation();
            void downloadAttachment(attachmentId, fileName);
          }}
          className='p-2 hover:bg-accent rounded-lg transition-colors'
          title='Download file'
          data-track-category='MESSAGE'
          data-track-name='DOWNLOAD_CODE_FILE'
          data-track-metadata={JSON.stringify({ fileName, attachmentId })}
        >
          <Download className='h-4 w-4 text-muted-foreground' />
        </button>
      </div>
    </div>
  );
};

/**
 * Format video duration in seconds to M:SS or H:MM:SS
 */
const formatDuration = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
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
  conversationId?: string;
  channelId?: string;
  replyCount?: number;
  duration?: number | undefined;
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
  conversationId,
  channelId,
  replyCount,
  duration,
}) => {
  const [hasClickedPlay, setHasClickedPlay] = useState(false);
  const [thumbnailBlobUrl, setThumbnailBlobUrl] = useState<string | null>(null);
  const [thumbnailError, setThumbnailError] = useState(false);
  const { isMobile } = usePlatform();
  const [loading, setLoading] = useState(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // check if the video is open in modal
  const { isOpenInModal, modalVideoTime } = useSelector(
    attachmentViewerActor,
    (s: AttachmentViewerState) => {
      const current = s.context.attachments[s.context.currentIndex];
      const isOpen = s.value !== 'closed' && current?.attachmentId === attachmentId;
      return { isOpenInModal: isOpen, modalVideoTime: s.context.currentVideoTime };
    },
  );

  // pause inline player when modal opens and resume from exact time when close
  useEffect(() => {
    if (isOpenInModal) {
      videoRef.current?.pause();
    } else if (modalVideoTime !== undefined && videoRef.current) {
      videoRef.current.currentTime = modalVideoTime;
      videoRef.current.play().catch(() => {});
    }
  }, [isOpenInModal, modalVideoTime]);

  const { canDelete, handleDelete } = useAttachmentDelete(attachmentId, fileName, uploadedBy);

  const openModal = () => {
    // Exit fullscreen if active before opening modal
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {
        // Silently handle fullscreen exit errors
      });
    }
    // Capture current video time before opening modal
    const currentTime = videoRef.current?.currentTime;
    const attachment: AttachmentRef = {
      attachmentId,
      fileName,
      fileUrl: '', // Not used for videos
      mimeType,
      fileSize,
      ...(currentTime !== undefined && { initialTime: currentTime }),
      ...(conversationId && { conversationId }),
      ...(channelId && { channelId }),
      ...(replyCount !== undefined && { replyCount }),
    };
    attachmentViewerActor.send({ type: 'OPEN', attachments: [attachment] });
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
          className='p-1.5 rounded-md bg-black/60 backdrop-blur-sm text-white transition-colors opacity-0 group-hover:opacity-100'
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
      <div style={{ contain: 'layout', height: dimensions.height }}>
        <div className='relative bg-black rounded-lg overflow-hidden border border-border shadow-sm w-full h-full max-w-md'>
          {/* Show thumbnail on mobile or until user clicks to play on desktop */}
          {loading ? (
            <div className='bg-muted animate-pulse flex items-center justify-center w-full h-full' />
          ) : !hasClickedPlay || isMobile ? (
            <div className='relative h-full'>
              {thumbnailBlobUrl && !thumbnailError ? (
                <img src={thumbnailBlobUrl} alt={fileName} className='w-full h-full object-cover' />
              ) : (
                // Show video icon if no thumbnail
                <div className={cn('flex items-center justify-center bg-gray-900 h-full min-w-64')}>
                  {!isMobile && <Video size={64} className='text-muted-foreground' />}
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
                      openModal();
                    } else {
                      setHasClickedPlay(true);
                    }
                  }}
                  onTouchStart={e => e.stopPropagation()}
                  className='p-1 flex items-center justify-center gap-1 rounded-md bg-black/60 backdrop-blur-sm text-white hover:bg-black/80 transition-colors'
                  title='Play video'
                  aria-label='Play video'
                  data-track-category='MESSAGE_ATTACHMENT'
                  data-track-name='PlayVideoAttachment'
                  data-track-metadata={JSON.stringify({ attachmentId, fileName })}
                >
                  <Play className='h-4 w-4 fill-white' />
                  <span className='font-semibold'>
                    {duration ? formatDuration(duration) : 'VIDEO'}
                  </span>
                </button>
              </div>
              {/* Expand button for desktop */}
              {!isMobile && (
                <div className='absolute bottom-4 right-3 opacity-0 group-hover:opacity-100 transition-opacity'>
                  <button
                    onClick={openModal}
                    className='p-1.5 rounded-md bg-black/60 backdrop-blur-sm text-white hover:bg-black/80 transition-colors'
                    title='Expand video'
                    aria-label='Expand video'
                    data-track-category='MESSAGE_ATTACHMENT'
                    data-track-name='ExpandVideoAttachment'
                    data-track-metadata={JSON.stringify({ attachmentId, fileName })}
                  >
                    <Maximize2 className='h-4 w-4' />
                  </button>
                </div>
              )}
            </div>
          ) : (
            // Load actual video player only after user clicks (desktop only)
            <div className={cn('h-full', isOpenInModal && 'invisible absolute')}>
              <VideoViewer
                attachmentId={attachmentId}
                source={null}
                fileName={fileName}
                width={dimensions.width}
                height={dimensions.height}
                onExpand={openModal}
                menuContent={inlineMenuContent}
                ref={videoRef}
              />
            </div>
          )}
        </div>
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
  isInGrid,
  fullSize,
  conversationId,
  channelId,
  replyCount,
  allThreadAttachments,
}) => {
  const { isMobile } = usePlatform();
  const isOpen = useSelector(
    attachmentViewerActor,
    (s: AttachmentViewerState) => s.value !== 'closed',
  );

  const { canDelete, handleDelete } = useAttachmentDelete(
    attachment.id,
    attachment.originalFilename,
    attachment.uploadedByUserId,
  );

  const isTextFile =
    attachment.mimetype === 'text/plain' || attachment.originalFilename.endsWith('.txt');
  const isCodeFile = isCodeFileByName(attachment.originalFilename);
  const isVideo = isVideoFile(attachment.mimetype);

  const handleCardClick = (): void => {
    // Use thread attachments if available, otherwise build from message attachments
    const attachments: AttachmentRef[] =
      allThreadAttachments ||
      (allAttachments || [attachment]).map(att => {
        const ref: AttachmentRef = {
          attachmentId: att.id,
          fileName: att.originalFilename,
          fileUrl: `/attachments/${att.id}/download`,
          mimeType: att.mimetype,
          fileSize: att.size,
          thumbnailUrl: att.thumbnailUrl,
        };
        if (conversationId) ref.conversationId = conversationId;
        if (channelId) ref.channelId = channelId;
        if (replyCount !== undefined) ref.replyCount = replyCount;
        return ref;
      });

    // Find starting index based on the attachment's position in the array
    // Try multiple matching strategies to ensure we find the correct attachment
    let startIndex = attachments.findIndex(att => att.attachmentId === attachment.id);

    // If not found by ID, try matching by fileName and fileSize as fallback
    if (startIndex === -1) {
      startIndex = attachments.findIndex(
        att =>
          att.fileName === attachment.originalFilename &&
          att.fileSize === attachment.size &&
          att.mimeType === attachment.mimetype,
      );
    }

    // Fallback to 0 if attachment not found in the array
    const safeStartIndex = startIndex === -1 ? 0 : startIndex;

    // Use UPDATE if viewer is already open, otherwise OPEN
    attachmentViewerActor.send({
      type: isOpen ? 'UPDATE' : 'OPEN',
      attachments,
      startIndex: safeStartIndex,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleCardClick();
    }
  };

  // Render inline text viewer for .txt files on PC only (mobile shows as regular attachment)
  if (isTextFile && !compact && !isMobile) {
    const metadata = attachment.metadata as Record<string, unknown> | null;
    return (
      <InlineTextFile
        attachmentId={attachment.id}
        fileName={attachment.originalFilename}
        {...(metadata && { metadata })}
        {...(conversationId && { conversationId })}
        {...(channelId && { channelId })}
        {...(replyCount !== undefined && { replyCount })}
      />
    );
  }

  // Render inline code viewer with syntax highlighting for code files on PC only
  if (isCodeFile && !compact && !isMobile) {
    return (
      <InlineCodeFile
        attachmentId={attachment.id}
        fileName={attachment.originalFilename}
        mimeType={attachment.mimetype}
        {...(conversationId && { conversationId })}
        {...(channelId && { channelId })}
        {...(replyCount !== undefined && { replyCount })}
      />
    );
  }

  // Render inline video player for video files (Slack-like behavior)
  if (isVideo && !compact) {
    const metadata = attachment.metadata as { duration?: number } | null;
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
        duration={metadata?.duration}
        isInGrid={isInGrid}
        {...(conversationId && { conversationId })}
        {...(channelId && { channelId })}
        {...(replyCount !== undefined && { replyCount })}
      />
    );
  }

  // Regular attachment card for other file types - Slack style
  return (
    <>
      <div
        className={cn(
          'message-attachment group/attachment relative flex flex-col bg-card border border-border rounded-lg overflow-hidden hover:shadow-md transition-all duration-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2',
          compact
            ? 'w-16 h-16 '
            : isInGrid
              ? 'w-full h-full'
              : isMobile
                ? 'h-full '
                : 'w-full h-64',
        )}
        onClick={handleCardClick}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role='button'
        aria-label={`Open ${attachment.originalFilename} preview`}
        data-track-category='MESSAGE'
        data-track-name='OPEN_ATTACHMENT_PREVIEW'
        data-track-metadata={JSON.stringify({
          fileName: attachment.originalFilename,
          attachmentId: attachment.id,
        })}
      >
        {/* Preview Section with Action Tray */}
        <div
          className={cn(
            'relative overflow-hidden',
            compact && 'h-16 w-16 bg-muted rounded-md',
            !compact && (isInGrid ? 'w-full h-full bg-muted' : isMobile ? 'bg-muted' : 'bg-muted'),
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
    </>
  );
};

// Memoize the component for performance
export default React.memo(MessageAttachment);
