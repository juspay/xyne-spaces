import React, { forwardRef, useImperativeHandle, useRef, useEffect, useCallback } from 'react';
import { Circle } from 'lucide-react';
import { RoomEvent } from 'livekit-client';
import type { RemoteParticipant } from 'livekit-client';
import { useSelector } from '@xstate/react';
import { roomActor } from '../../../machines/roomMachine';
import { useDrawStore } from '../../../hooks/useDrawStore';
import { DRAW_DATA_TOPIC } from './types';
import type { DrawMessage, Stroke } from './types';

export interface DrawingCanvasHandle {
  /** Clear all strokes and broadcast DRAW_CLEAR to all participants */
  clearAll: () => void;
  /** Undo the last local stroke and broadcast DRAW_UNDO to all participants */
  undo: () => void;
}

/** Renders a single stroke as a smooth quadratic bezier curve path */
function renderStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const { points, color, width, tool } = stroke;
  if (points.length === 0) return;

  ctx.save();
  ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
  ctx.strokeStyle = color;
  // Use strokeWidth directly in canvas pixels — coordinates are normalized so
  // this gives consistent absolute stroke sizes regardless of canvas resolution
  ctx.lineWidth = Math.max(1, width);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();

  const first = points[0];
  if (!first) return;

  ctx.moveTo(first.x * canvasWidth, first.y * canvasHeight);

  if (points.length === 1) {
    // Single dot
    ctx.arc(first.x * canvasWidth, first.y * canvasHeight, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Smooth midpoint algorithm: draw quadratic bezier between midpoints
    for (let i = 1; i < points.length - 1; i++) {
      const current = points[i]!;
      const next = points[i + 1]!;
      const midX = ((current.x + next.x) / 2) * canvasWidth;
      const midY = ((current.y + next.y) / 2) * canvasHeight;
      ctx.quadraticCurveTo(current.x * canvasWidth, current.y * canvasHeight, midX, midY);
    }
    // Connect to last point directly
    const last = points[points.length - 1]!;
    ctx.lineTo(last.x * canvasWidth, last.y * canvasHeight);
    ctx.stroke();
  }

  ctx.restore();
}

