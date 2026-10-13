import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Minus, Plus, RotateCw } from 'lucide-react';
import { cn } from '../../../utils/classNames';
import { PreviewButton, PreviewControls, PreviewMeta, PreviewSkeletonView } from '../chrome';
import type { PreviewerProps } from '../types';
import { AmbientImage } from './media/Ambient';

const MIN_SCALE = 0.05;
const MAX_SCALE = 8;
const STEP = 1.25;
/** Room left round a fitted image. */
const FIT_MARGIN = 48;

type Zoom = 'fit' | number;

/**
 * An image, fitted to the pane and never blown up past its own size to fit. Zoom from
 * the toolbar, with ⌘ or Ctrl and the wheel, or by double-clicking between fitted and
 * actual size; drag to move about a zoomed one; turn it a quarter at a time. A
 * checkerboard shows through where it is transparent.
 */
export default function ImagePreview(props: PreviewerProps): ReactElement {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [pane, setPane] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState<Zoom>('fit');
  const [turns, setTurns] = useState(0);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!props.content) return;
    const objectUrl = URL.createObjectURL(props.content);
    setUrl(objectUrl);
    setNatural(null);
    setZoom('fit');
    setTurns(0);
    return () => URL.revokeObjectURL(objectUrl);
  }, [props.content]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setPane({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [url]);

  const sideways = turns % 2 === 1;
  const shown = natural && (sideways ? { width: natural.height, height: natural.width } : natural);
  // Fitted, it is never blown up past its own size, and never left too large for the
  // pane: however big the image, fitting it takes it as far down as it needs.
  const fitScale = shown
    ? Math.max(
        SMALLEST_FIT,
        Math.min(
          1,
          (pane.width - FIT_MARGIN) / shown.width,
          (pane.height - FIT_MARGIN) / shown.height,
        ),
      )
    : 1;
  const scale = zoom === 'fit' ? fitScale : zoom;
  const zoomBy = (factor: number): void =>
    setZoom(current => clamp((current === 'fit' ? fitScale : current) * factor, fitScale));

  // ⌘/Ctrl and the wheel zooms the image, not the page: the browser's own zoom has to
  // be held off, which a passive listener can't do.
  const fitScaleRef = useRef(fitScale);
  fitScaleRef.current = fitScale;
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const factor = Math.exp(-event.deltaY / 300);
      setZoom(current =>
        clamp((current === 'fit' ? fitScaleRef.current : current) * factor, fitScaleRef.current),
      );
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [url]);

  if (!url) return <PreviewSkeletonView shape='media' />;

  const box = shown
    ? { width: Math.round(shown.width * scale), height: Math.round(shown.height * scale) }
    : null;
  const overflows = box !== null && (box.width > pane.width || box.height > pane.height);

  return (
    <>
      {natural && (
        <PreviewMeta>
          {natural.width.toLocaleString()} × {natural.height.toLocaleString()}
        </PreviewMeta>
      )}
      <PreviewControls>
        <PreviewButton
          title='Zoom out'
          onClick={() => zoomBy(1 / STEP)}
          disabled={scale <= Math.min(MIN_SCALE, fitScale)}
          trackName='PreviewZoomedOut'
        >
          <Minus className='size-4' />
        </PreviewButton>
        <button
          type='button'
          title={zoom === 'fit' ? 'Actual size' : 'Fit to the pane'}
          onClick={() => setZoom(zoom === 'fit' ? 1 : 'fit')}
          className='outline-none h-7 min-w-[52px] rounded-md px-1.5 text-xs tabular-nums text-muted-foreground transition-colors hover:bg-foreground/[0.08] focus-visible:bg-foreground/[0.08] hover:text-foreground focus-visible:text-foreground'
          data-track-category='FilePreview'
          data-track-name='PreviewZoomReset'
        >
          {Math.round(scale * 100)}%
        </button>
        <PreviewButton
          title='Zoom in'
          onClick={() => zoomBy(STEP)}
          disabled={scale >= MAX_SCALE}
          trackName='PreviewZoomedIn'
        >
          <Plus className='size-4' />
        </PreviewButton>
        <PreviewButton
          title='Rotate'
          onClick={() => setTurns(current => (current + 1) % 4)}
          trackName='PreviewRotated'
        >
          <RotateCw className='size-4' />
        </PreviewButton>
      </PreviewControls>
      {/* The image's own colours, glowing behind it, in place of a flat backdrop. */}
      <div className='relative h-full overflow-hidden'>
        <AmbientImage src={url} />
        <div
          ref={scrollRef}
          className={cn(
            'relative h-full overflow-auto',
            overflows && (dragging ? 'cursor-grabbing' : 'cursor-grab'),
          )}
          onDoubleClick={() => setZoom(zoom === 'fit' ? 1 : 'fit')}
          onPointerDown={event => {
            const element = scrollRef.current;
            if (!overflows || !element || event.button !== 0) return;
            drag.current = {
              x: event.clientX,
              y: event.clientY,
              left: element.scrollLeft,
              top: element.scrollTop,
            };
            setDragging(true);
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={event => {
            const element = scrollRef.current;
            if (!drag.current || !element) return;
            element.scrollLeft = drag.current.left - (event.clientX - drag.current.x);
            element.scrollTop = drag.current.top - (event.clientY - drag.current.y);
          }}
          onPointerUp={() => {
            drag.current = null;
            setDragging(false);
          }}
          onPointerCancel={() => {
            drag.current = null;
            setDragging(false);
          }}
        >
          <div
            className='flex min-h-full min-w-full items-center justify-center p-6'
            style={{ width: 'max-content' }}
          >
            <div
              className='relative shrink-0 overflow-hidden rounded-sm shadow-sm'
              style={{
                width: box?.width ?? 0,
                height: box?.height ?? 0,
                backgroundImage:
                  'repeating-conic-gradient(hsl(var(--muted)) 0% 25%, hsl(var(--background)) 0% 50%)',
                backgroundSize: '16px 16px',
              }}
            >
              <img
                src={url}
                alt={props.file.name}
                draggable={false}
                onLoad={event =>
                  setNatural({
                    width: event.currentTarget.naturalWidth,
                    height: event.currentTarget.naturalHeight,
                  })
                }
                className='absolute left-1/2 top-1/2 max-w-none select-none'
                style={{
                  width: natural ? natural.width * scale : 'auto',
                  height: natural ? natural.height * scale : 'auto',
                  transform: `translate(-50%, -50%) rotate(${turns * 90}deg)`,
                  visibility: natural ? 'visible' : 'hidden',
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/** The smallest a fitted image is drawn, however small the pane. */
const SMALLEST_FIT = 0.01;
/** Zoomed out no further than 5%, or than fitting the pane when that takes less. */
const clamp = (scale: number, fit: number): number =>
  Math.min(MAX_SCALE, Math.max(Math.min(MIN_SCALE, fit), scale));
