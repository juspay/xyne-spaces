// ============================================================================
// HTML PREVIEW CARD
// ============================================================================
// Attachment card for .html files that shows a scaled-down glimpse of the
// rendered document instead of a generic file icon.
//
// The document is rendered inside an iframe at a desktop viewport width and
// CSS-scaled down, so the glimpse shows the page's real layout rather than a
// 280px-wide mobile reflow.
// ============================================================================

import React, { useCallback, useState } from 'react';
import { ExternalLinkSquare } from '@xyne/icons';
import { createPreviewUrl } from '../../../services/clients/fileFetchService';
import { useIntersectionObserver } from '../../../hooks/useIntersectionObserver';
import { cn } from '../../../utils/classNames';

const PREVIEW_BACKDROP = '/images/html-preview-bg.jpg';

// Card is a fixed 280px wide (matches the design), so every derived dimension
// below is a constant and no ResizeObserver is needed.
const CARD_WIDTH = 280;
// 214/119 is the design's thumbnail aspect ratio.
const PREVIEW_ASPECT = 214 / 119;
const GLIMPSE_HEIGHT = CARD_WIDTH / PREVIEW_ASPECT;

// The document sits in a smaller sheet floating over the wallpaper, inset from
// the sides and top and bleeding off the bottom edge — so the glimpse reads as
// a page on a desk rather than a cropped screenshot.
const SHEET_INSET_X = 10;
const SHEET_INSET_TOP = 12;
const SHEET_WIDTH = CARD_WIDTH - SHEET_INSET_X * 2;
const SHEET_HEIGHT = GLIMPSE_HEIGHT - SHEET_INSET_TOP;

// The iframe lays out at a desktop viewport width and is scaled down to the
// sheet, so the glimpse shows the document's real layout instead of a narrow
// mobile reflow.
const VIEWPORT_WIDTH = 1120;
const PREVIEW_SCALE = SHEET_WIDTH / VIEWPORT_WIDTH;
const VIEWPORT_HEIGHT = Math.ceil(SHEET_HEIGHT / PREVIEW_SCALE);

// Above this size the glimpse is skipped. The download endpoint buffers the
// whole file server-side and does not support range requests, so a thumbnail
// cannot be built from a partial fetch — the cap is the only guard against a
// scroll-by triggering a very large download. Single-file HTML artifacts inline
// their CSS/JS and routinely run to several MB, so this is set well above the
// typical case rather than at it.
const MAX_GLIMPSE_BYTES = 10 * 1024 * 1024;

/**
 * Neutralize a document before rendering it as a thumbnail.
 *
 * `sandbox` already denies scripting and same-origin access, but it does not
 * stop passive subresource loads. This CSP keeps active content off
 * (`script-src 'none'`) while still allowing styles, images and fonts, so the
 * glimpse looks like the real page — an image-heavy document previewing as a
 * grid of broken boxes is worse than the tracking-pixel risk of loading it,
 * and the full viewer already permits every subresource anyway.
 *
 * Tighten `img-src`/`font-src` to `data:` if scroll-by network egress from
 * attachment content is ever a concern.
 */
const withPreviewCsp = (html: string): string => {
  const csp =
    '<meta http-equiv="Content-Security-Policy" ' +
    `content="default-src 'none'; script-src 'none'; ` +
    `style-src 'unsafe-inline' https:; img-src data: https:; font-src data: https:">`;

  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, match => `${match}${csp}`);
  }
  return `${csp}${html}`;
};