function generateStrokeId(identity: string): string {
  return `${identity}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Transparent canvas overlay for screen-share annotations.
 * Syncs drawn strokes with remote participants via LiveKit data channel.
 */
export const DrawingCanvas = forwardRef<DrawingCanvasHandle>((_props, ref) => {
  // Get room from global roomActor (same pattern as CallControls)
  const room = useSelector(roomActor, state => state.context.room);
  const participantIdentity = room?.localParticipant.identity ?? 'unknown';

  // Drawing tool state from store
  const isDrawingEnabled = useDrawStore(s => s.isDrawingEnabled);
  const color = useDrawStore(s => s.color);
  const strokeWidth = useDrawStore(s => s.strokeWidth);
  const tool = useDrawStore(s => s.tool);

  // Canvas DOM ref
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Container div ref (used for ResizeObserver)
  const containerRef = useRef<HTMLDivElement>(null);

  // All strokes (local + remote) stored as a Map for O(1) lookup by strokeId
  const strokesRef = useRef<Map<string, Stroke>>(new Map());
  // Ordered list of local stroke IDs for undo (most recent last)
  const localStrokeHistoryRef = useRef<string[]>([]);
  // ID of the stroke currently being drawn by the local user
  const currentStrokeIdRef = useRef<string | null>(null);
  // Whether the pointer is currently held down
  const isPointerDownRef = useRef(false);
  // rAF handle for batched redraws
  const animFrameRef = useRef<number | null>(null);
  // Ref for the floating eraser cursor element — updated via direct DOM for zero re-renders
  const eraserCursorRef = useRef<HTMLDivElement>(null);

  // ── Canvas rendering ────────────────────────────────────────────────────────

  const redrawCanvas = useCallback((): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const stroke of strokesRef.current.values()) {
      renderStroke(ctx, stroke, canvas.width, canvas.height);
    }
  }, []);

  const scheduleRedraw = useCallback((): void => {
    if (animFrameRef.current !== null) return; // already scheduled
    animFrameRef.current = requestAnimationFrame(() => {
      animFrameRef.current = null;
      redrawCanvas();
    });
  }, [redrawCanvas]);

  // ── Canvas sizing (keeps pixel dimensions in sync with container) ───────────

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const sync = (): void => {
      canvas.width = container.offsetWidth;
      canvas.height = container.offsetHeight;
      scheduleRedraw();
    };

    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(container);
    return () => observer.disconnect();
  }, [scheduleRedraw]);

  // ── Data channel: publish helper ────────────────────────────────────────────

  const publishDrawEvent = useCallback(
    (msg: DrawMessage): void => {
      if (!room) return;
      // Intermediate points are sent unreliably (lower latency, ok to drop a few)
      // Begin / End / Clear are sent reliably to preserve stroke boundaries
      const reliable = msg.type !== 'DRAW_POINT';
      void room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(msg)), {
        reliable,
        topic: DRAW_DATA_TOPIC,
      });
    },
    [room],
  );

  // ── Data channel: receive remote draw events ─────────────────────────────────

  useEffect(() => {
    if (!room) return;

    const handleDataReceived = (
      payload: Uint8Array,
      _participant?: RemoteParticipant,
      _kind?: unknown,
      topic?: string,
    ): void => {
      if (topic !== DRAW_DATA_TOPIC) return;

      let msg: DrawMessage;
      try {
        msg = JSON.parse(new TextDecoder().decode(payload)) as DrawMessage;
      } catch {
        return;
      }

      // Ignore own events (shouldn't happen but guard anyway)
      if (msg.participantIdentity === participantIdentity) return;

      switch (msg.type) {
        case 'DRAW_BEGIN': {
          const stroke: Stroke = {
            id: msg.strokeId,
            participantIdentity: msg.participantIdentity,
            points: [{ x: msg.x ?? 0, y: msg.y ?? 0 }],
            color: msg.color ?? '#EF4444',
            width: msg.width ?? 4,
            tool: msg.tool ?? 'pen',
            isComplete: false,
          };
          strokesRef.current.set(msg.strokeId, stroke);
          scheduleRedraw();
          break;
        }
        case 'DRAW_POINT': {
          const stroke = strokesRef.current.get(msg.strokeId);
          if (stroke) {
            stroke.points.push({ x: msg.x ?? 0, y: msg.y ?? 0 });
            scheduleRedraw();
          }
          break;
        }
        case 'DRAW_END': {
          const stroke = strokesRef.current.get(msg.strokeId);
          if (stroke) {
            stroke.isComplete = true;
            scheduleRedraw();
          }
          break;
        }
        case 'DRAW_CLEAR': {
          // Only remove strokes belonging to the participant who pressed clear
          for (const [id, stroke] of strokesRef.current.entries()) {
            if (stroke.participantIdentity === msg.participantIdentity) {
              strokesRef.current.delete(id);
            }
          }
          scheduleRedraw();
          break;
        }
        case 'DRAW_UNDO': {
          if (msg.strokeId) {
            strokesRef.current.delete(msg.strokeId);
            scheduleRedraw();
          }
          break;
        }
      }
    };

    room.on(RoomEvent.DataReceived, handleDataReceived);
    return (): void => {
      room.off(RoomEvent.DataReceived, handleDataReceived);
    };
  }, [room, participantIdentity, scheduleRedraw]);

  // ── Pointer event handlers (local drawing) ──────────────────────────────────

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      if (!isDrawingEnabled) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      isPointerDownRef.current = true;

      const rect = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;

      const strokeId = generateStrokeId(participantIdentity);
      currentStrokeIdRef.current = strokeId;

      const newStroke: Stroke = {
        id: strokeId,
        participantIdentity,
        points: [{ x, y }],
        color: tool === 'eraser' ? 'rgba(0,0,0,1)' : color,
        width: strokeWidth,
        tool,
        isComplete: false,
      };
      strokesRef.current.set(strokeId, newStroke);
      scheduleRedraw();

      // Track in local history for undo
      localStrokeHistoryRef.current.push(strokeId);

      publishDrawEvent({
        type: 'DRAW_BEGIN',
        participantIdentity,
        strokeId,
        x,
        y,
        color: newStroke.color,
        width: strokeWidth,
        tool,
        timestamp: Date.now(),
      });
    },
    [
      isDrawingEnabled,
      participantIdentity,
      color,
      strokeWidth,
      tool,
      publishDrawEvent,
      scheduleRedraw,
    ],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      const rect = e.currentTarget.getBoundingClientRect();

      // Always track eraser cursor — direct DOM update, no React re-render
      if (eraserCursorRef.current) {
        eraserCursorRef.current.style.left = `${e.clientX - rect.left}px`;
        eraserCursorRef.current.style.top = `${e.clientY - rect.top}px`;
        eraserCursorRef.current.style.opacity = '1';
      }

      if (!isPointerDownRef.current || !currentStrokeIdRef.current) return;
      e.preventDefault();

      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;

      const stroke = strokesRef.current.get(currentStrokeIdRef.current);
      if (stroke) {
        stroke.points.push({ x, y });
        scheduleRedraw();
      }

      publishDrawEvent({
        type: 'DRAW_POINT',
        participantIdentity,
        strokeId: currentStrokeIdRef.current,
        x,
        y,
        timestamp: Date.now(),
      });
    },
    [participantIdentity, publishDrawEvent, scheduleRedraw],
  );

  const handlePointerLeave = useCallback((): void => {
    if (eraserCursorRef.current) eraserCursorRef.current.style.opacity = '0';
  }, []);

  const handlePointerUp = useCallback((): void => {
    if (!currentStrokeIdRef.current) return;
    isPointerDownRef.current = false;

    const stroke = strokesRef.current.get(currentStrokeIdRef.current);
    if (stroke) stroke.isComplete = true;

    publishDrawEvent({
      type: 'DRAW_END',
      participantIdentity,
      strokeId: currentStrokeIdRef.current,
      timestamp: Date.now(),
    });

    currentStrokeIdRef.current = null;
  }, [participantIdentity, publishDrawEvent]);

  // ── Imperative handle (clearAll, undo) ─────────────────────────────────────

  useImperativeHandle(
    ref,
    () => ({
      clearAll: (): void => {
        // Locally: remove only this user's own strokes
        for (const [id, stroke] of strokesRef.current.entries()) {
          if (stroke.participantIdentity === participantIdentity) {
            strokesRef.current.delete(id);
          }
        }
        localStrokeHistoryRef.current = [];
        scheduleRedraw();
        // Broadcast: remote peers apply the same filter using the sender identity
        publishDrawEvent({
          type: 'DRAW_CLEAR',
          participantIdentity,
          strokeId: '',
          timestamp: Date.now(),
        });
      },
      undo: (): void => {
        const strokeId = localStrokeHistoryRef.current.pop();
        if (!strokeId) return;
        strokesRef.current.delete(strokeId);
        scheduleRedraw();
        publishDrawEvent({
          type: 'DRAW_UNDO',
          participantIdentity,
          strokeId,
          timestamp: Date.now(),
        });
      },
    }),
    [participantIdentity, publishDrawEvent, scheduleRedraw],
  );

  // ── Cleanup animation frame ──────────────────────────────────────────────────

  useEffect(() => {
    return (): void => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, []);

  const cursor = !isDrawingEnabled ? 'default' : tool === 'eraser' ? 'none' : 'crosshair';
  // Eraser cursor size = strokeWidth (exact match to erased area diameter)
  const eraserCursorSize = Math.max(10, strokeWidth);

  return (
    <div
      ref={containerRef}
      className='absolute inset-0'
      style={{
        zIndex: 10,
        pointerEvents: isDrawingEnabled ? 'auto' : 'none',
        cursor,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={handlePointerLeave}
    >
      <canvas ref={canvasRef} className='absolute inset-0' style={{ touchAction: 'none' }} />

      {/* Floating eraser cursor — Lucide Circle icon sized to match the erase diameter */}
      {tool === 'eraser' && isDrawingEnabled && (
        <div
          ref={eraserCursorRef}
          className='absolute pointer-events-none select-none'
          style={{
            opacity: 0, // shown via onPointerMove
            transform: 'translate(-50%, -50%)',
            transition: 'opacity 0.1s ease',
            zIndex: 12,
          }}
        >
          <Circle
            size={eraserCursorSize}
            strokeWidth={1.5}
            color='white'
            style={{ filter: 'drop-shadow(0 0 3px rgba(0,0,0,0.9))', display: 'block' }}
          />
        </div>
      )}
    </div>
  );
});

DrawingCanvas.displayName = 'DrawingCanvas';
