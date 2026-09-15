// ============================================================================
// ATTACHMENT PREVIEW COMPONENT
// ============================================================================
// Shows thumbnail preview of file attachments
// ============================================================================

import React, { useState, useEffect, useRef } from 'react';
import { X, FileText, Image as ImageIcon, Video, Music, Loader2, Headphones } from 'lucide-react';
import {
  getFileCategory,
  getFileExtension,
  getExtensionColor,
  truncateFileName,
} from '../utils/files';
import type { AttachmentPreviewProps, UploadedFile } from './Files.types';
import { generateWebThumbnail, isVideoFile } from '../../../services/thumbnailService';
import { createPreviewUrl } from '../../../services/clients/fileFetchService';
import { usePlatform } from '../../../hooks/usePlatform';

// Type guard to check if file is a browser File object
const isBrowserFile = (file: File | UploadedFile): file is File => {
  return 'slice' in file && 'type' in file && 'name' in file;
};

// Helper functions to get properties from either File or UploadedFile
const getFileName = (file: File | UploadedFile): string => {
  return isBrowserFile(file) ? file.name : file.originalName;
};

const getMimeType = (file: File | UploadedFile): string => {
  return isBrowserFile(file) ? file.type : file.mimeType;
};

const getFileId = (file: File | UploadedFile): string | null => {
  return isBrowserFile(file) ? null : file.id;
};

