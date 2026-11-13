import { useEffect, useLayoutEffect, useRef, useState, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { RotateCcw, RotateCw, ZoomIn, ZoomOut, Maximize2, ExternalLink, Download } from 'lucide-react';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100));

// Inline image preview. Zoom is applied as real layout size (fit-to-view × zoom)
// inside an overflow-auto container, so a zoomed image gets native scrollbars +
// wheel-scroll + grab-to-pan — not just a CSS transform. Rotation (90° steps)
// swaps the bounding box so scrolling stays correct. Plus a typeable zoom %,
// fit-to-view, open-in-new-tab and download. Original bytes are never re-encoded.
export default function ImageView({ url, name }: { url: string; name: string }) {
  const [deg, setDeg] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [zoomText, setZoomText] = useState('100');
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  // Track the scroll viewport's size so "fit" is always relative to it.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = (): void => { setBox({ w: el.clientWidth, h: el.clientHeight }); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => { ro.disconnect(); };
  }, []);

  useEffect(() => { setZoomText(String(Math.round(zoom * 100))); }, [zoom]);

  const rotated = deg === 90 || deg === 270;
  const ready = !!(nat && box && box.w > 0 && box.h > 0);
  const fitScale = ready ? Math.min(box.w / nat.w, box.h / nat.h) : 1;
  const imgW = nat ? nat.w * fitScale * zoom : 0; // image's own (unrotated) display size
  const imgH = nat ? nat.h * fitScale * zoom : 0;
  const boxW = rotated ? imgH : imgW; // rotated bounding box = the scroll area
  const boxH = rotated ? imgW : imgH;
  const canPan = ready && !!box && (boxW > box.w + 1 || boxH > box.h + 1);

  const applyZoom = (z: number): void => { setZoom(clampZoom(z)); };
  const rotate = (d: number): void => { setDeg((v) => (v + d + 360) % 360); };
  // Fit the CURRENT orientation's bounding box to the viewport (only on demand).
  const fit = (): void => {
    if (!ready) { setZoom(1); return; }
    const baseW = rotated ? nat.h : nat.w; // bbox dims at zoom 1, in screen space
    const baseH = rotated ? nat.w : nat.h;
    setZoom(clampZoom(Math.min(box.w / (baseW * fitScale), box.h / (baseH * fitScale))));
  };
  const commitText = (): void => {
    const n = Number.parseFloat(zoomText);
    if (Number.isFinite(n) && n > 0) applyZoom(n / 100);
    else setZoomText(String(Math.round(zoom * 100)));
  };

  return (
    <div className="flex h-[72vh] flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-center gap-0.5 border-b border-[var(--wui-border)] bg-[var(--wui-bg)] px-2 py-1.5">
        <ToolBtn title="Rotate left" onClick={() => { rotate(-90); }}><RotateCcw className="size-4" /></ToolBtn>
        <ToolBtn title="Rotate right" onClick={() => { rotate(90); }}><RotateCw className="size-4" /></ToolBtn>
        <Divider />
        <ToolBtn title="Zoom out" onClick={() => { applyZoom(zoom - 0.25); }}><ZoomOut className="size-4" /></ToolBtn>
        <span className="flex items-center rounded-md px-1 text-[12px] tabular-nums text-[var(--wui-fg-muted)]">
          <input
            value={zoomText}
            onChange={(e) => { setZoomText(e.target.value.replace(/[^\d]/g, '').slice(0, 4)); }}
            onBlur={commitText}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            inputMode="numeric"
            aria-label="Zoom percent"
            className="w-9 bg-transparent text-right text-[var(--wui-fg)] outline-none"
          />
          %
        </span>
        <ToolBtn title="Zoom in" onClick={() => { applyZoom(zoom + 0.25); }}><ZoomIn className="size-4" /></ToolBtn>
        <Divider />
        <ToolBtn title="Fit to view" onClick={fit}><Maximize2 className="size-4" /></ToolBtn>
        <Divider />
        <ToolLink href={url} target="_blank" rel="noopener noreferrer" title="Open in new tab"><ExternalLink className="size-4" /></ToolLink>
        <ToolLink href={url} download={name} title="Download"><Download className="size-4" /></ToolLink>
      </div>

      <div
        ref={scrollRef}
        className="flex flex-1 overflow-auto p-4"
        style={{ cursor: canPan ? (panning ? 'grabbing' : 'grab') : 'default' }}
        onMouseDown={(e) => {
          if (!canPan || !scrollRef.current) return;
          pan.current = { x: e.clientX, y: e.clientY, left: scrollRef.current.scrollLeft, top: scrollRef.current.scrollTop };
          setPanning(true);
        }}
        onMouseMove={(e) => {
          const el = scrollRef.current;
          if (!pan.current || !el) return;
          el.scrollLeft = pan.current.left - (e.clientX - pan.current.x);
          el.scrollTop = pan.current.top - (e.clientY - pan.current.y);
        }}
        onMouseUp={() => { pan.current = null; setPanning(false); }}
        onMouseLeave={() => { pan.current = null; setPanning(false); }}
        onDoubleClick={() => { applyZoom(zoom === 1 ? 2 : 1); }}
      >
        {ready ? (
          <div className="relative m-auto shrink-0" style={{ width: boxW, height: boxH }}>
            <img
              src={url}
              alt={name}
              draggable={false}
              onLoad={(e) => { setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight }); }}
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                width: imgW,
                height: imgH,
                maxWidth: 'none', // override Tailwind preflight `img{max-width:100%}`,
                maxHeight: 'none', // which would clamp (and squash) the rotated image
                transform: `translate(-50%, -50%) rotate(${String(deg)}deg)`,
              }}
              className="select-none rounded-lg"
            />
          </div>
        ) : (
          <img
            src={url}
            alt={name}
            draggable={false}
            onLoad={(e) => { setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight }); }}
            className="m-auto max-h-full max-w-full select-none rounded-lg object-contain"
          />
        )}
      </div>
    </div>
  );
}

function Divider() {
  return <span className="mx-1 h-4 w-px bg-[var(--wui-border)]" />;
}

function ToolBtn({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="grid size-8 place-items-center rounded-lg text-[var(--wui-fg-muted)] transition-colors hover:bg-[var(--wui-bg-subtle)] hover:text-[var(--wui-fg)]"
    >
      {children}
    </button>
  );
}

function ToolLink({ href, title, children, ...rest }: { href: string; title: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      href={href}
      title={title}
      {...rest}
      className="grid size-8 place-items-center rounded-lg text-[var(--wui-fg-muted)] transition-colors hover:bg-[var(--wui-bg-subtle)] hover:text-[var(--wui-fg)]"
    >
      {children}
    </a>
  );
}
