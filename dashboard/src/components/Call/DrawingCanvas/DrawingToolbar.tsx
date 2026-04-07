import React from 'react';
import { Pencil, Eraser, X } from 'lucide-react';
import { cn } from '../../../utils/classNames';
import { useDrawStore, sendDrawEvent } from '../../../hooks/useDrawStore';
import { DRAW_COLORS } from '../../../stores/drawStore';

/** A horizontal rule divider sized for a vertical toolbar */
function Divider(): React.ReactElement {
  return <div className='w-6 h-px bg-white/20 my-0.5' aria-hidden />;
}

/** Vertical annotation toolbar — positioned on the left edge of the screen-share container. */
export function DrawingToolbar(): React.ReactElement {
  const color = useDrawStore(s => s.color);
  const strokeWidth = useDrawStore(s => s.strokeWidth);
  const tool = useDrawStore(s => s.tool);

  const previewColor = tool === 'pen' ? color : 'rgba(255,255,255,0.7)';
  const sliderAccent = tool === 'pen' ? color : '#ffffff';

  return (
    <div
      className={cn(
        // ── Position: left edge, vertically centered in the screen-share container ──
        'absolute left-3 top-1/2 -translate-y-1/2 z-20',
        // ── Layout ──
        'flex flex-col items-center gap-1 px-1.5 py-2.5',
        // ── Visual ──
        'bg-gray-900/95 backdrop-blur-sm rounded-2xl',
        'border border-white/10 shadow-2xl',
        'pointer-events-auto',
      )}
      // Stop drawing pointer events from leaking through to the canvas below the toolbar
      onPointerDown={e => e.stopPropagation()}
    >
      {/* ── Pen ── */}
      <button
        onClick={() => sendDrawEvent({ type: 'setTool', tool: 'pen' })}
        className={cn(
          'w-8 h-8 rounded-xl flex items-center justify-center transition-colors',
          tool === 'pen'
            ? 'bg-white/20 text-white'
            : 'text-white/50 hover:text-white hover:bg-white/10',
        )}
        title='Pen'
        aria-pressed={tool === 'pen'}
        data-track-category='CALLS'
        data-track-name='Draw_Set_Tool_Pen'
      >
        <Pencil className='w-4 h-4' aria-hidden />
      </button>

      {/* ── Eraser ── */}
      <button
        onClick={() => sendDrawEvent({ type: 'setTool', tool: 'eraser' })}
        className={cn(
          'w-8 h-8 rounded-xl flex items-center justify-center transition-colors',
          tool === 'eraser'
            ? 'bg-white/20 text-white'
            : 'text-white/50 hover:text-white hover:bg-white/10',
        )}
        title='Eraser'
        aria-pressed={tool === 'eraser'}
        data-track-category='CALLS'
        data-track-name='Draw_Set_Tool_Eraser'
      >
        <Eraser className='w-4 h-4' aria-hidden />
      </button>

      <Divider />

      {/* ── Color swatches ── */}
      {DRAW_COLORS.map(c => (
        <button
          key={c}
          onClick={() => sendDrawEvent({ type: 'setColor', color: c })}
          className={cn(
            'w-6 h-6 rounded-full transition-transform hover:scale-110',
            color === c && tool === 'pen'
              ? 'ring-2 ring-white ring-offset-1 ring-offset-gray-900 scale-110'
              : '',
          )}
          style={{ backgroundColor: c }}
          title={c}
          aria-pressed={color === c && tool === 'pen'}
          aria-label={`Color ${c}`}
          data-track-category='CALLS'
          data-track-name='Draw_Set_Color'
          data-track-metadata={JSON.stringify({ color: c })}
        />
      ))}

      <Divider />

      {/* ── Stroke-width slider ── */}
      {/* Numeric readout */}
      <span className='text-white/50 text-[10px] font-mono leading-none'>{strokeWidth}</span>

      {/* Vertical slider — a horizontal range rotated -90deg inside a fixed-height container */}
      <div className='flex items-center justify-center' style={{ height: 88, width: 32 }}>
        <input
          type='range'
          min={1}
          max={20}
          step={1}
          value={strokeWidth}
          onChange={e => sendDrawEvent({ type: 'setStrokeWidth', width: Number(e.target.value) })}
          className='cursor-pointer'
          style={{
            width: 80,
            height: 4,
            transform: 'rotate(-90deg)',
            accentColor: sliderAccent,
          }}
          aria-label='Stroke width'
          aria-valuemin={1}
          aria-valuemax={20}
          aria-valuenow={strokeWidth}
          data-track-category='CALLS'
          data-track-name='Draw_Set_Stroke_Width'
        />
      </div>

      {/* Live line-thickness preview */}
      <div
        className='rounded-full'
        style={{
          width: 20,
          height: Math.min(strokeWidth, 18),
          backgroundColor: previewColor,
          transition: 'height 0.1s ease, background-color 0.15s ease',
        }}
        aria-hidden
      />

      <Divider />

      {/* ── Exit ── */}
      <button
        onClick={() => sendDrawEvent({ type: 'disableDrawMode' })}
        className='w-8 h-8 rounded-xl flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-colors'
        title='Exit drawing mode'
        aria-label='Exit drawing mode'
        data-track-category='CALLS'
        data-track-name='Draw_Exit'
      >
        <X className='w-4 h-4' aria-hidden />
      </button>
    </div>
  );
}
