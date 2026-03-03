import { setup, createActor, assign } from 'xstate';
import { RefObject } from 'react';

// Available XyneAI states
export type XyneAIState = 'closed' | 'open';

// XyneAI context types - what section is XyneAI being used in
export type XyneAIContextType = 'chat' | 'ticket' | 'call' | 'canvas' | 'general';

// Thread info interface
export interface ThreadInfo {
  conversationId: string;
  senderName?: string;
  previewText: string;
  attachmentIds?: string[]; // Attachment IDs from the message to fetch from GCS
}

// Canvas info interface for canvas context
export interface CanvasInfo {
  viewAccessId: string;
  title?: string;
}

// Selection info interface for selected text from canvas
export interface SelectionInfo {
  text: string;
  preview: string; // First 50 chars for display
  canvasViewAccessId: string;
  canvasTitle?: string;
}

// Canvas selection context - groups canvas with its selections
// This enforces hierarchy: selections belong to a specific canvas
export interface CanvasSelectionContext {
  viewAccessId: string;
  title?: string;
  selections: SelectionInfo[];
}

// Context interface for the XyneAI machine
export interface XyneAIContext {
  xyneAIState: XyneAIState;
  contextType: XyneAIContextType;
  contextId: string | null; // channelId, ticketId, callId, or null for general
  // Legacy support
  channelId: string | null;
  // Thread context
  threadInfo: ThreadInfo | null;
  // Flag to indicate a fresh chat should be started
  startFreshChat: boolean;
  // Canvas context (legacy - kept for backward compatibility)
  canvasInfo: CanvasInfo | null;
  // Canvas selection context - groups canvas with its selections
  canvasContexts: CanvasSelectionContext[];
}

// Event types for XyneAI machine
export type XyneAIEvent =
  | {
      type: 'OPEN';
      contextType?: XyneAIContextType;
      contextId?: string;
      channelId?: string;
      threadInfo?: ThreadInfo | null;
      startFreshChat?: boolean;
      canvasInfo?: CanvasInfo | null;
      selectionInfo?: SelectionInfo | null;
      selectionInfos?: SelectionInfo[];
    }
  | { type: 'CLOSE' }
  | { type: 'SET_CONTEXT'; contextType: XyneAIContextType; contextId: string }
  | { type: 'SET_CHANNEL'; channelId: string }
  | { type: 'REMOVE_CANVAS_CONTEXT'; viewAccessId: string }
  | { type: 'CLEAR_SELECTIONS'; viewAccessId?: string }
  | { type: 'REMOVE_SELECTION'; viewAccessId: string; selectionIndex: number };

// Interface for panel handle (to avoid importing react-resizable-panels here)
interface PanelHandle {
  resize: (size: number) => void;
}

// Panel refs interface
interface PanelRefs {
  left: RefObject<PanelHandle | null>;
  right: RefObject<PanelHandle | null>;
}

// Global panel refs that will be set by AppRoot
export let globalXyneAIPanelRefs: PanelRefs = {
  left: { current: null },
  right: { current: null },
};

// Function to set panel refs from AppRoot
export const setXyneAIPanelRefs = (panelRefs: PanelRefs): void => {
  globalXyneAIPanelRefs = panelRefs;
};

/**
 * Helper function to build canvasContexts from selections
 * This maintains the hierarchical relationship between canvases and their selections
 */
