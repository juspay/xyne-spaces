import React, { useState } from 'react';
import { Copy, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import type { XPostPreviewData } from '@xyne/shared';

interface XPostPreviewProps {
  metadata: XPostPreviewData;
  onClose?: () => void;
}

/** Post text longer than this is clamped until the reader expands it. */
const COLLAPSED_TEXT_CHARS = 280;

const formatPostDate = (iso?: string): string | null => {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

/** X logo; lucide has no brand icons. */
const XLogo: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox='0 0 24 24' aria-hidden='true' className={className} fill='currentColor'>
    <path d='M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z' />
  </svg>
);

/**
 * Card for an X (Twitter) post link: author, the post text and — for long posts — an
 * AI-written TLDR that arrives asynchronously.
 *
 * Both the post text and the TLDR are untrusted (third-party content and model output), so
 * they are rendered as plain React text only — never as HTML or markdown.
 */
const XPostPreviewComponent: React.FC<XPostPreviewProps> = ({ metadata, onClose }) => {
  const { url, authorName, authorHandle, text, createdAt, tldr, tldrStatus } = metadata;
  const [expanded, setExpanded] = useState(false);

  const isLong = text.length > COLLAPSED_TEXT_CHARS;
  const shownText = !isLong || expanded ? text : `${text.slice(0, COLLAPSED_TEXT_CHARS).trimEnd()}…`;
  const postDate = formatPostDate(createdAt);
  const showTldr = tldrStatus === 'pending' || (tldrStatus === 'ready' && !!tldr);

  const handleCopy = (event: React.MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    navigator.clipboard
      .writeText(url)
      .then(() => toast.success('Link copied to clipboard'))
      .catch(() => toast.error('Failed to copy link'));
  };

  const handleClose = (event: React.MouseEvent): void => {
    event.stopPropagation();
    onClose?.();
  };

  return (
    <div
      className='x-post-preview relative flex flex-col gap-1.5 w-full max-w-[460px] rounded-lg border border-border bg-card px-3 py-2'
      aria-label={`X post by @${authorHandle}`}
      data-testid='x-post-preview'
    >
      <div className='absolute top-1 right-1 z-10 flex items-center gap-1'>
        <button
          type='button'
          className='p-0.5 rounded-full bg-muted hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring'
          onClick={handleCopy}
          aria-label='Copy link'
          title='Copy link'
          data-track-category='MESSAGE'
          data-track-name='COPY_X_POST_PREVIEW'
        >
          <Copy size={12} className='text-muted-foreground' />
        </button>
        {onClose && (
          <button
            type='button'
            className='p-0.5 rounded-full bg-muted hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring'
            onClick={handleClose}
            aria-label='Close link preview'
            data-track-category='MESSAGE'
            data-track-name='CLOSE_X_POST_PREVIEW'
          >
            <X size={12} className='text-muted-foreground' />
          </button>
        )}
      </div>

      <a
        href={url}
        target='_blank'
        rel='noopener noreferrer'
        className='flex items-center gap-1.5 pr-12 text-xs text-muted-foreground hover:text-foreground min-w-0 w-fit'
      >
        <XLogo className='w-3.5 h-3.5 flex-shrink-0 text-foreground' />
        <span className='font-semibold text-foreground truncate'>{authorName}</span>
        <span className='truncate'>@{authorHandle}</span>
        {postDate && <span className='flex-shrink-0'>· {postDate}</span>}
      </a>

      {showTldr && (
        <div
          className='rounded-md border border-border bg-muted/50 px-2 py-1.5'
          data-testid='x-post-tldr'
          aria-live='polite'
        >
          <div className='flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>
            <Sparkles size={11} />
            <span>AI summary</span>
          </div>
          {tldrStatus === 'ready' ? (
            <p className='mt-0.5 text-sm text-foreground whitespace-pre-line break-words'>{tldr}</p>
          ) : (
            <div className='mt-1 flex flex-col gap-1' aria-label='Summarising post'>
              <span className='h-2.5 w-11/12 rounded bg-muted animate-pulse' />
              <span className='h-2.5 w-2/3 rounded bg-muted animate-pulse' />
            </div>
          )}
        </div>
      )}

      <p className='text-sm text-foreground/90 whitespace-pre-line break-words'>{shownText}</p>
      {isLong && (
        <button
          type='button'
          className='w-fit text-xs text-muted-foreground hover:text-foreground hover:underline'
          onClick={event => {
            event.stopPropagation();
            setExpanded(value => !value);
          }}
          data-track-category='MESSAGE'
          data-track-name='TOGGLE_X_POST_TEXT'
        >
          {expanded ? 'Show less' : 'Show full post'}
        </button>
      )}
    </div>
  );
};

export const XPostPreview = React.memo(XPostPreviewComponent);
