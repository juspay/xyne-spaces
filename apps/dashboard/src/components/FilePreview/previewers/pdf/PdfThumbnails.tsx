import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '../../../../utils/classNames';

/** A thumbnail's width on screen. */
const THUMB_WIDTH = 112;
/** Room round a thumbnail: its padding and the page number under it. */
const THUMB_CHROME = 38;
/** Thumbnails drawn at once: the worker is shared with the pages themselves. */
const DRAWING_AT_ONCE = 2;

interface Job {
  key: string;
  page: number;
  rotation: number;
  resolve: (url: string) => void;
  reject: (error: unknown) => void;
  cancelled: boolean;
}

/**
 * Draws pages small, a couple at a time, the one asked for last first — the list in
 * view now, not the pages scrolled past — and keeps each drawn for as long as the
 * document is open.
 */
class ThumbnailDrawer {
  private readonly drawn = new Map<string, string>();
  private readonly waiting: Job[] = [];
  private running = 0;
  private readonly pdf: PDFDocumentProxy;

  constructor(pdf: PDFDocumentProxy) {
    this.pdf = pdf;
  }

  drawnAlready(page: number, rotation: number): string | undefined {
    return this.drawn.get(`${page}:${rotation}`);
  }

  request(page: number, rotation: number): { promise: Promise<string>; cancel: () => void } {
    let job: Job | null = null;
    const promise = new Promise<string>((resolve, reject) => {
      job = { key: `${page}:${rotation}`, page, rotation, resolve, reject, cancelled: false };
      this.waiting.push(job);
    });
    this.pump();
    return {
      promise,
      cancel: () => {
        if (job) job.cancelled = true;
      },
    };
  }

  private pump(): void {
    while (this.running < DRAWING_AT_ONCE) {
      const job = this.waiting.pop();
      if (!job) return;
      if (job.cancelled) continue;
      this.running += 1;
      void this.draw(job)
        .then(job.resolve, job.reject)
        .finally(() => {
          this.running -= 1;
          this.pump();
        });
    }
  }

  private async draw(job: Job): Promise<string> {
    const done = this.drawn.get(job.key);
    if (done) return done;
    const page = await this.pdf.getPage(job.page);
    const rotation = (page.rotate + job.rotation) % 360;
    const unscaled = page.getViewport({ scale: 1, rotation });
    const viewport = page.getViewport({
      scale: (THUMB_WIDTH * window.devicePixelRatio) / unscaled.width,
      rotation,
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport }).promise;
    const url = canvas.toDataURL('image/jpeg', 0.85);
    this.drawn.set(job.key, url);
    return url;
  }
}

function Thumbnail(props: {
  drawer: ThumbnailDrawer;
  page: number;
  rotation: number;
  /** Height over width, for the space it holds before it is drawn. */
  aspect: number;
  current: boolean;
  onSelect: (page: number) => void;
}): ReactElement {
  const { drawer, page, rotation } = props;
  const [url, setUrl] = useState(() => drawer.drawnAlready(page, rotation) ?? null);

  useEffect(() => {
    const done = drawer.drawnAlready(page, rotation);
    if (done) {
      setUrl(done);
      return;
    }
    setUrl(null);
    const job = drawer.request(page, rotation);
    job.promise.then(setUrl, () => undefined);
    return job.cancel;
  }, [drawer, page, rotation]);

  return (
    <button
      type='button'
      onClick={() => props.onSelect(page)}
      aria-label={`Page ${page}`}
      aria-current={props.current ? 'page' : undefined}
      className='group flex w-full flex-col items-center gap-1.5 rounded-md px-3 py-2 outline-none focus-visible:bg-foreground/[0.06]'
      data-track-category='FilePreview'
      data-track-name='PdfThumbnailSelected'
    >
      <span
        className={cn(
          'block overflow-hidden rounded-[3px] bg-white shadow-sm ring-1 transition-shadow',
          props.current ? 'ring-2 ring-primary' : 'ring-black/10 group-hover:ring-black/25',
        )}
        style={{ width: THUMB_WIDTH, ...(!url && { height: THUMB_WIDTH * props.aspect }) }}
      >
        {url ? (
          <img src={url} alt='' draggable={false} className='block h-auto w-full' />
        ) : (
          <span className='block size-full animate-pulse bg-muted/60 motion-reduce:animate-none' />
        )}
      </span>
      <span
        className={cn(
          'text-[11px] tabular-nums',
          props.current ? 'font-medium text-foreground' : 'text-muted-foreground',
        )}
      >
        {page}
      </span>
    </button>
  );
}

/**
 * The document's pages, small, down the side: the one in view marked and kept in
 * view as the pages scroll; a click goes to a page. Only the thumbnails in sight are
 * on the page, so a thousand-page document costs what a ten-page one does.
 */
export function PdfThumbnails(props: {
  pdf: PDFDocumentProxy;
  page: number;
  rotation: number;
  /** The first page's height over its width: every page's until it is drawn. */
  aspect: number;
  onSelect: (page: number) => void;
}): ReactElement {
  const { pdf, page } = props;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const drawer = useMemo(() => new ThumbnailDrawer(pdf), [pdf]);
  const virtualizer = useVirtualizer({
    count: pdf.numPages,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => Math.round(THUMB_WIDTH * props.aspect) + THUMB_CHROME,
    overscan: 3,
  });

  // The page in view stays in sight as the document scrolls.
  useEffect(() => {
    virtualizer.scrollToIndex(page - 1, { align: 'auto' });
  }, [page, virtualizer]);

  return (
    <nav
      aria-label='Pages'
      className='flex h-full w-[148px] shrink-0 flex-col border-r border-border bg-background'
    >
      <div ref={scrollRef} className='scrollbar-thin min-h-0 flex-1 overflow-y-auto py-1.5'>
        <div className='relative w-full' style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map(item => (
            <div
              key={item.key}
              ref={virtualizer.measureElement}
              data-index={item.index}
              className='absolute inset-x-0 top-0'
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <Thumbnail
                drawer={drawer}
                page={item.index + 1}
                rotation={props.rotation}
                aspect={props.aspect}
                current={item.index + 1 === page}
                onSelect={props.onSelect}
              />
            </div>
          ))}
        </div>
      </div>
    </nav>
  );
}