function buildCanvasContexts(
  existingContexts: CanvasSelectionContext[],
  newSelections?: SelectionInfo[],
  canvasInfo?: CanvasInfo | null,
): CanvasSelectionContext[] {
  const contextMap = new Map<string, CanvasSelectionContext>();

  // Add existing contexts to map
  for (const ctx of existingContexts) {
    contextMap.set(ctx.viewAccessId, { ...ctx, selections: [...ctx.selections] });
  }

  // Add or update with new selections
  if (newSelections) {
    for (const selection of newSelections) {
      const viewAccessId = selection.canvasViewAccessId;
      const existing = contextMap.get(viewAccessId);

      if (existing) {
        // Check for duplicate selection
        const isDuplicate = existing.selections.some(s => s.text === selection.text);
        if (!isDuplicate) {
          existing.selections.push(selection);
        }
      } else {
        // Create new context - only include title if defined
        const newContext: CanvasSelectionContext = {
          viewAccessId,
          selections: [selection],
        };
        if (selection.canvasTitle) {
          newContext.title = selection.canvasTitle;
        }
        contextMap.set(viewAccessId, newContext);
      }
    }
  }

  // If canvasInfo provided, ensure context exists for it
  if (canvasInfo) {
    const existing = contextMap.get(canvasInfo.viewAccessId);
    if (!existing) {
      // Create new context - only include title if defined
      const newContext: CanvasSelectionContext = {
        viewAccessId: canvasInfo.viewAccessId,
        selections: [],
      };
      if (canvasInfo.title) {
        newContext.title = canvasInfo.title;
      }
      contextMap.set(canvasInfo.viewAccessId, newContext);
    } else if (canvasInfo.title && !existing.title) {
      existing.title = canvasInfo.title;
    }
  }

  return Array.from(contextMap.values());
}

/**
 * Helper function to flatten canvasContexts to SelectionInfo array
 * Used for backward compatibility with components that expect flat array
 */
export function flattenCanvasContexts(canvasContexts: CanvasSelectionContext[]): SelectionInfo[] {
  return canvasContexts.flatMap(ctx => ctx.selections);
}

