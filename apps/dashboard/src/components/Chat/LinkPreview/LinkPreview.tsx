import React, { useState } from 'react';
import { ExternalLink, X, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { getYoutubeEmbedUrl, getYoutubeVideoId, isYoutubeUrl } from './youtubeUtils';
import { usePlatform } from '../../../hooks/usePlatform';
import { YouTubeThumbnail } from './YouTubeThumbnail';
import type { TicketPreviewSnapshot } from '@xyne/shared';

// Feature toggle: suppress the OG image card under external link previews.
// Set to true to render scraped images again. YouTube thumbnails are unaffected.
const SHOW_PREVIEW_IMAGES = false;

export interface ExternalLinkMetadata {
  type?: 'external';
  url: string;
  title?: string;
  description?: string;
  siteName?: string;
  image?: string;
  favicon?: string;
}

export interface InternalLinkAttachment {
  id: string;
  entityType: string;
  entityId: string;
  storageProvider: string;
  originalFilename: string;
  mimetype: string;
  size: number;
  width?: number | null;
  height?: number | null;
  uploadedByUserId: string;
  createdAt: number;
  url: string;
  createdBy: string;
  metadata?: Record<string, unknown> | null;
  conversationId?: string | null;
  thumbnailUrl?: string | null;
}

export interface InternalMessageLinkMetadata {
  type: 'internal_message';
  url: string;
  messageId: string;
  channelId: string;
  channelName: string;
  channelScopeType?: string;
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  content: string;
  timestamp: string;
  replyCount?: number;
  isDeleted?: boolean;
  hasAttachment?: boolean;
  attachments?: InternalLinkAttachment[];
  nestedLinkPreview?: Record<string, unknown>;
  /** Ticket data if the linked conversation has an associated ticket */
  ticket?: TicketPreviewSnapshot;
}

interface LinkPreviewProps {
  metadata: ExternalLinkMetadata;
  onClick?: () => void;
  onClose?: () => void;
}

/**
 * Safe URL parsing utility to prevent component crashes
 * Returns null for invalid URLs instead of throwing errors
 */
const parseUrlSafely = (url: string): URL | null => {
  try {
    return new URL(url);
  } catch {
    return null;
  }
};

/**
 * Extract hostname safely from URL string
 * Returns fallback text for invalid URLs
 */
const getHostnameSafely = (url: string): string | null => {
  const parsedUrl = parseUrlSafely(url);
  return parsedUrl?.hostname || null;
};

/**
 * Detect if URL is a Bitbucket link (Bitbucket Server).
 * Bitbucket links should never show OG images to avoid login page screenshots.
 */
const isBitbucketUrl = (url: string): boolean => {
  try {
    const urlObj = new URL(url);
    // Check if hostname contains 'bitbucket' (handles bitbucket.juspay.net, bitbucket.org, etc.)
    return urlObj.hostname.toLowerCase().includes('bitbucket');
  } catch {
    return false;
  }
};

/**
 * LinkPreview Component
 *
 * Displays a clean preview card for URLs with:
 * - Circular favicon on the left
 * - Title (or hostname) on top
 * - Site name below the title
 * - Close button for user dismissal
 * - Safe URL handling to prevent crashes
 * - Enhanced accessibility support
 * - Performance optimized with memoization
 *
 * Compatible with Zero sync - displays metadata from message.metadata field
 */
const LinkPreviewComponent: React.FC<LinkPreviewProps> = ({ metadata, onClose }) => {
  const { url, title, description, favicon, image } = metadata;
  const { isMobile } = usePlatform();
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);

  // Safe hostname extraction
  const hostname = getHostnameSafely(url);

  if (!hostname) {
    return null;
  }

  // YouTube: Slack-style – plain image thumbnail only, no YouTube UI. Our play + external icon only.
  if (isYoutubeUrl(url)) {
    const videoId = getYoutubeVideoId(url);
    if (!videoId) return null;
    const embedUrl = getYoutubeEmbedUrl(videoId);
    // Plain thumbnail image (no YouTube play button, 3-dot, or title overlay)
    const thumbnailUrl = metadata.image ?? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
    return (
      <YouTubeThumbnail
        thumbnailUrl={thumbnailUrl}
        embedUrl={embedUrl}
        watchUrl={url}
        isMobile={isMobile}
        {...(onClose && { onClose })}
        {...(metadata.title !== null && { title: metadata.title })}
      />
    );
  }

  // Default favicon if none provided - only use Google service for proper domains
  const faviconUrl =
    favicon ??
    (hostname.includes('.')
      ? `https://www.google.com/s2/favicons?domain=${hostname}&sz=128`
      : undefined);

  const displayTitle = title
    ? title.length > 80
      ? title.substring(0, 80) + '...'
      : title
    : hostname;

  const handleClose = (event: React.MouseEvent): void => {
    event.stopPropagation();
    onClose?.();
  };

  const handleCopy = (event: React.MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    navigator.clipboard
      .writeText(url)
      .then(() => toast.success('Link copied to clipboard'))
      .catch(() => toast.error('Failed to copy link'));
  };

  return (
    <div
      className='link-preview relative flex flex-col gap-0.5 w-full max-w-[380px] rounded-lg border border-border overflow-hidden bg-card py-1.5 pr-14 pl-2'
      aria-label={`Link preview: ${displayTitle}`}
    >
      <div className='absolute top-1 right-1 z-10 flex items-center gap-1'>
        <button
          type='button'
          className='link-preview__copy-button p-0.5 rounded-full bg-muted hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring'
          onClick={handleCopy}
          aria-label='Copy link'
          title='Copy link'
          data-track-category='MESSAGE'
          data-track-name='COPY_LINK_PREVIEW'
          data-track-metadata={JSON.stringify({ url })}
        >
          <Copy size={12} className='text-muted-foreground' />
        </button>
        {onClose && (
          <button
            type='button'
            className='link-preview__close-button p-0.5 rounded-full bg-muted hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring'
            onClick={handleClose}
            aria-label='Close link preview'
            data-track-category='MESSAGE'
            data-track-name='CLOSE_LINK_PREVIEW'
            data-track-metadata={JSON.stringify({ url })}
          >
            <X size={12} className='text-muted-foreground' />
          </button>
        )}
      </div>

      {/* Line 1: Icon + domain (Slack-style, clickable) */}
      <a
        href={url}
        target='_blank'
        rel='noopener noreferrer'
        className='flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:underline min-w-0 w-fit'
      >
        <span className='flex-shrink-0 w-3.5 h-3.5 rounded overflow-hidden flex items-center justify-center'>
          {faviconUrl ? (
            <img
              src={faviconUrl}
              alt=''
              className='w-full h-full object-contain'
              loading='lazy'
              onError={e => {
                e.currentTarget.style.display = 'none';
                const next = e.currentTarget.nextElementSibling as HTMLElement;
                if (next) next.style.display = 'block';
              }}
            />
          ) : null}
          <ExternalLink
            size={10}
            className='text-muted-foreground'
            style={{ display: faviconUrl ? 'none' : 'block' }}
          />
        </span>
        <span className='truncate'>{hostname}</span>
      </a>

      {/* Line 2: Title (blue, clickable) */}
      <a
        href={url}
        target='_blank'
        rel='noopener noreferrer'
        className='text-sm font-medium text-primary hover:underline truncate block'
        title={title}
      >
        {displayTitle}
      </a>

      {/* Line 3: Description if present */}
      {description && (
        <p className='text-xs text-muted-foreground line-clamp-3' title={description}>
          {description.length > 200 ? description.slice(0, 200) + '...' : description}
        </p>
      )}

      {/* Line 4: OG image if present */}
      {/* Skip images for Bitbucket URLs to avoid showing login page screenshots */}
      {SHOW_PREVIEW_IMAGES && image && !imageError && !isBitbucketUrl(url) && (
        // Fixed 2:1 aspect ratio (OG image standard is 1200×630 ≈ 2:1).
        // Skeleton and image share the same box — no layout shift or flicker.
        <div className='relative w-full mt-1 rounded-xl overflow-hidden aspect-[2/1]'>
          {!imageLoaded && <div className='absolute inset-0 animate-pulse bg-muted' />}
          {/* Always in DOM with eager loading — opacity hides until ready.
              display:none + loading='lazy' prevents the browser fetching the image. */}
          <img
            src={image}
            alt={title ?? ''}
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
            loading='eager'
            referrerPolicy='no-referrer'
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageError(true)}
          />
        </div>
      )}
    </div>
  );
};

/**
 * Memoized LinkPreview component to prevent unnecessary re-renders
 * Only re-renders when props actually change
 */
export const LinkPreview = React.memo(LinkPreviewComponent);