export const AttachmentPreview: React.FC<AttachmentPreviewProps> = ({
  file,
  onRemove,
  onPreview,
  isUploading = false,
  variant = 'compact',
}) => {
  const { isMobile } = usePlatform();
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [videoThumbnailUrl, setVideoThumbnailUrl] = useState<string | null>(null);
  const [isGeneratingThumbnail, setIsGeneratingThumbnail] = useState(false);
  const [textPreview, setTextPreview] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [videoLightboxUrl, setVideoLightboxUrl] = useState<string | null>(null);

  // Cache fetched blob URLs to avoid redundant fetches
  const previewCacheRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    return (): void => {
      if (videoLightboxUrl) {
        URL.revokeObjectURL(videoLightboxUrl);
      }
    };
  }, [videoLightboxUrl]);

  const category = getFileCategory({
    type: getMimeType(file),
    name: getFileName(file),
  });
  const isTextFile = getMimeType(file) === 'text/plain' || getFileName(file).endsWith('.txt');
  const fileId = getFileId(file);

  useEffect((): (() => void) | void => {
    setPreviewError(false);

    // Create object URL for images to show actual preview (only for browser File objects)
    if (category === 'image' && isBrowserFile(file)) {
      const url = URL.createObjectURL(file);
      setImagePreviewUrl(url);
      return (): void => URL.revokeObjectURL(url);
    }

    // Lazy fetch image for UploadedFile objects (like MessageAttachment.Preview)
    else if (category === 'image' && !isBrowserFile(file) && fileId) {
      setIsLoadingPreview(true);

      // Check cache first
      const cached = previewCacheRef.current.get(fileId);
      if (cached) {
        setImagePreviewUrl(cached);
        setIsLoadingPreview(false);
        return;
      }

      // Fetch image blob from server
      const fetchImage = async (): Promise<void> => {
        try {
          const blob = await createPreviewUrl(fileId);
          const url = URL.createObjectURL(blob);
          previewCacheRef.current.set(fileId, url);
          setImagePreviewUrl(url);
        } catch {
          setPreviewError(true);
        } finally {
          setIsLoadingPreview(false);
        }
      };

      void fetchImage();

      return (): void => {
        // Cleanup is handled by cache management
      };
    }

    // Generate thumbnail for videos (only for browser File objects)
    if (category === 'video' && isBrowserFile(file) && isVideoFile(file)) {
      let cancelled = false;

      setIsGeneratingThumbnail(true);
      generateWebThumbnail(file)
        .then(result => {
          if (!cancelled) {
            setVideoThumbnailUrl(result.dataUrl);
          }
        })
        .catch(() => {
          if (!cancelled) {
            // Thumbnail generation failed silently
          }
        })
        .finally(() => {
          if (!cancelled) {
            setIsGeneratingThumbnail(false);
          }
        });

      return () => {
        cancelled = true;
      };
    }

    // Lazy fetch video thumbnail for UploadedFile objects (like MessageAttachment.Preview)
    else if (category === 'video' && !isBrowserFile(file) && fileId) {
      setIsLoadingPreview(true);

      // Check cache first
      const cached = previewCacheRef.current.get(`${fileId}-thumb`);
      if (cached) {
        setVideoThumbnailUrl(cached);
        setIsLoadingPreview(false);
        return;
      }

      // Fetch video thumbnail from server
      const fetchThumbnail = async (): Promise<void> => {
        try {
          const blob = await createPreviewUrl(`/attachments/${fileId}/thumbnail`);
          const url = URL.createObjectURL(blob);
          previewCacheRef.current.set(`${fileId}-thumb`, url);
          setVideoThumbnailUrl(url);
        } catch {
          setPreviewError(true);
        } finally {
          setIsLoadingPreview(false);
        }
      };

      void fetchThumbnail();

      return (): void => {
        // Cleanup is handled by cache management
      };
    }

    // Read text content for .txt files (only first 150 chars, safe for any file size)
    if (isTextFile && isBrowserFile(file)) {
      const reader = new FileReader();
      reader.onload = (e): void => {
        const text = e.target?.result as string;
        if (text) {
          // Get first 3 lines or first 150 characters
          const lines = text.split('\n').slice(0, 3);
          const preview = lines.join('\n').substring(0, 150);
          setTextPreview(preview);
        }
      };
      // Only read first 1KB for preview (more than enough for 150 chars)
      const blob = file.slice(0, 1024);
      reader.readAsText(blob);
    }
    return undefined;
  }, [file, category, isTextFile, fileId]);

  const renderPreview = (): React.ReactElement => {
    // Show loading state
    if (isLoadingPreview && (category === 'image' || category === 'video')) {
      return (
        <div className='w-full h-full bg-muted flex items-center justify-center'>
          <Loader2 className='h-8 w-8 text-muted-foreground animate-spin' />
        </div>
      );
    }

    switch (category) {
      case 'image':
        if (previewError) {
          return <ImageIcon className='h-8 w-8 text-action-primary' />;
        }
        return imagePreviewUrl ? (
          <img
            src={imagePreviewUrl}
            alt={getFileName(file)}
            className='w-full h-full object-cover'
          />
        ) : (
          <ImageIcon className='h-8 w-8 text-action-primary' />
        );

      case 'video':
        // Show loading spinner while generating/fetching thumbnail
        if (isGeneratingThumbnail || isLoadingPreview) {
          return (
            <div className='w-full h-full bg-purple-50 flex items-center justify-center'>
              <Loader2 className='h-8 w-8 text-purple-600 animate-spin' />
            </div>
          );
        }

        // Show thumbnail with video icon overlay if thumbnail was generated/fetched
        if (videoThumbnailUrl) {
          return (
            <div className='relative w-full h-full'>
              <img
                src={videoThumbnailUrl}
                alt={getFileName(file)}
                className='w-full h-full object-cover'
              />
              <div className='absolute inset-0 flex items-center justify-center bg-black bg-opacity-30'>
                <Video className='h-8 w-8 text-white drop-shadow-lg' />
              </div>
            </div>
          );
        }

        // Fallback to video icon if thumbnail generation/fetch failed
        return (
          <div className='w-full h-full bg-purple-50 flex items-center justify-center'>
            <Video className='h-8 w-8 text-purple-600' />
          </div>
        );

      case 'audio':
        return (
          <div className='w-full h-full bg-green-50 flex items-center justify-center'>
            <Music className='h-8 w-8 text-green-600' />
          </div>
        );

      default:
        // Show text preview for .txt files
        if (isTextFile && textPreview) {
          return (
            <div className='w-full h-full bg-background flex flex-col p-2 gap-1 overflow-hidden'>
              <div className='flex items-center gap-1 mb-1'>
                <FileText className='h-3 w-3 text-muted-foreground' />
                <div
                  className={`${getExtensionColor(getFileName(file))} text-white text-[8px] font-bold px-1 py-0.5 rounded`}
                >
                  {getFileExtension(getFileName(file))}
                </div>
              </div>
              <div className='text-[9px] text-foreground font-mono leading-tight overflow-hidden whitespace-pre-wrap'>
                {textPreview}
                {textPreview.length >= 150 && '...'}
              </div>
            </div>
          );
        }

        // Default file icon for other types
        return (
          <div className='w-full h-full bg-muted flex flex-col items-center justify-center p-2 gap-1'>
            <FileText className='h-6 w-6 text-muted-foreground' />
            <div
              className={`${getExtensionColor(getFileName(file))} text-white text-[10px] font-bold px-1.5 py-0.5 rounded`}
            >
              {getFileExtension(getFileName(file))}
            </div>
            <div className='text-[8px] text-muted-foreground text-center w-full px-1 leading-tight'>
              {truncateFileName(getFileName(file))}
            </div>
          </div>
        );
    }
  };

  if (variant === 'detailed') {
    return (
      <div className='flex items-center justify-between w-full p-3 rounded-lg border border-input bg-muted'>
        <div className='flex gap-3 items-center w-full'>
          <span className='size-8 flex-shrink-0 rounded-lg overflow-hidden'>
            {category === 'image' && imagePreviewUrl ? (
              <img
                src={imagePreviewUrl}
                alt={getFileName(file)}
                className='w-full h-full object-cover'
              />
            ) : category === 'video' && videoThumbnailUrl ? (
              <img
                src={videoThumbnailUrl}
                alt={getFileName(file)}
                className='w-full h-full object-cover'
              />
            ) : category === 'audio' ? (
              <div className='w-full h-full bg-red-500 flex items-center justify-center'>
                <Headphones className='size-4 text-white' />
              </div>
            ) : (
              <div
                className={`${getExtensionColor(getFileName(file))} text-white text-[10px] flex items-center font-bold px-1.5 h-full w-full rounded`}
              >
                {getFileExtension(getFileName(file))}
              </div>
            )}
          </span>
          <div className='flex flex-col w-full'>
            <span className='flex items-center justify-between'>
              <p className='text-foreground text-sm font-medium overflow-hidden truncate max-w-64'>
                {getFileName(file)}
              </p>
              {!isUploading && (
                <button
                  type='button'
                  title='Remove attachment'
                  aria-label={`Remove attachment ${getFileName(file)}`}
                  onClick={e => {
                    e.stopPropagation();
                    onRemove();
                  }}
                  data-track-category='MESSAGE_ATTACHMENT'
                  data-track-name='REMOVE_ATTACHMENT'
                >
                  <X className='size-3.5 text-red-600' strokeWidth={2.33} />
                </button>
              )}
            </span>
            <p className='text-muted-foreground text-xs'>{getFileExtension(getFileName(file))}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {videoLightboxUrl && (
        <div
          className='fixed inset-0 z-[9999] flex items-center justify-center bg-black/80'
          role='dialog'
          aria-modal='true'
        >
          <button
            type='button'
            className='absolute inset-0 cursor-default'
            onClick={() => setVideoLightboxUrl(null)}
            data-track-category='MESSAGE_ATTACHMENT'
            data-track-name='CLOSE_VIDEO_LIGHTBOX'
            aria-label='Close video lightbox'
            tabIndex={-1}
          />
          <div className='relative max-w-4xl w-full mx-4'>
            <button
              type='button'
              onClick={() => setVideoLightboxUrl(null)}
              data-track-category='MESSAGE_ATTACHMENT'
              data-track-name='CLOSE_VIDEO_LIGHTBOX'
              className='absolute -top-3 -right-3 z-10 flex items-center justify-center size-7 rounded-full bg-black/70 hover:bg-black text-white transition-colors border border-white/20'
              aria-label='Close video'
            >
              <X className='size-4' />
            </button>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              src={videoLightboxUrl}
              controls
              autoPlay
              className='w-full rounded-lg max-h-[80vh]'
            />
          </div>
        </div>
      )}
      <div
        data-testid='attachment-preview'
        className='relative flex items-center justify-center bg-background cursor-pointer group rounded-xl border border-border hover:border-input shadow-sm hover:shadow-md transition-all duration-200'
        style={{ width: '64px', height: '64px' }}
        onClick={() => {
          if (category === 'video' && isBrowserFile(file)) {
            const url = URL.createObjectURL(file);
            setVideoLightboxUrl(url);
          } else {
            onPreview?.();
          }
        }}
        data-track-category='MESSAGE_ATTACHMENT'
        data-track-name='OPEN_ATTACHMENT_PREVIEW'
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (category === 'video' && isBrowserFile(file)) {
              const url = URL.createObjectURL(file);
              setVideoLightboxUrl(url);
            } else {
              onPreview?.();
            }
          }
        }}
        role='button'
        tabIndex={0}
        title={getFileName(file)}
      >
        {/* File preview/icon */}
        <div className='absolute inset-0 flex items-center justify-center overflow-hidden rounded-xl'>
          {renderPreview()}
        </div>

        {/* Upload loading overlay */}
        {isUploading && (
          <div className='absolute inset-0 flex items-center justify-center backdrop-blur-sm bg-background/80 rounded-xl z-10'>
            <Loader2 className='h-8 w-8 text-foreground animate-spin' />
          </div>
        )}

        {/* Remove button */}
        {!isUploading && (
          <button
            type='button'
            onClick={e => {
              e.stopPropagation();
              onRemove();
            }}
            data-track-category='MESSAGE_ATTACHMENT'
            data-track-name='REMOVE_ATTACHMENT'
            className={`absolute -top-2 -right-2 p-1 bg-background hover:bg-destructive/10 rounded-full transition-colors shadow-md border border-border z-10 ${
              isMobile ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
            title='Remove attachment'
            aria-label={`Remove attachment ${getFileName(file)}`}
          >
            <X className='h-3.5 w-3.5 text-red-600' />
          </button>
        )}
      </div>
    </>
  );
};