export const xyneAIMachine = setup({
  types: {
    context: {} as XyneAIContext,
    events: {} as XyneAIEvent,
  },
  actions: {
    // Update context when transitioning to different states
    setOpen: assign(({ event, context }) => {
      if (event.type === 'OPEN') {
        // Determine context type: canvas -> canvas, has channelId -> chat, else general
        let contextType: XyneAIContextType = 'general';
        if (event.canvasInfo) {
          contextType = 'canvas';
        } else if (event.contextType) {
          contextType = event.contextType;
        } else if (event.channelId) {
          contextType = 'chat';
        }

        const contextId = event.contextId ?? event.channelId ?? null;

        // Build new canvasContexts from selections
        const newCanvasContexts = buildCanvasContexts(
          context.canvasContexts,
          event.selectionInfo ? [event.selectionInfo] : event.selectionInfos,
          event.canvasInfo,
        );

        return {
          xyneAIState: 'open' as XyneAIState,
          contextType,
          contextId,
          channelId: contextType === 'chat' ? contextId : null, // Legacy support
          threadInfo: event.threadInfo ?? null,
          startFreshChat: event.startFreshChat ?? false,
          canvasInfo: event.canvasInfo ?? null,
          canvasContexts: newCanvasContexts,
        };
      }
      return { xyneAIState: 'open' as XyneAIState };
    }),
    // Update context when already open
    updateOpen: assign(({ event, context }) => {
      if (event.type === 'OPEN') {
        // Determine context type: canvas -> canvas, has channelId -> chat, else general
        let contextType: XyneAIContextType = 'general';
        if (event.canvasInfo) {
          contextType = 'canvas';
        } else if (event.contextType) {
          contextType = event.contextType;
        } else if (event.channelId) {
          contextType = 'chat';
        }

        const contextId = event.contextId ?? event.channelId ?? null;

        // Build new canvasContexts from selections
        const newCanvasContexts = buildCanvasContexts(
          context.canvasContexts,
          event.selectionInfo ? [event.selectionInfo] : event.selectionInfos,
          event.canvasInfo,
        );

        return {
          contextType,
          contextId,
          channelId: contextType === 'chat' ? contextId : null, // Legacy support
          threadInfo: event.threadInfo ?? null,
          startFreshChat: event.startFreshChat ?? false,
          canvasInfo: event.canvasInfo ?? null,
          canvasContexts: newCanvasContexts,
        };
      }
      return {};
    }),
    setClosed: assign({
      xyneAIState: 'closed' as XyneAIState,
      contextType: 'general' as XyneAIContextType,
      contextId: null,
      channelId: null,
      threadInfo: null,
      startFreshChat: false,
      canvasInfo: null,
      canvasContexts: [],
    }),
    setContext: assign(({ event }) => {
      if (event.type === 'SET_CONTEXT') {
        return {
          contextType: event.contextType,
          contextId: event.contextId,
          channelId: event.contextType === 'chat' ? event.contextId : null, // Legacy support
        };
      }
      return {};
    }),
    setChannel: assign(({ event }) => {
      if (event.type === 'SET_CHANNEL') {
        return {
          contextType: 'chat' as XyneAIContextType,
          contextId: event.channelId,
          channelId: event.channelId,
        };
      }
      return {};
    }),
    // Remove entire canvas context (cascades to all its selections)
    removeCanvasContext: assign(({ event, context }) => {
      if (event.type === 'REMOVE_CANVAS_CONTEXT') {
        const newCanvasContexts = context.canvasContexts.filter(
          ctx => ctx.viewAccessId !== event.viewAccessId,
        );
        return {
          canvasContexts: newCanvasContexts,
          // Clear canvasInfo if it matches
          canvasInfo:
            context.canvasInfo?.viewAccessId === event.viewAccessId ? null : context.canvasInfo,
        };
      }
      return {};
    }),
    // Clear selections from a canvas (keeps the canvas context)
    clearSelections: assign(({ event, context }) => {
      if (event.type === 'CLEAR_SELECTIONS') {
        if (event.viewAccessId) {
          // Clear selections for specific canvas
          const newCanvasContexts = context.canvasContexts.map(ctx => {
            if (ctx.viewAccessId === event.viewAccessId) {
              return { ...ctx, selections: [] };
            }
            return ctx;
          });
          return {
            canvasContexts: newCanvasContexts,
          };
        } else {
          // Clear all selections from all canvases
          const newCanvasContexts = context.canvasContexts.map(ctx => ({
            ...ctx,
            selections: [],
          }));
          return {
            canvasContexts: newCanvasContexts,
          };
        }
      }
      return {};
    }),
    // Remove a specific selection from a canvas
    removeSelection: assign(({ event, context }) => {
      if (event.type === 'REMOVE_SELECTION') {
        const newCanvasContexts = context.canvasContexts.map(ctx => {
          if (ctx.viewAccessId === event.viewAccessId) {
            return {
              ...ctx,
              selections: ctx.selections.filter((_, i) => i !== event.selectionIndex),
            };
          }
          return ctx;
        });
        return {
          canvasContexts: newCanvasContexts,
        };
      }
      return {};
    }),
  },
}).createMachine({
  context: () => ({
    xyneAIState: 'closed' as XyneAIState,
    contextType: 'general' as XyneAIContextType,
    contextId: null,
    channelId: null,
    threadInfo: null,
    startFreshChat: false,
    canvasInfo: null,
    canvasContexts: [],
  }),
  id: 'xyneAIMachine',
  initial: 'closed',
  states: {
    closed: {
      on: {
        OPEN: {
          target: 'open',
          actions: 'setOpen',
        },
      },
    },
    open: {
      on: {
        OPEN: {
          actions: 'updateOpen',
        },
        CLOSE: {
          target: 'closed',
          actions: 'setClosed',
        },
        SET_CONTEXT: {
          actions: 'setContext',
        },
        SET_CHANNEL: {
          actions: 'setChannel',
        },
        REMOVE_CANVAS_CONTEXT: {
          actions: 'removeCanvasContext',
        },
        CLEAR_SELECTIONS: {
          actions: 'clearSelections',
        },
        REMOVE_SELECTION: {
          actions: 'removeSelection',
        },
      },
    },
  },
});

// Global XyneAI actor instance
export const xyneAIActor = createActor(xyneAIMachine).start();
