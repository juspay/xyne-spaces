/**
 *
 * Renders an optimistic "in-flight" message while the sender's file uploads
 * are still completing (awaitEntityUploads is pending).
 *
 * The bubble visually mimics a real chat message but is slightly dimmed and
 * shows a spinner overlay on each attachment thumbnail to communicate that
 * the upload is in progress.
 *
 * Container CSS and dimension calculations are kept in strict sync with:
 *   - MessageBubble (gap, padding, avatar column width)
 *   - InlineVideoPlayer (video sizing + two-div structure with contain/max-w-md)
 *   - Preview component (image sizing with fixedHeight / maxWidth)
 *   - AttachmentsBlock (gap-3 between attachment rows, wrapper divs)
 */

import React, { useMemo } from 'react';
import { Loader2, File as FileIcon, Video } from 'lucide-react';
import type { PendingAttachment, PendingMessage } from '../../machines/pendingMessageMachine';
import Avatar from '../ui/Avatar/Avatar';
import { usePlatform } from '../../hooks/usePlatform';

// ---------------------------------------------------------------------------
// Sizing constants — must stay in sync with InlineVideoPlayer and Preview
// ---------------------------------------------------------------------------

// Image sizing (matches Preview component, non-grid path)
const IMAGE_FIXED_HEIGHT = 256;
const IMAGE_MAX_WIDTH = 300;

// Video sizing (matches InlineVideoPlayer's `dimensions` useMemo exactly)
const VIDEO_MAX_WIDTH_DESKTOP = 500;
const VIDEO_MAX_HEIGHT_DESKTOP = 400;
const VIDEO_MAX_WIDTH_MOBILE = 320;
const VIDEO_MAX_HEIGHT_MOBILE = 260;
const VIDEO_MIN_WIDTH = 200;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function calcImageDimensions(
  srcWidth: number | undefined,
  srcHeight: number | undefined,
  isInMultiImageGroup: boolean,
): { width: number; height: number } {
  const fixedHeight = IMAGE_FIXED_HEIGHT;

  if (srcWidth && srcHeight) {
    const aspectRatio = srcWidth / srcHeight;
    const calculatedWidth = Math.min(IMAGE_MAX_WIDTH, Math.round(aspectRatio * fixedHeight));
    const actualHeight = isInMultiImageGroup
      ? fixedHeight
      : Math.min(fixedHeight, Math.round(calculatedWidth / aspectRatio));
    return { width: calculatedWidth, height: actualHeight };
  }

  return { width: IMAGE_MAX_WIDTH, height: fixedHeight };
}

/**
 * Mirrors InlineVideoPlayer's `dimensions` useMemo exactly so the pending
 * tile is the same size as the real player.
 */
function calcVideoDimensions(
  srcWidth: number | undefined,
  srcHeight: number | undefined,
  isMobile: boolean,
): { width: number; height: number } {
  const maxWidth = isMobile ? VIDEO_MAX_WIDTH_MOBILE : VIDEO_MAX_WIDTH_DESKTOP;
  const maxHeight = isMobile ? VIDEO_MAX_HEIGHT_MOBILE : VIDEO_MAX_HEIGHT_DESKTOP;

  if (!srcWidth || !srcHeight) {
    return { width: maxWidth, height: maxHeight };
  }

  const scale = Math.min(maxWidth / srcWidth, maxHeight / srcHeight);
  let finalWidth = Math.round(srcWidth * scale);
  let finalHeight = Math.round(srcHeight * scale);

  if (finalWidth < VIDEO_MIN_WIDTH) {
    finalWidth = VIDEO_MIN_WIDTH;
    finalHeight = Math.round(srcHeight * (VIDEO_MIN_WIDTH / srcWidth));
  }

  return { width: finalWidth, height: finalHeight };
}

// ---------------------------------------------------------------------------
// Video attachment tile — matches InlineVideoPlayer's two-div structure
// ---------------------------------------------------------------------------

interface PendingVideoTileProps {
  attachment: PendingAttachment;
  isMobile: boolean;
}