const formatFileSize = (bytes?: number): string => {
  if (!bytes || bytes === 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export interface HtmlPreviewCardProps {
  /** Attachment id used to fetch the document */
  attachmentId: string;
  /** File name shown in the footer */
  fileName: string;
  /** File size in bytes, shown in the footer meta row */
  fileSize?: number;
  /** Opens the full-screen viewer */
  onOpen: () => void;
  /** Custom class name */
  className?: string;
}

/**
 * HtmlPreviewCard Component
 *
 * A file card for HTML attachments that displays:
 * - A scaled, sandboxed render of the document's top edge
 * - Filename, type label and size
 * - An open-in-viewer button
 */
export const HtmlPreviewCard: React.FC<HtmlPreviewCardProps> = ({
  attachmentId,
  fileName,
  fileSize,
  onOpen,
  className,
}) => {
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const tooLarge = fileSize !== undefined && fileSize > MAX_GLIMPSE_BYTES;

  // Fetching is deferred until the card scrolls into view — a channel can hold
  // many HTML attachments and each glimpse is a full file download.
  const loadGlimpse = useCallback(() => {
    if (tooLarge) return;

    void (async (): Promise<void> => {
      try {
        const blob = await createPreviewUrl(attachmentId);
        setHtml(withPreviewCsp(await blob.text()));
      } catch {
        setFailed(true);
      }
    })();
  }, [attachmentId, tooLarge]);

  const cardRef = useIntersectionObserver<HTMLDivElement>(loadGlimpse, {
    threshold: 0.1,
  });

  const showGlimpse = !!html && !failed && !tooLarge;

  return (
    <div
      ref={cardRef}
      className={cn(
        'group w-[280px] max-w-full overflow-hidden rounded-[12px] border border-border bg-muted/30',
        'cursor-pointer transition-colors duration-200 hover:border-input',
        className,
      )}
      onClick={onOpen}
      data-track-category='MESSAGE_ATTACHMENT'
      data-track-name='OPEN_HTML_PREVIEW'
      role='button'
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      {/* Glimpse */}
      <div className='relative w-full overflow-hidden' style={{ aspectRatio: `${PREVIEW_ASPECT}` }}>
        {/* Backdrop, so the sheet reads as a page resting on a surface rather
            than a cropped screenshot. Only a thin frame of it is visible — the
            sheet covers everything but a 10px side and 12px top margin. */}
        <div
          aria-hidden
          className='absolute inset-0 bg-cover bg-center bg-no-repeat'
          style={{ backgroundImage: `url('${PREVIEW_BACKDROP}')` }}
        />

        {/* Document sheet */}
        <div
          className='absolute overflow-hidden rounded-t-[8px] bg-white shadow-[0_2px_8px_rgba(16,24,40,0.16)]'
          style={{
            left: SHEET_INSET_X,
            right: SHEET_INSET_X,
            top: SHEET_INSET_TOP,
            bottom: 0,
          }}
        >
          {showGlimpse ? (
            <iframe
              // `sandbox=''` withholds every capability, including same-origin —
              // the document cannot reach our DOM, cookies or storage. Never add
              // allow-same-origin alongside allow-scripts: that combination lets
              // the frame remove its own sandbox.
              sandbox=''
              srcDoc={html}
              scrolling='no'
              tabIndex={-1}
              aria-hidden
              title={`${fileName} preview`}
              // pointer-events-none keeps the whole card a single click target.
              className='pointer-events-none absolute left-0 top-0 origin-top-left border-0'
              style={{
                width: VIEWPORT_WIDTH,
                height: VIEWPORT_HEIGHT,
                transform: `scale(${PREVIEW_SCALE})`,
              }}
            />
          ) : (
            <div className='absolute inset-0 flex items-center justify-center px-3'>
              <span className='text-center text-[11px] font-medium text-muted-foreground'>
                {failed
                  ? 'Preview unavailable'
                  : tooLarge
                    ? `Too large to preview (${formatFileSize(fileSize)})`
                    : ''}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className='flex w-full items-center gap-[3px] border-t border-border p-3'>
        <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
          <span
            className='truncate text-[15px] font-semibold leading-[1.2] text-foreground'
            title={fileName}
          >
            {fileName}
          </span>
          <span className='flex items-center gap-[3px] text-[13px] font-medium leading-[1.2] text-muted-foreground'>
            <span>HTML</span>
            {!!fileSize && (
              <>
                <span aria-hidden>•</span>
                <span>{formatFileSize(fileSize)}</span>
              </>
            )}
          </span>
        </div>
        <button
          type='button'
          onClick={e => {
            e.stopPropagation();
            onOpen();
          }}
          data-track-category='MESSAGE_ATTACHMENT'
          data-track-name='OPEN_HTML_PREVIEW'
          className='flex shrink-0 items-center justify-center rounded-[6px] p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
          title='Open preview'
          aria-label={`Open ${fileName}`}
        >
          <ExternalLinkSquare className='h-4 w-4' />
        </button>
      </div>
    </div>
  );
};

export default HtmlPreviewCard;
