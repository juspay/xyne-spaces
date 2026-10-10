import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
// pdf.js before its viewer: the viewer reads the library from where pdf.js leaves it.
import {
  AnnotationEditorType,
  AnnotationMode,
  PasswordResponses,
  type PDFDocumentProxy,
} from 'pdfjs-dist';
import { EventBus, LinkTarget, PDFLinkService, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
import pdfViewerCss from 'pdfjs-dist/web/pdf_viewer.css?inline';
import {
  Check,
  ChevronDown,
  FileWarning,
  Lock,
  Minus,
  PanelLeft,
  Plus,
  RotateCw,
} from 'lucide-react';
import { useMountedStylesheet } from '../../../hooks/useMountedStylesheet';
import { getAttachmentStreamUrl } from '../../../services/clients/apiClient';
import { cn } from '../../../utils/classNames';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import {
  PreviewButton,
  PreviewControls,
  PreviewMessage,
  PreviewMeta,
  PreviewSkeletonView,
  usePreviewDownload,
  usePreviewFind,
} from '../chrome';
import type { PreviewerProps } from '../types';
import { createPdfFinder, PDF_CURRENT, PDF_MATCHES, type PdfFinder } from './pdf/pdfFind';
import { openPdf } from './pdf/pdfjs';
import { PdfThumbnails } from './pdf/PdfThumbnails';

/**
 * The pages as cards on the pane, and find's marks as tints: the text layer lies over
 * the page's drawing, so the app's opaque find colours would hide the words they mark.
 */
const VIEWER_STYLES = `
.xyne-pdf .pdfViewer { --page-margin: 0 auto 16px; --page-border: none; padding-top: 16px; }
.xyne-pdf .pdfViewer .page {
  border-image: none;
  border-radius: 2px;
  box-shadow: 0 0 0 1px rgb(0 0 0 / 0.06), 0 1px 3px rgb(0 0 0 / 0.1), 0 6px 16px rgb(0 0 0 / 0.06);
}
::highlight(${PDF_MATCHES}) { background-color: rgb(250 204 21 / 0.45); color: transparent; }
::highlight(${PDF_CURRENT}) { background-color: rgb(249 115 22 / 0.6); color: transparent; }
`;

/** The viewer's own fitted zooms; any other is a scale. */
const FITS = [
  { value: 'auto', label: 'Automatic' },
  { value: 'page-width', label: 'Fit width' },
  { value: 'page-fit', label: 'Fit page' },
] as const;
const LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const;
/** pdf.js's own limits, which it holds every zoom to. */
const MIN_SCALE = 0.1;
const MAX_SCALE = 10;
/** The most one wheel event zooms by. */
const WHEEL_MAX_STEP = 1.15;
/** Whether the page list was last shown or hidden, for the next PDF opened. */
const THUMBNAILS_KEY = 'xyne-pdf-thumbnails';
/** Below this the pane has no room for the page list beside the page. */
const THUMBNAILS_MIN_WIDTH = 560;
/** Wider than this, and with a few pages, the list shows until it's put away. */
const THUMBNAILS_DEFAULT_WIDTH = 960;

type Status =
  | { kind: 'loading'; progress: number | null }
  | { kind: 'password'; wrong: boolean }
  | { kind: 'ready' }
  | { kind: 'failed'; damaged: boolean };

function savedThumbnailsChoice(): boolean | null {
  try {
    const saved = localStorage.getItem(THUMBNAILS_KEY);
    return saved === '1' ? true : saved === '0' ? false : null;
  } catch {
    return null;
  }
}

function PasswordPrompt(props: {
  wrong: boolean;
  onSubmit: (password: string) => void;
}): ReactElement {
  const [password, setPassword] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => inputRef.current?.focus(), []);
  return (
    <div className='absolute inset-0 flex items-center justify-center bg-background px-6'>
      <form
        onSubmit={event => {
          event.preventDefault();
          if (password) props.onSubmit(password);
        }}
        className='flex w-full max-w-[300px] flex-col items-center text-center'
      >
        <span className='mb-4 flex size-10 items-center justify-center rounded-full bg-muted'>
          <Lock className='size-[18px] text-muted-foreground' />
        </span>
        <h3 className='text-[15px] font-semibold text-foreground'>
          This PDF is password protected
        </h3>
        <p className='mt-1 text-[13px] text-muted-foreground'>Enter its password to open it.</p>
        <input
          ref={inputRef}
          type='password'
          value={password}
          onChange={event => setPassword(event.target.value)}
          placeholder='Password'
          aria-label='Password'
          data-track-category='FilePreview'
          data-track-name='PdfPasswordTyped'
          aria-invalid={props.wrong}
          className={cn(
            'mt-4 h-9 w-full rounded-lg border bg-background px-3 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:ring-1',
            props.wrong
              ? 'border-destructive focus:ring-destructive'
              : 'border-border focus:ring-ring',
          )}
        />
        {props.wrong && (
          <p role='alert' className='mt-2 text-xs text-destructive'>
            That password isn&apos;t right. Try again.
          </p>
        )}
        <button
          type='submit'
          disabled={!password}
          className='outline-none mt-4 h-8 w-full rounded-lg bg-foreground text-[13px] font-medium text-background transition-opacity hover:opacity-90 focus-visible:opacity-90 disabled:pointer-events-none disabled:opacity-40'
          data-track-category='FilePreview'
          data-track-name='PdfPasswordSubmitted'
        >
          Open
        </button>
      </form>
    </div>
  );
}