const PendingVideoTile: React.FC<PendingVideoTileProps> = ({ attachment, isMobile }) => {
  const { width, height } = useMemo(
    () => calcVideoDimensions(attachment.width, attachment.height, isMobile),
    [attachment.width, attachment.height, isMobile],
  );

  return (
    /* Outer wrapper mirrors InlineVideoPlayer: contain + explicit dims */
    <div style={{ contain: 'layout', width, height }}>
      {/* Inner wrapper mirrors InlineVideoPlayer: bg-black, rounded-lg, max-w-md */}
      <div className='relative bg-black rounded-lg overflow-hidden border border-border shadow-sm w-full h-full max-w-md'>
        {/* Content layer */}
        {attachment.objectUrl ? (
          <>
            <video
              src={attachment.objectUrl}
              className='w-full h-full object-cover'
              muted
              playsInline
            />
            <div className='absolute inset-0 flex items-center justify-center pointer-events-none'>
              <Video className='h-5 w-5 text-white drop-shadow-lg' />
            </div>
          </>
        ) : (
          <div className='flex items-center justify-center bg-gray-900 w-full h-full'>
            <Video size={64} className='text-muted-foreground' />
          </div>
        )}

        {/* Upload-in-progress overlay */}
        <div className='absolute inset-0 flex flex-col items-center justify-center gap-1.5 backdrop-blur-sm bg-black/60'>
          <Loader2 className='h-6 w-6 text-white animate-spin' />
          <span className='text-xs font-medium text-white'>Uploading</span>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Image / file attachment tile — matches MessageAttachment card structure
// ---------------------------------------------------------------------------

interface PendingImageTileProps {
  attachment: PendingAttachment;
  isInMultiImageGroup: boolean;
}

const PendingImageTile: React.FC<PendingImageTileProps> = ({ attachment, isInMultiImageGroup }) => {
  const isImage = attachment.mimeType.startsWith('image/');

  const { width, height } = useMemo(() => {
    if (isImage) {
      return calcImageDimensions(attachment.width, attachment.height, isInMultiImageGroup);
    }
    // Generic file fallback — matches MessageAttachment's `w-fit h-64`
    return { width: 256, height: 256 };
  }, [isImage, attachment.width, attachment.height, isInMultiImageGroup]);

  return (
    <div
      className='relative rounded-lg overflow-hidden bg-card border border-border flex items-center justify-center flex-shrink-0 shadow-sm'
      style={
        isImage
          ? isInMultiImageGroup
            ? { width, height: IMAGE_FIXED_HEIGHT }
            : { width, height }
          : { width, height }
      }
    >
      {/* Content layer */}
      {isImage && attachment.objectUrl ? (
        <img
          src={attachment.objectUrl}
          alt={attachment.name}
          draggable={false}
          className='w-full h-full object-cover'
        />
      ) : (
        <div className='flex flex-col items-center justify-center gap-1 text-muted-foreground px-2 w-full h-full'>
          <FileIcon className='h-6 w-6 flex-shrink-0' />
          <span className='text-[8px] truncate max-w-full text-center leading-tight'>
            {attachment.name}
          </span>
        </div>
      )}

      {/* Upload-in-progress overlay */}
      <div className='absolute inset-0 flex flex-col items-center justify-center gap-1.5 backdrop-blur-sm bg-background/80'>
        <Loader2 className='h-6 w-6 text-foreground animate-spin' />
        <span className='text-xs font-medium text-foreground'>Uploading</span>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main bubble
// ---------------------------------------------------------------------------

interface PendingMessageBubbleProps {
  msg: PendingMessage;
}

export const PendingMessageBubble: React.FC<PendingMessageBubbleProps> = ({ msg }) => {
  const { isMobile } = usePlatform();

  const formattedTime = new Date(msg.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  const isEmptyHtml =
    !msg.html ||
    msg.html.replace(/<p[^>]*>(\s|&nbsp;)*<\/p>/gi, '').trim() === '' ||
    msg.html === '<p></p>';

  // Videos each get their own row (matching InlineVideoPlayer which renders
  // block-level). Images/files use flex-wrap so multiple can share a row.
  const videoAttachments = msg.attachments.filter(a => a.mimeType.startsWith('video/'));
  const imageAttachments = msg.attachments.filter(a => !a.mimeType.startsWith('video/'));
  const isInMultiImageGroup = imageAttachments.length > 1;

  return (
    <div
      /* Match MessageBubble: gap-2, py-1, px-4 */
      className='flex items-start gap-2 px-4 py-1 opacity-90 bg-muted/50'
      aria-label='Message uploading…'
      data-testid='pending-message-bubble'
    >
      {/* Avatar — match MessageBubble: w-8 column */}
      <div className='w-8 h-full flex items-start justify-center flex-shrink-0'>
        <Avatar userId={msg.senderId} size='md' showActiveStatus={false} />
      </div>

      {/* Content area — match MessageBubble: flex-1 flex-col gap-1 */}
      <div className='flex-1 flex flex-col gap-1 min-w-0'>
        {/* Header row */}
        <div className='flex items-baseline gap-2 mb-0.5 flex-wrap'>
          <span className='font-semibold text-sm text-gray-900 leading-tight'>
            {msg.senderName}
          </span>
          <span className='text-xs text-gray-500'>{formattedTime}</span>
        </div>

        {/* Message HTML content */}
        {!isEmptyHtml && (
          <div
            className='text-sm text-gray-800 prose prose-sm max-w-none [&_p]:my-0 [&_p]:leading-6 break-words'
            dangerouslySetInnerHTML={{ __html: msg.html }}
          />
        )}

        {/* Attachments container — match AttachmentsBlock: flex-col gap-3 */}
        {(videoAttachments.length > 0 || imageAttachments.length > 0) && (
          <div className='flex flex-col gap-3'>
            {/* Video attachments — each in own row, wrapped like AttachmentsBlock */}
            {videoAttachments.map(att => (
              <div key={att.id} className='flex items-center gap-2 py-2 text-sm'>
                <PendingVideoTile attachment={att} isMobile={isMobile} />
              </div>
            ))}

            {/* Image / file attachments — flex-wrap, matching AttachmentsBlock layout */}
            {imageAttachments.length > 0 && (
              <div
                className={`flex gap-3 ${isMobile ? 'overflow-x-auto flex-nowrap no-scrollbar' : 'flex-wrap'}`}
              >
                {imageAttachments.map(att => (
                  <div
                    key={att.id}
                    className={`flex items-center gap-2 py-2 text-sm ${isMobile ? 'flex-shrink-0' : ''}`}
                  >
                    <PendingImageTile attachment={att} isInMultiImageGroup={isInMultiImageGroup} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default PendingMessageBubble;
