/**
 * Drawing types and constants for the screen-share annotation feature.
 * Messages are broadcast over LiveKit data channel with topic = DRAW_DATA_TOPIC.
 */

/** LiveKit data channel topic for draw annotation messages */
export const DRAW_DATA_TOPIC = 'draw-annotations';

export type DrawMessageType = 'DRAW_BEGIN' | 'DRAW_POINT' | 'DRAW_END' | 'DRAW_CLEAR';

/** Wire-format message sent over the data channel */
export interface DrawMessage {
  type: DrawMessageType;
  participantIdentity: string;
  strokeId: string;
  /** Normalized canvas coordinate 0–1 (x-axis) */
  x?: number;
  /** Normalized canvas coordinate 0–1 (y-axis) */
  y?: number;
  color?: string;
  width?: number;
  tool?: 'pen' | 'eraser';
  timestamp: number;
}

export interface StrokePoint {
  x: number; // normalized 0–1
  y: number; // normalized 0–1
}

export interface Stroke {
  id: string;
  participantIdentity: string;
  points: StrokePoint[];
  color: string;
  width: number;
  tool: 'pen' | 'eraser';
  isComplete: boolean;
  completedAt?: number;
}