/**
 * A PDF, drawn by pdf.js's own viewer — every page measured from the file, only those
 * near the view drawn, its text selectable and searchable, its links live — and fetched
 * a piece at a time, so a long scan opens at once. Zoom from the toolbar, with ⌘ or Ctrl
 * and + − 0, or by pinching and ⌘-scrolling about the pointer; it fits itself to the
 * pane until zoomed by hand. The pages, small, down the side; turn them a quarter at a
 * time. A password-protected file asks for its password.
 */
export default function PdfPreview(props: PreviewerProps): ReactElement {
  useMountedStylesheet(pdfViewerCss);
  useMountedStylesheet(VIEWER_STYLES);
  const download = usePreviewDownload();
  const fileId = props.file.id;

  const paneRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pagesRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<PDFViewer | null>(null);
  const finderRef = useRef<PdfFinder | null>(null);
  const passwordRef = useRef<((password: string) => void) | null>(null);

  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<Status>({ kind: 'loading', progress: null });
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pagesShown, setPagesShown] = useState(false);
  const [page, setPage] = useState(1);
  const [pageDraft, setPageDraft] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [scaleValue, setScaleValue] = useState('auto');
  const [rotation, setRotation] = useState(0);
  const [aspect, setAspect] = useState(11 / 8.5);
  const [paneWidth, setPaneWidth] = useState(0);
  const [thumbnailsChoice, setThumbnailsChoice] = useState(savedThumbnailsChoice);

  // One viewer per file (and per retry), torn down with it.
  useEffect(() => {
    const container = containerRef.current;
    const pages = pagesRef.current;
    if (!container || !pages) return;
    setStatus({ kind: 'loading', progress: null });
    setPdf(null);
    setPagesShown(false);
    setPage(1);
    setRotation(0);

    const eventBus = new EventBus();
    const linkService = new PDFLinkService({
      eventBus,
      externalLinkTarget: LinkTarget.BLANK,
      externalLinkRel: 'noopener noreferrer nofollow',
    });
    const viewer = new PDFViewer({
      container,
      viewer: pages,
      eventBus,
      linkService,
      // The text layer whatever the file's permissions say: it is what find searches.
      textLayerMode: 1,
      annotationMode: AnnotationMode.ENABLE,
      annotationEditorMode: AnnotationEditorType.DISABLE,
    });
    linkService.setViewer(viewer);
    viewerRef.current = viewer;

    eventBus.on('pagesinit', () => {
      viewer.currentScaleValue = 'auto';
      setPagesShown(true);
    });
    eventBus.on('pagechanging', (event: { pageNumber: number }) => setPage(event.pageNumber));
    eventBus.on('scalechanging', (event: { scale: number }) => {
      setScale(event.scale);
      setScaleValue(viewer.currentScaleValue);
    });
    eventBus.on('rotationchanging', (event: { pagesRotation: number }) =>
      setRotation(event.pagesRotation),
    );
    eventBus.on('textlayerrendered', (event: { pageNumber: number }) =>
      finderRef.current?.pageTextDrawn(event.pageNumber),
    );

    let cancelled = false;
    const task = openPdf(getAttachmentStreamUrl(fileId));
    task.onPassword = (update: (password: string) => void, reason: number) => {
      if (cancelled) return;
      passwordRef.current = update;
      setStatus({ kind: 'password', wrong: reason === PasswordResponses.INCORRECT_PASSWORD });
    };
    task.onProgress = (progress: { loaded: number; total: number }) => {
      if (cancelled) return;
      setStatus(current =>
        current.kind === 'loading'
          ? {
              kind: 'loading',
              progress: progress.total > 0 ? Math.min(1, progress.loaded / progress.total) : null,
            }
          : current,
      );
    };
    task.promise.then(
      async document => {
        // Every page holds the first's shape until it is drawn, as the viewer's do.
        const first = await document.getPage(1);
        if (cancelled) return;
        const shape = first.getViewport({ scale: 1 });
        setAspect(shape.height / shape.width);
        viewer.setDocument(document);
        linkService.setDocument(document);
        setPdf(document);
        setStatus({ kind: 'ready' });
      },
      (error: unknown) => {
        if (cancelled) return;
        // A file that isn't a PDF, or is broken, against one that didn't arrive.
        const damaged = error instanceof Error && error.name === 'InvalidPDFException';
        setStatus({ kind: 'failed', damaged });
      },
    );

    return () => {
      cancelled = true;
      passwordRef.current = null;
      viewerRef.current = null;
      viewer.cleanup();
      void task.destroy();
    };
  }, [fileId, attempt]);

  const finder = useMemo(
    () =>
      pdf
        ? createPdfFinder({
            document: pdf,
            root: () => containerRef.current,
            showPage: pageNumber => viewerRef.current?.scrollPageIntoView({ pageNumber }),
          })
        : null,
    [pdf],
  );
  useEffect(() => {
    finderRef.current = finder;
    return () => {
      finderRef.current = null;
      finder?.clear();
    };
  }, [finder]);
  usePreviewFind(finder);

  // A fitted zoom fits again as the pane changes — the list opening beside it, the
  // window resized; a zoom set by hand stays.
  useEffect(() => {
    const pane = paneRef.current;
    const container = containerRef.current;
    if (!pane || !container) return;
    const observer = new ResizeObserver(() => {
      setPaneWidth(pane.clientWidth);
      const viewer = viewerRef.current;
      const fit = viewer?.currentScaleValue;
      if (viewer?.pdfDocument && fit && FITS.some(option => option.value === fit)) {
        viewer.currentScaleValue = fit;
      }
    });
    observer.observe(pane);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const zoomTo = useCallback((value: string) => {
    const viewer = viewerRef.current;
    if (viewer?.pdfDocument) viewer.currentScaleValue = value;
  }, []);
  const zoomBy = useCallback((steps: number) => {
    const viewer = viewerRef.current;
    if (!viewer?.pdfDocument) return;
    if (steps > 0) viewer.increaseScale();
    else viewer.decreaseScale();
  }, []);

  // Pinching, or ⌘ / Ctrl and the wheel, zooms about the pointer; ⌘ / Ctrl and + − 0
  // zoom from the keyboard while the pages have focus, in place of the app's own zoom.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Wheel steps are small; the viewer zooms in hundredths, so they are gathered.
    let gathered = 1;
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const viewer = viewerRef.current;
      if (!viewer?.pdfDocument) return;
      const perUnit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 0.05 : 0.01;
      // A pinch arrives as many small steps; a mouse wheel's notch as one large one,
      // held to about a toolbar step.
      gathered *= Math.min(
        WHEEL_MAX_STEP,
        Math.max(1 / WHEEL_MAX_STEP, Math.exp(-event.deltaY * perUnit)),
      );
      if (Math.abs(gathered - 1) < 0.02) return;
      viewer.updateScale({
        scaleFactor: gathered,
        origin: [event.clientX, event.clientY],
        drawingDelay: 250,
      });
      gathered = 1;
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key === '=' || event.key === '+') zoomBy(1);
      else if (event.key === '-') zoomBy(-1);
      else if (event.key === '0') zoomTo('auto');
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    container.addEventListener('keydown', onKeyDown);
    return () => {
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('keydown', onKeyDown);
    };
  }, [zoomBy, zoomTo]);

  const goToPage = useCallback((pageNumber: number) => {
    const viewer = viewerRef.current;
    if (!viewer?.pdfDocument) return;
    viewer.currentPageNumber = Math.min(Math.max(1, pageNumber), viewer.pagesCount);
  }, []);
  const commitPageDraft = (): void => {
    if (pageDraft === null) return;
    const wanted = Number.parseInt(pageDraft, 10);
    if (Number.isFinite(wanted)) goToPage(wanted);
    setPageDraft(null);
  };

  const pageCount = pdf?.numPages ?? 0;
  const thumbnailsOpen =
    pageCount > 1 &&
    paneWidth >= THUMBNAILS_MIN_WIDTH &&
    (thumbnailsChoice ?? (paneWidth >= THUMBNAILS_DEFAULT_WIDTH && pageCount >= 3));
  const toggleThumbnails = (): void => {
    const next = !thumbnailsOpen;
    setThumbnailsChoice(next);
    try {
      localStorage.setItem(THUMBNAILS_KEY, next ? '1' : '0');
    } catch {
      // The choice holds for this file alone.
    }
  };

  const ready = status.kind === 'ready' && pdf !== null;
  return (
    <div ref={paneRef} className='flex h-full min-h-0'>
      {ready && (
        <>
          <PreviewMeta>
            {pageCount.toLocaleString()} {pageCount === 1 ? 'page' : 'pages'}
          </PreviewMeta>
          <PreviewControls>
            <div className='flex items-center gap-1 px-1 text-xs tabular-nums text-muted-foreground'>
              <input
                value={pageDraft ?? String(page)}
                onFocus={event => {
                  setPageDraft(String(page));
                  event.currentTarget.select();
                }}
                onChange={event => setPageDraft(event.target.value.replace(/\D/g, ''))}
                onBlur={commitPageDraft}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    commitPageDraft();
                    event.currentTarget.blur();
                  } else if (event.key === 'Escape') {
                    setPageDraft(null);
                    event.currentTarget.blur();
                  }
                }}
                inputMode='numeric'
                aria-label={`Go to page, of ${pageCount}`}
                className='h-6 w-9 rounded-md bg-foreground/[0.06] text-center text-xs text-foreground outline-none focus:ring-1 focus:ring-ring'
                data-track-category='FilePreview'
                data-track-name='PdfPageTyped'
              />
              <span>/ {pageCount.toLocaleString()}</span>
            </div>
            <span aria-hidden='true' className='mx-1 h-4 w-px shrink-0 bg-border' />
            <PreviewButton
              title='Zoom out (⌘−)'
              onClick={() => zoomBy(-1)}
              disabled={scale <= MIN_SCALE}
              trackName='PreviewZoomedOut'
            >
              <Minus className='size-4' />
            </PreviewButton>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type='button'
                  title='Zoom'
                  aria-label={`Zoom level, ${Math.round(scale * 100)}%`}
                  className='outline-none flex h-7 min-w-[64px] items-center justify-center gap-0.5 rounded-md px-1.5 text-xs tabular-nums text-muted-foreground transition-colors hover:bg-foreground/[0.08] focus-visible:bg-foreground/[0.08] hover:text-foreground focus-visible:text-foreground data-[state=open]:bg-foreground/[0.08] data-[state=open]:text-foreground'
                  data-track-category='FilePreview'
                  data-track-name='PdfZoomMenuOpened'
                >
                  {Math.round(scale * 100)}%
                  <ChevronDown className='size-3 opacity-60' />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end' className='w-40'>
                {[
                  ...FITS,
                  ...LEVELS.map(level => ({ value: String(level), label: `${level * 100}%` })),
                ].map((option, index) => (
                  <ZoomOption
                    key={option.value}
                    label={option.label}
                    checked={scaleValue === option.value}
                    separated={index === FITS.length}
                    onSelect={() => zoomTo(option.value)}
                  />
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <PreviewButton
              title='Zoom in (⌘+)'
              onClick={() => zoomBy(1)}
              disabled={scale >= MAX_SCALE}
              trackName='PreviewZoomedIn'
            >
              <Plus className='size-4' />
            </PreviewButton>
            <PreviewButton
              title='Rotate'
              onClick={() => {
                const viewer = viewerRef.current;
                if (viewer?.pdfDocument) viewer.pagesRotation = (viewer.pagesRotation + 90) % 360;
              }}
              trackName='PreviewRotated'
            >
              <RotateCw className='size-4' />
            </PreviewButton>
          </PreviewControls>
          {pageCount > 1 && (
            <PreviewControls atEnd>
              <span aria-hidden='true' className='mx-1 h-4 w-px shrink-0 bg-border' />
              <PreviewButton
                title={thumbnailsOpen ? 'Hide pages' : 'Show pages'}
                pressed={thumbnailsOpen}
                onClick={toggleThumbnails}
                disabled={paneWidth < THUMBNAILS_MIN_WIDTH}
                trackName='PdfThumbnailsToggled'
              >
                <PanelLeft className='size-4' />
              </PreviewButton>
            </PreviewControls>
          )}
        </>
      )}
      {ready && thumbnailsOpen && (
        <PdfThumbnails
          pdf={pdf}
          page={page}
          rotation={rotation}
          aspect={rotation % 180 === 0 ? aspect : 1 / aspect}
          onSelect={goToPage}
        />
      )}
      <div className='relative min-w-0 flex-1 bg-muted/40'>
        {/* pdf.js wants its scrolling box placed absolutely, the pages in a box of
          their own inside it. Focusable, so the keyboard scrolls and zooms it. */}
        <div
          ref={containerRef}
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrolling region the keyboard must reach
          tabIndex={0}
          className='xyne-pdf absolute inset-0 overflow-auto outline-none'
        >
          <div ref={pagesRef} className='pdfViewer' />
        </div>
        {status.kind === 'loading' && status.progress !== null && (
          <div className='absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden'>
            <div
              className='h-full bg-primary transition-[width] duration-200 ease-out'
              style={{ width: `${Math.round(status.progress * 100)}%` }}
            />
          </div>
        )}
        {!pagesShown && (status.kind === 'loading' || status.kind === 'ready') && (
          <div className='absolute inset-0 bg-background'>
            <PreviewSkeletonView shape='document' />
          </div>
        )}
        {status.kind === 'password' && (
          <PasswordPrompt
            wrong={status.wrong}
            onSubmit={password => {
              passwordRef.current?.(password);
              setStatus({ kind: 'loading', progress: null });
            }}
          />
        )}
        {status.kind === 'failed' && (
          <div className='absolute inset-0 bg-background'>
            <PreviewMessage
              icon={<FileWarning className='size-10 text-muted-foreground' />}
              title={status.damaged ? "This PDF can't be read" : "Couldn't load this PDF"}
              body={
                status.damaged
                  ? 'It may be damaged, or not a PDF at all. Download it to open it elsewhere.'
                  : 'Something went wrong fetching it. Try again, or download it instead.'
              }
              actions={[
                ...(status.damaged
                  ? []
                  : [
                      {
                        label: 'Try again',
                        onClick: () => setAttempt(current => current + 1),
                        trackName: 'PreviewRetried',
                      },
                    ]),
                {
                  label: 'Download',
                  onClick: download,
                  primary: true,
                  trackName: 'PreviewDownloaded',
                },
              ]}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function ZoomOption(props: {
  label: string;
  checked: boolean;
  /** The first of the set levels, after the fits. */
  separated: boolean;
  onSelect: () => void;
}): ReactElement {
  return (
    <>
      {props.separated && <DropdownMenuSeparator />}
      <DropdownMenuItem
        onSelect={props.onSelect}
        className='gap-2 text-[13px]'
        data-track-category='FilePreview'
        data-track-name='PdfZoomChosen'
      >
        <Check className={cn('size-3.5', props.checked ? 'opacity-100' : 'opacity-0')} />
        {props.label}
      </DropdownMenuItem>
    </>
  );
}
