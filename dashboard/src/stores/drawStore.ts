/**
 * Draw Store - Manages drawing tool UI state (mode, color, stroke width, tool type).
 * Stroke data itself is kept in per-canvas refs for performance (no React re-renders per point).
 */

import { createStore } from '@xstate/store';

export type DrawTool = 'pen' | 'eraser';

/** Preset colors available in the drawing toolbar */
export const DRAW_COLORS = [
  '#EF4444', // red
  '#F59E0B', // amber
  '#22C55E', // green
  '#3B82F6', // blue
  '#EC4899', // pink
  '#FFFFFF', // white
] as const;

export interface DrawState {
  isDrawingEnabled: boolean;
  color: string;
  strokeWidth: number;
  tool: DrawTool;
}

const initialContext: DrawState = {
  isDrawingEnabled: false,
  color: '#EF4444',
  strokeWidth: 4,
  tool: 'pen',
};

export const drawStore = createStore({
  context: initialContext,
  on: {
    toggleDrawMode: (context): DrawState => ({
      ...context,
      isDrawingEnabled: !context.isDrawingEnabled,
    }),
    disableDrawMode: (context): DrawState => ({
      ...context,
      isDrawingEnabled: false,
    }),
    setColor: (context, event: { color: string }): DrawState => ({
      ...context,
      color: event.color,
      tool: 'pen', // automatically switch to pen when selecting a color
    }),
    setStrokeWidth: (context, event: { width: number }): DrawState => ({
      ...context,
      strokeWidth: event.width,
    }),
    setTool: (context, event: { tool: DrawTool }): DrawState => ({
      ...context,
      tool: event.tool,
    }),
  },
});
