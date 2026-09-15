import React, { useState } from 'react';
import { ExternalLink, Play, X, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { SiYoutube } from 'react-icons/si';

const YOUTUBE_HOME = 'https://www.youtube.com';

export interface YouTubeThumbnailProps {
  thumbnailUrl: string;
  embedUrl: string;
  watchUrl: string;
  title?: string;
  onClose?: () => void;
  isMobile?: boolean;
}

/** YouTube: clickable title + thumbnail with play / external */
export const YouTubeThumbnail: React.FC<YouTubeThumbnailProps> = ({
  thumbnailUrl,
  embedUrl,
  watchUrl,
  title,
  onClose,
  isMobile,
}) => {
  const [showPlayer, setShowPlayer] = useState(false);
  const displayTitle =
    title && title.length > 70 ? title.slice(0, 70) + '...' : title || 'YouTube video';

  const handleCopy = (event: React.MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    navigator.clipboard
      .writeText(watchUrl)
      .then(() => toast.success('Link copied to clipboard'))
      .catch(() => toast.error('Failed to copy link'));
  };

  return (
    <div
      className='relative w-full max-w-[360px] md:max-w-[420px] lg:max-w-[480px] flex flex-col gap-1.5'
      role='article'
      aria-label='YouTube video'
    >
      <div className='absolute top-0 right-0 z-10 flex items-center gap-1 bg-card/80 backdrop-blur-sm rounded-full p-0.5'>
        <button
          type='button'
          className='p-1 text-muted-foreground hover:text-foreground focus:outline-none focus:ring-0'
          onClick={handleCopy}
          aria-label='Copy link'
          title='Copy link'
          data-track-category='LINK_PREVIEW'
          data-track-name='CopyYouTubeLink'
          data-track-metadata={JSON.stringify({ title, watchUrl })}
        >
          <Copy size={14} className='text-current' />
        </button>
        {onClose && (
          <button
            type='button'
            className='p-1 text-muted-foreground hover:text-foreground focus:outline-none focus:ring-0'
            onClick={e => {
              e.stopPropagation();
              onClose();
            }}
            aria-label='Close link preview'
            data-track-category='LINK_PREVIEW'
            data-track-name='CloseYouTubeThumbnail'
            data-track-metadata={JSON.stringify({ title, watchUrl })}
          >
            <X size={14} className='text-current' />
          </button>
        )}
      </div>
      <a
        href={YOUTUBE_HOME}
        target='_blank'
        rel='noopener noreferrer'
        className='flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground hover:underline w-fit'
      >
        <SiYoutube size={18} className='flex-shrink-0 text-[#FF0000]' aria-hidden />
        <span>YouTube</span>
      </a>

      <a
        href={watchUrl}
        target='_blank'
        rel='noopener noreferrer'
        className='text-sm font-medium text-primary hover:underline truncate block pr-16'
        title={title}
      >
        {displayTitle}
      </a>

      {/* Thumbnail + play / external */}
      <div className='relative w-full aspect-video rounded-2xl border border-border overflow-hidden bg-black max-h-[202px] md:max-h-[236px] lg:max-h-[270px]'>
        {isMobile ? (
          // Mobile: no inline play, no overlay controls. Tap thumbnail -> open YouTube.
          <a
            href={watchUrl}
            target='_blank'
            rel='noopener noreferrer'
            className='absolute inset-0'
            aria-label='Open on YouTube'
          >
            <img src={thumbnailUrl} alt='' className='w-full h-full object-cover' />
          </a>
        ) : !showPlayer ? (
          <>
            <img
              src={thumbnailUrl}
              alt=''
              className='absolute inset-0 w-full h-full object-cover'
            />

            <div className='absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[1]'>
              <div className='flex items-center gap-1 md:gap-1.5 lg:gap-2 rounded-xl md:rounded-2xl lg:rounded-3xl bg-black/40 shadow-lg p-1.5 md:p-2 lg:py-3 lg:px-6'>
                <button
                  type='button'
                  onClick={() => setShowPlayer(true)}
                  aria-label='Play video'
                  className='group flex items-center justify-center h-12 w-12 md:h-14 md:w-14 lg:h-20 lg:w-20 rounded-lg md:rounded-xl lg:rounded-2xl text-muted hover:text-white focus:outline-none focus:ring-0 transition-colors'
                  data-track-category='LINK_PREVIEW'
                  data-track-name='PlayYouTubeVideo'
                  data-track-metadata={JSON.stringify({ title, watchUrl })}
                >
                  <Play className='text-current w-6 h-6 md:w-7 md:h-7 lg:w-10 lg:h-10' />
                </button>
                <a
                  href={watchUrl}
                  target='_blank'
                  rel='noopener noreferrer'
                  onClick={(e: React.MouseEvent) => e.stopPropagation()}
                  aria-label='Open on YouTube'
                  title='Open on YouTube'
                  className='group flex items-center justify-center h-12 w-12 md:h-14 md:w-14 lg:h-20 lg:w-20 rounded-lg md:rounded-xl lg:rounded-2xl text-muted hover:text-white focus:outline-none focus:ring-0 transition-colors'
                  data-track-category='LINK_PREVIEW'
                  data-track-name='OpenOnYouTube'
                  data-track-metadata={JSON.stringify({ title, watchUrl })}
                >
                  <ExternalLink className='text-current w-6 h-6 md:w-7 md:h-7 lg:w-10 lg:h-10' />
                </a>
              </div>
            </div>
          </>
        ) : (
          <iframe
            src={`${embedUrl}${embedUrl.includes('?') ? '&' : '?'}autoplay=1`}
            title='YouTube video'
            className='absolute inset-0 w-full h-full'
            allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
            allowFullScreen
          />
        )}
      </div>
    </div>
  );
};
