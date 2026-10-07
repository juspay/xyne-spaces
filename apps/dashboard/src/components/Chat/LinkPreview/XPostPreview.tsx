import React, { useState } from 'react';
import { Copy, ExternalLink, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import type { XPostPreviewData } from '@xyne/shared';

interface XPostPreviewProps {
  metadata: XPostPreviewData;
  onClose?: () => void;
}

/** Collapsed post body length; longer posts get a "Show more" toggle. */
const COLLAPSED_CHARS = 280;

/**
 * Card for x.com / twitter.com status links: author, post text and an AI TLDR.
 *
 * SECURITY: `text` and `tldr` are untrusted (post text is written by strangers and the TLDR is
 * model output over it). Both are rendered strictly as React text nodes — never through the
 * markdown renderer or dangerouslySetInnerHTML — so a crafted post cannot inject links or markup.
 */
const XPostPreviewComponent: React.FC<XPostPreviewProps> = ({ metadata, onClose }) => {
  const { url, author, text, tldr, tldrStatus, unavailable } = metadata;
  const [expanded, setExpanded] = useState(false);

  const handle = (() => {
    try {
      return new URL(url).pathname.split('/').filter(Boolean)[0] ?? null;
    } catch {
      return null;
    }
  })();

  const isLongText = !!text && text.length > COLLAPSED_CHARS;
  const shownText = text && isLongText && !expanded ? `${text.slice(0, COLLAPSED_CHARS).trimEnd()}…` : text;

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
      className='x-post-preview relative flex flex-col gap-1.5 w-full max-w-[460px] rounded-lg border border-border bg-card py-2 pl-3 pr-14'
      aria-label={`X post${author ? ` by ${author}` : ''}`}
      data-testid='x-post-preview'
      data-tldr-status={tldrStatus}
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
          >
            <X size={12} className='text-muted-foreground' />
          </button>
        )}
      </div>

      <a
        href={url}
        target='_blank'
        rel='noopener noreferrer'
        className='flex items-center gap-2 min-w-0 group/xhead'
        data-track-category='MESSAGE'
        data-track-name='OPEN_X_POST_PREVIEW'
      >
        <span
          aria-hidden
          className='flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-foreground text-background text-[11px] font-bold'
        >
          𝕏
        </span>
        <span className='truncate text-sm font-semibold text-foreground group-hover/xhead:underline'>
          {author ?? (handle ? `@${handle}` : 'Post on X')}
        </span>
        {author && handle && <span className='truncate text-xs text-muted-foreground'>@{handle}</span>}
        <ExternalLink size={12} className='shrink-0 text-muted-foreground' />
      </a>

      {unavailable ? (
        <p className='text-sm text-muted-foreground italic'>This post is unavailable. It may have been deleted or made private.</p>
      ) : (
        <>
          {tldrStatus === 'pending' && (
            <div className='flex items-center gap-1.5 text-xs text-muted-foreground' data-testid='x-post-tldr-pending'>
              <Sparkles size={12} className='animate-pulse' />
              <span>Summarising…</span>
            </div>
          )}

          {tldrStatus === 'ready' && tldr && (
            <div className='rounded-md bg-muted/60 px-2 py-1.5' data-testid='x-post-tldr'>
              <div className='mb-0.5 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>
                <Sparkles size={11} />
                <span>AI summary</span>
              </div>
              {/* Plain text only — see SECURITY note above. */}
              <p className='text-sm text-foreground whitespace-pre-line break-words'>{tldr}</p>
            </div>
          )}

          {shownText && (
            <p className='text-sm text-foreground/90 whitespace-pre-line break-words' data-testid='x-post-text'>
              {shownText}
            </p>
          )}

          {isLongText && (
            <button
              type='button'
              className='self-start text-xs font-medium text-primary hover:underline'
              onClick={e => {
                e.stopPropagation();
                setExpanded(v => !v);
              }}
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </>
      )}
    </div>
  );
};

export const XPostPreview = React.memo(XPostPreviewComponent);
XPostPreview.displayName = 'XPostPreview';
