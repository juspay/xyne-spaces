import React from 'react';
import { ExternalLink, X } from 'lucide-react';
import { getYoutubeEmbedUrl, getYoutubeVideoId, isYoutubeUrl } from './youtubeUtils';
import { usePlatform } from '../../../hooks/usePlatform';
import { YouTubeThumbnail } from './YouTubeThumbnail';

export interface LinkMetadata {
  url: string;
  title?: string;
  description?: string;
  siteName?: string;
  image?: string;
  favicon?: string;
}

interface LinkPreviewProps {
  metadata: LinkMetadata;
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
  const { url, title, description, favicon } = metadata;
  const { isMobile } = usePlatform();

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

  return (
    <div
      className='link-preview relative flex flex-col gap-1 max-w-3/4 w-full rounded-2xl border border-[#D3DAE0A8] dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-800 py-2 pr-8 pl-3'
      aria-label={`Link preview: ${displayTitle}`}
    >
      {onClose && (
        <button
          type='button'
          className='link-preview__close-button absolute top-2 right-2 z-10 p-1 rounded-full bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-gray-400'
          onClick={handleClose}
          aria-label='Close link preview'
        >
          <X size={14} className='text-gray-600 dark:text-gray-300' />
        </button>
      )}

      {/* Line 1: Icon + domain (Slack-style, clickable) */}
      <a
        href={url}
        target='_blank'
        rel='noopener noreferrer'
        className='flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:underline min-w-0 w-fit'
      >
        <span className='flex-shrink-0 w-5 h-5 rounded overflow-hidden flex items-center justify-center'>
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
            size={14}
            className='text-gray-500 dark:text-gray-400'
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
        className='text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline truncate block'
        title={title}
      >
        {displayTitle}
      </a>

      {/* Line 3: Description if present */}
      {description && (
        <p className='text-xs text-gray-500 dark:text-gray-400 line-clamp-3' title={description}>
          {description.length > 200 ? description.slice(0, 200) + '...' : description}
        </p>
      )}
    </div>
  );
};

/**
 * Memoized LinkPreview component to prevent unnecessary re-renders
 * Only re-renders when props actually change
 */
export const LinkPreview = React.memo(LinkPreviewComponent);
