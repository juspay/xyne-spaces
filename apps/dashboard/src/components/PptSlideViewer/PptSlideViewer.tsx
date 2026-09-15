import { logger, Event as LogEvent } from '../../utils/logger';
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Download, Maximize2, X } from 'lucide-react';
import type {
  PptSlide,
  PptSlideObject,
  PptSlideViewerProps,
  Opts as _Opts,
  ChartSeries,
} from './types';

// Slide: 10in wide × 5.625in tall (16:9 at 96 DPI)
const W = 10;
const H = 5.625;

const hex = (c?: string) => (!c ? undefined : c.startsWith('#') ? c : `#${c}`);
const xp = (v: number) => `${(v / W) * 100}%`;
const yp = (v: number) => `${(v / H) * 100}%`;

function slideBg(slide: PptSlide): string {
  const bg = slide.background;
  if (!bg) return '#ffffff';
  if (typeof bg === 'string') return hex(bg) ?? '#ffffff';
  return hex(bg.color) ?? '#ffffff';
}

interface BarChartSeries {
  name: string;
  labels: string[];
  values: number[];
}

function BarChart({ data }: { data: BarChartSeries[] }) {
  if (!data || data.length === 0) return null;
  const series = data[0]!;
  const max = Math.max(...series.values, 1);
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        padding: '4% 3% 8%',
        boxSizing: 'border-box',
      }}
    >
      {series.name && (
        <div
          style={{
            fontSize: '1.5cqw',
            fontWeight: 600,
            color: '#333',
            marginBottom: '3%',
            textAlign: 'center',
          }}
        >
          {series.name}
        </div>
      )}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'flex-end',
          gap: '2%',
          position: 'relative',
        }}
      >
        {/* Y-axis line */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: 1,
            backgroundColor: '#ccc',
          }}
        />
        {series.labels.map((label, i) => {
          const val = series.values[i] ?? 0;
          const pct = (val / max) * 100;
          const colors = ['#4472C4', '#ED7D31', '#A9D18E', '#FF0000', '#FFC000', '#5B9BD5'];
          return (
            <div
              key={i}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                height: '100%',
                justifyContent: 'flex-end',
              }}
            >
              <div style={{ fontSize: '1.2cqw', color: '#555', marginBottom: '2%' }}>{val}</div>
              <div
                style={{
                  width: '60%',
                  height: `${pct}%`,
                  backgroundColor: colors[i % colors.length],
                  borderRadius: '1px 1px 0 0',
                  minHeight: 2,
                }}
              />
              <div
                style={{
                  fontSize: '1.1cqw',
                  color: '#666',
                  marginTop: '4%',
                  textAlign: 'center',
                  wordBreak: 'break-word',
                }}
              >
                {label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function renderObject(obj: PptSlideObject, idx: number): React.ReactNode {
  const opts = obj.options ?? {};
  const type = obj.type?.toLowerCase();
  if (type === 'notes') return null;

  const x = opts.x ?? 0;
  const y = opts.y ?? 0;
  const w = opts.w ?? 1;
  const h = opts.h ?? 0.5;

  const base: React.CSSProperties = {
    position: 'absolute',
    left: xp(x),
    top: yp(y),
    width: xp(w),
    height: yp(h),
    boxSizing: 'border-box',
    overflow: 'hidden',
  };

  if (type === 'shape') {
    const fill = opts.fill;
    const line = opts.line;
    const rectRadius = opts.rectRadius;
    return (
      <div
        key={idx}
        style={{
          ...base,
          backgroundColor: hex(fill?.color) ?? 'transparent',
          border: line?.color ? `1px solid ${hex(line.color)}` : undefined,
          borderRadius: rectRadius ? xp(rectRadius) : undefined,
        }}
      />
    );
  }

  if (type === 'text') {
    const fs = opts.fontSize ? `${(opts.fontSize / 7.2).toFixed(2)}cqw` : '1.94cqw';
    const textColor = hex(opts.color) ?? '#000000';
    const align = opts.align === 'center' ? 'center' : opts.align === 'right' ? 'right' : 'left';
    const valign =
      opts.valign === 'middle' ? 'center' : opts.valign === 'bottom' ? 'flex-end' : 'flex-start';

    let content: React.ReactNode;
    if (Array.isArray(obj.text)) {
      content = obj.text.map((run, ri: number) => {
        const ro = run.options ?? {};
        const runFs = ro.fontSize ? `${(ro.fontSize / 7.2).toFixed(2)}cqw` : fs;
        const hasBullet = ro.bullet === true || (ro.bullet && typeof ro.bullet === 'object');
        return (
          <div
            key={ri}
            style={{
              display: 'block',
              fontSize: runFs,
              fontWeight: ro.bold ? 'bold' : opts.bold ? 'bold' : 'normal',
              fontStyle: ro.italic ? 'italic' : 'normal',
              color: hex(ro.color) ?? textColor,
              lineHeight: 1.25,
              marginBottom: ro.paraSpaceAfter
                ? `${(ro.paraSpaceAfter / 7.2 / 10).toFixed(2)}cqw`
                : 0,
              wordBreak: 'break-word',
            }}
          >
            {hasBullet && <span style={{ marginRight: '0.35em' }}>•</span>}
            {run.text ?? ''}
          </div>
        );
      });
    } else {
      content = (
        <span
          style={{
            fontSize: fs,
            fontWeight: opts.bold ? 'bold' : 'normal',
            fontStyle: opts.italic ? 'italic' : 'normal',
            color: textColor,
            lineHeight: 1.25,
            wordBreak: 'break-word',
            whiteSpace: 'pre-wrap',
            letterSpacing: opts.charSpacing ? `${opts.charSpacing / 100}em` : undefined,
          }}
        >
          {String(obj.text ?? '')}
        </span>
      );
    }

    return (
      <div
        key={idx}
        style={{
          ...base,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: valign,
          alignItems: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start',
          textAlign: align,
          backgroundColor: hex(opts.fill?.color) ?? 'transparent',
          padding: opts.margin === 0 ? 0 : '0.3cqw',
        }}
      >
        {content}
      </div>
    );
  }

  if (type === 'image') {
    const src = opts.data || opts.path;
    if (!src) return null;
    return <img key={idx} src={src} alt='' style={{ ...base, objectFit: 'cover' }} />;
  }

  if (type === 'chart') {
    const rawData = (obj as { data?: ChartSeries[] }).data ?? [];
    const chartData = rawData.map((s: ChartSeries) => ({
      name: s.name ?? s.series ?? s.label ?? 'Series',
      labels: s.labels ?? s.categories ?? [],
      values: s.values ?? s.data ?? [],
    }));
    return (
      <div
        key={idx}
        style={{
          ...base,
          backgroundColor: 'rgba(255,255,255,0.9)',
          border: '1px solid rgba(0,0,0,0.08)',
        }}
      >
        {chartData.length > 0 ? (
          <BarChart data={chartData} />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span style={{ fontSize: '1.2cqw', color: '#888' }}>Chart</span>
          </div>
        )}
      </div>
    );
  }

  if (type === 'table') {
    const rows =
      (
        obj as {
          rows?: Array<Array<{ text?: string } | string>>;
          data?: Array<Array<{ text?: string } | string>>;
        }
      ).rows ??
      (obj as { data?: Array<Array<{ text?: string } | string>> }).data ??
      [];
    return (
      <div key={idx} style={{ ...base, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '1.4cqw' }}>
          <tbody>
            {rows.map((row, ri: number) => (
              <tr key={ri}>
                {row.map((cell, ci: number) => (
                  <td
                    key={ci}
                    style={{
                      border: '1px solid rgba(0,0,0,0.15)',
                      padding: '0.4cqw 0.6cqw',
                      backgroundColor: ri === 0 ? 'rgba(0,0,0,0.06)' : 'transparent',
                      fontWeight: ri === 0 ? 600 : 400,
                    }}
                  >
                    {typeof cell === 'object' ? (cell.text ?? '') : cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return null;
}

const Slide: React.FC<{ slide: PptSlide }> = ({ slide }) => (
  <div
    style={{
      containerType: 'inline-size',
      position: 'relative',
      width: '100%',
      aspectRatio: '16/9',
      backgroundColor: slideBg(slide),
      overflow: 'hidden',
      borderRadius: 4,
      boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
    }}
  >
    {slide.objects?.map((obj, i) => renderObject(obj, i))}
  </div>
);

export const PptSlideViewer: React.FC<PptSlideViewerProps> = props => {
  // Guard against garbage input at top level
  const downloadUrl = props?.downloadUrl ?? '';
  const title = props?.title ?? '';
  const slides = Array.isArray(props?.slides) ? props.slides : [];

  const [idx, setIdx] = useState(0);
  const [presenting, setPresenting] = useState(false);
  const fullscreenRef = useRef<HTMLDivElement>(null);
  const total = slides.length;
  const prev = useCallback(() => setIdx(i => Math.max(0, i - 1)), []);
  const next = useCallback(() => setIdx(i => Math.min(total - 1, i + 1)), [total]);
  const current = slides[idx];

  const enterPresent = useCallback(() => {
    setPresenting(true);
    // Request fullscreen after state update so the div is mounted
    setTimeout(() => {
      void fullscreenRef.current?.requestFullscreen().catch(() => {
        // Fullscreen not supported or denied — overlay still shows
      });
    }, 50);
  }, []);

  const exitPresent = useCallback(() => {
    setPresenting(false);
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined);
    }
  }, []);

  // Sync presenting state when user presses Esc via the browser's native fullscreen exit
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement && presenting) {
        setPresenting(false);
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, [presenting]);

  // Keyboard nav in present mode
  useEffect(() => {
    if (!presenting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') prev();
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next();
      else if (e.key === 'Escape') exitPresent();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [presenting, prev, next, exitPresent]);

  try {
    const titleMaxChars = 30;
    const displayTitle =
      title && title.length > titleMaxChars ? `${title.slice(0, titleMaxChars)}…` : title;

    return (
      <>
        <div className='w-full rounded-xl border border-border bg-card overflow-hidden'>
          {/* Title bar */}
          <div className='flex items-center justify-between px-3 py-2 border-b border-border'>
            <span
              className="text-xs font-semibold text-foreground font-['Inter'] truncate"
              title={title}
            >
              {displayTitle}
            </span>
            <div className='flex items-center gap-2 ml-2 flex-shrink-0'>
              <button
                onClick={enterPresent}
                disabled={!current}
                className='flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40'
                data-track-category='XyneAI'
                data-track-name='PPT_PRESENT'
              >
                <Maximize2 size={12} />
                Present
              </button>
              <div className='w-px h-3 bg-border' />
              <button
                onClick={() => {
                  window.location.href = downloadUrl;
                }}
                className='flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors'
                data-track-category='XyneAI'
                data-track-name='PPT_DOWNLOAD'
              >
                <Download size={12} />
                Download
              </button>
            </div>
          </div>

          {/* Slide area */}
          <div className='p-3 bg-muted/30'>
            {current ? (
              <Slide slide={current} />
            ) : (
              <div
                style={{ aspectRatio: '16/9' }}
                className='flex items-center justify-center bg-muted rounded text-xs text-muted-foreground'
              >
                No slides
              </div>
            )}
          </div>

          {/* Navigation */}
          {total > 1 && (
            <div className='flex items-center justify-center gap-3 py-2 border-t border-border'>
              <button
                onClick={prev}
                disabled={idx === 0}
                className='p-1 rounded hover:bg-accent disabled:opacity-30 transition-colors'
                data-track-category='XyneAI'
                data-track-name='PPT_PREV'
              >
                <ChevronLeft size={14} />
              </button>
              <span className="text-xs text-muted-foreground font-['Inter']">
                {idx + 1} / {total}
              </span>
              <button
                onClick={next}
                disabled={idx === total - 1}
                className='p-1 rounded hover:bg-accent disabled:opacity-30 transition-colors'
                data-track-category='XyneAI'
                data-track-name='PPT_NEXT'
              >
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>

        {/* Fullscreen / Present mode */}
        {presenting && (
          <div
            ref={fullscreenRef}
            role='button'
            tabIndex={0}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 50,
              background: '#000',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            onClick={exitPresent}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') exitPresent();
            }}
            data-track-category='XyneAI'
            data-track-name='PPT_BG_EXIT'
          >
            {/* Close */}
            <button
              style={{
                position: 'absolute',
                top: 16,
                right: 16,
                padding: 8,
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.12)',
                color: '#fff',
                border: 'none',
                cursor: 'pointer',
                zIndex: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onClick={e => {
                e.stopPropagation();
                exitPresent();
              }}
              data-track-category='XyneAI'
              data-track-name='PPT_EXIT'
            >
              <X size={20} />
            </button>

            {/* Title */}
            <p
              style={{
                position: 'absolute',
                top: 18,
                left: '50%',
                transform: 'translateX(-50%)',
                color: 'rgba(255,255,255,0.5)',
                fontSize: 13,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '55%',
                pointerEvents: 'none',
              }}
            >
              {title}
            </p>

            {/* Slide — fills viewport maintaining 16:9 */}
            <div
              role='button'
              tabIndex={0}
              style={{
                width: 'min(100vw, calc(100vh * 16 / 9))',
                height: 'min(100vh, calc(100vw * 9 / 16))',
                position: 'relative',
              }}
              onClick={e => e.stopPropagation()}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') e.stopPropagation();
              }}
              data-track-category='XyneAI'
              data-track-name='PPT_SLIDE_CONTAINER'
            >
              {current && <Slide slide={current} />}

              {/* Prev arrow — left edge overlay */}
              {total > 1 && (
                <button
                  onClick={prev}
                  disabled={idx === 0}
                  style={{
                    position: 'absolute',
                    left: 16,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    padding: 12,
                    borderRadius: '50%',
                    background: 'rgba(0,0,0,0.35)',
                    color: '#fff',
                    border: 'none',
                    cursor: 'pointer',
                    opacity: idx === 0 ? 0.2 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backdropFilter: 'blur(4px)',
                  }}
                  data-track-category='XyneAI'
                  data-track-name='PPT_FS_PREV'
                >
                  <ChevronLeft size={32} />
                </button>
              )}

              {/* Next arrow — right edge overlay */}
              {total > 1 && (
                <button
                  onClick={next}
                  disabled={idx === total - 1}
                  style={{
                    position: 'absolute',
                    right: 16,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    padding: 12,
                    borderRadius: '50%',
                    background: 'rgba(0,0,0,0.35)',
                    color: '#fff',
                    border: 'none',
                    cursor: 'pointer',
                    opacity: idx === total - 1 ? 0.2 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backdropFilter: 'blur(4px)',
                  }}
                  data-track-category='XyneAI'
                  data-track-name='PPT_FS_NEXT'
                >
                  <ChevronRight size={32} />
                </button>
              )}
            </div>

            {/* Counter */}
            <p
              style={{
                position: 'absolute',
                bottom: 20,
                color: 'rgba(255,255,255,0.4)',
                fontSize: 13,
                pointerEvents: 'none',
              }}
            >
              {idx + 1} / {total} · Press ← → or Esc
            </p>
          </div>
        )}
      </>
    );
  } catch (err) {
    logger.error(LogEvent.FRONTEND_ERROR, {
      type: 'migrated_console_error',
      message: String('Error rendering PPT preview:'),
      error: err,
    });
    return (
      <div className='w-full rounded-xl border border-red-200 bg-red-50 p-4 text-red-600'>
        <p className='text-sm font-medium'>Failed to render presentation preview</p>
        <p className='text-xs mt-1'>Please try downloading the file instead.</p>
      </div>
    );
  }
};

export default PptSlideViewer;
