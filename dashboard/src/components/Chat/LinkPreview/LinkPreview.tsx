import React from 'react';
import { ExternalLink, X } from 'lucide-react';

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
const LinkPreviewComponent: React.FC<LinkPreviewProps> = ({ metadata, onClick, onClose }) => {
  const { url, title, siteName, favicon } = metadata;

  // Safe hostname extraction
  const hostname = getHostnameSafely(url);

  if (!hostname) {
    return null;
  }

  // Default favicon if none provided - only use Google service for proper domains
  const faviconUrl =
    favicon ??
    (hostname.includes('.')
      ? `https://www.google.com/s2/favicons?domain=${hostname}&sz=128`
      : undefined);

  // Truncate title to ensure it fits nicely
  const truncatedTitle = title
    ? title.length > 50
      ? title.substring(0, 50) + '...'
      : title
    : null;

  const handleClick = (event: React.MouseEvent): void => {
    // Prevent bubbling if clicking on close button area
    if ((event.target as HTMLElement).closest('.link-preview__close-button')) {
      return;
    }

    if (onClick) {
      onClick();
    } else {
      // Default behavior: open link in new tab with safe URL
      const parsedUrl = parseUrlSafely(url);
      if (parsedUrl) {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    }
  };

  const handleClose = (event: React.MouseEvent): void => {
    event.stopPropagation();
    if (onClose) {
      onClose();
    }
  };

  const handleKeyPress = (event: React.KeyboardEvent): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      // For keyboard events, we don't need the mouse event target checks
      if (onClick) {
        onClick();
      } else {
        // Default behavior: open link in new tab with safe URL
        const parsedUrl = parseUrlSafely(url);
        if (parsedUrl) {
          window.open(url, '_blank', 'noopener,noreferrer');
        }
      }
    } else if (event.key === 'Escape' && onClose) {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className='link-preview relative flex flex-col rounded-2xl border border-[#D3DAE0A8] dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-800 cursor-pointer transition-all duration-200 hover:border-gray-300 dark:hover:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 max-w-3/4 w-full'
      onClick={handleClick}
      role='button'
      tabIndex={0}
      onKeyDown={handleKeyPress}
      aria-label={`Link preview: ${title || hostname}`}
    >
      {/* Close Button */}
      {onClose && (
        <button
          type='button'
          className='link-preview__close-button absolute top-2 right-2 z-10 p-1 rounded-full bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-500'
          onClick={handleClose}
          aria-label='Close link preview'
        >
          <X size={14} className='text-gray-600 dark:text-gray-300' />
        </button>
      )}
      {/* Preview Image Section */}
      {/* {image && (
        <div className='link-preview__image-section p-2 sm:p-3 bg-gray-50 dark:bg-gray-900'>
          <img
            src={image}
            alt={title || 'Link preview image'}
            className='link-preview__image w-full h-auto max-h-[150px] sm:max-h-[200px] object-cover rounded-lg'
            loading='lazy'
            onError={e => {
              // Gracefully hide image section to prevent layout jumps
              const imageSection = e.currentTarget.parentElement;
              if (imageSection) {
                imageSection.classList.add('hidden');
              }
            }}
          />
        </div>
      )} */}

      {/* Metadata Section */}
      <div className='link-preview__metadata flex gap-3 p-3 max-w-[90%]'>
        {/* Favicon */}
        <div className='flex-shrink-0 w-12 h-12 rounded-lg overflow-hidden flex items-center justify-center'>
          {faviconUrl ? (
            <img
              src={faviconUrl}
              alt={siteName || 'Site icon'}
              className='w-full h-full object-contain'
              loading='lazy'
              onError={e => {
                // Hide image and show fallback icon
                e.currentTarget.style.display = 'none';
                const fallbackIcon = e.currentTarget.nextElementSibling as HTMLElement;
                if (fallbackIcon) {
                  fallbackIcon.style.display = 'block';
                }
              }}
            />
          ) : null}
          <ExternalLink
            size={16}
            className='text-gray-500 dark:text-gray-400'
            style={{ display: faviconUrl ? 'none' : 'block' }}
          />
        </div>

        {/* Text Content */}
        <div className='link-preview__content flex-1 min-w-0 flex flex-col justify-center gap-1'>
          {/* Title */}
          <div className='link-preview__title text-sm font-medium leading-tight text-gray-900 dark:text-gray-50 truncate'>
            {truncatedTitle || title || hostname}
          </div>

          {/* Site Name */}
          <div className='link-preview__site-name text-xs leading-tight text-gray-500 dark:text-gray-400 truncate'>
            {siteName || hostname}
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Memoized LinkPreview component to prevent unnecessary re-renders
 * Only re-renders when props actually change
 */
export const LinkPreview = React.memo(LinkPreviewComponent);
