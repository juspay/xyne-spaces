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

// IndexedDB for persisting XyneAI state
const DB_NAME = 'xyneai-state';
const STORE_NAME = 'context';
const MERMAID_STORE_NAME = 'mermaid-diagrams';
const DB_VERSION = 2; // Incremented to add mermaid store

// Initialize IndexedDB
const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(new Error(request.error?.message || 'Failed to open IndexedDB'));
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = event => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Create context store if it doesn't exist
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }

      // Create mermaid diagrams store if it doesn't exist
      if (!db.objectStoreNames.contains(MERMAID_STORE_NAME)) {
        // Store mermaid diagrams with messageId as key
        db.createObjectStore(MERMAID_STORE_NAME);
      }
    };
  });
};

// Save context to IndexedDB
const saveContextToIndexedDB = async (context: Partial<XyneAIContext>): Promise<void> => {
  try {
    const db = await initDB();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.put(context, 'xyneai-context');
  } catch (error) {
    console.error('Failed to save XyneAI context to IndexedDB:', error);
  }
};

// Load context from IndexedDB
export const loadContextFromIndexedDB = async (): Promise<Partial<XyneAIContext> | null> => {
  try {
    const db = await initDB();
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    return new Promise<Partial<XyneAIContext> | null>((resolve, reject) => {
      const request = store.get('xyneai-context');
      request.onsuccess = () => resolve((request.result as Partial<XyneAIContext>) || null);
      request.onerror = () =>
        reject(new Error(request.error?.message || 'Failed to get context from IndexedDB'));
    });
  } catch (error) {
    console.error('Failed to load XyneAI context from IndexedDB:', error);
    return null;
  }
};

// Clear context from IndexedDB
const clearContextFromIndexedDB = async (): Promise<void> => {
  try {
    const db = await initDB();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.delete('xyneai-context');
  } catch (error) {
    console.error('Failed to clear XyneAI context from IndexedDB:', error);
  }
};

// Mermaid diagram storage interface
export interface MermaidDiagram {
  messageId: string;
  diagram: string;
  renderedSvg?: string;
  timestamp: number;
}

// Save mermaid diagram to IndexedDB
export const saveMermaidDiagram = async (
  messageId: string,
  diagram: string,
  renderedSvg?: string,
): Promise<void> => {
  try {
    const db = await initDB();
    const transaction = db.transaction([MERMAID_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(MERMAID_STORE_NAME);

    const mermaidData: MermaidDiagram = {
      messageId,
      diagram,
      ...(renderedSvg !== undefined && { renderedSvg }),
      timestamp: Date.now(),
    };

    store.put(mermaidData, messageId);
  } catch (error) {
    console.error('Failed to save mermaid diagram to IndexedDB:', error);
  }
};

// Load mermaid diagram from IndexedDB
export const loadMermaidDiagram = async (messageId: string): Promise<MermaidDiagram | null> => {
  try {
    const db = await initDB();
    const transaction = db.transaction([MERMAID_STORE_NAME], 'readonly');
    const store = transaction.objectStore(MERMAID_STORE_NAME);

    return new Promise<MermaidDiagram | null>((resolve, reject) => {
      const request = store.get(messageId);
      request.onsuccess = () => resolve((request.result as MermaidDiagram) || null);
      request.onerror = () =>
        reject(new Error(request.error?.message || 'Failed to get mermaid diagram from IndexedDB'));
    });
  } catch (error) {
    console.error('Failed to load mermaid diagram from IndexedDB:', error);
    return null;
  }
};

// Delete mermaid diagram from IndexedDB
export const deleteMermaidDiagram = async (messageId: string): Promise<void> => {
  try {
    const db = await initDB();
    const transaction = db.transaction([MERMAID_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(MERMAID_STORE_NAME);
    store.delete(messageId);
  } catch (error) {
    console.error('Failed to delete mermaid diagram from IndexedDB:', error);
  }
};

// Clear old mermaid diagrams (older than 7 days) to prevent storage bloat
export const clearOldMermaidDiagrams = async (): Promise<void> => {
  try {
    const db = await initDB();
    const transaction = db.transaction([MERMAID_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(MERMAID_STORE_NAME);

    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    const request = store.openCursor();
    request.onsuccess = event => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        const diagram = cursor.value as MermaidDiagram;
        if (diagram.timestamp < sevenDaysAgo) {
          cursor.delete();
        }
        cursor.continue();
      }
    };
  } catch (error) {
    console.error('Failed to clear old mermaid diagrams from IndexedDB:', error);
  }
};

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

        // When opening from closed state with canvas context (Ask AI on canvas),
        // always start a fresh chat unless explicitly overridden
        const startFreshChat =
          event.startFreshChat !== undefined
            ? event.startFreshChat
            : event.canvasInfo !== null && event.canvasInfo !== undefined
              ? true
              : false;

        const newContext = {
          xyneAIState: 'open' as XyneAIState,
          contextType,
          contextId,
          channelId: contextType === 'chat' ? contextId : null, // Legacy support
          threadInfo: event.threadInfo ?? null,
          startFreshChat,
          canvasInfo: event.canvasInfo ?? null,
          canvasContexts: newCanvasContexts,
        };

        // Persist to IndexedDB
        void saveContextToIndexedDB(newContext);

        return newContext;
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

        // When already open and canvas context is provided (Ask AI on canvas),
        // always start a fresh chat unless explicitly overridden
        const startFreshChat =
          event.startFreshChat !== undefined
            ? event.startFreshChat
            : event.canvasInfo !== null && event.canvasInfo !== undefined
              ? true
              : false;

        const newContext = {
          contextType,
          contextId,
          channelId: contextType === 'chat' ? contextId : null, // Legacy support
          threadInfo: event.threadInfo ?? null,
          startFreshChat,
          canvasInfo: event.canvasInfo ?? null,
          canvasContexts: newCanvasContexts,
        };

        // Persist to IndexedDB
        void saveContextToIndexedDB(newContext);

        return newContext;
      }
      return {};
    }),
    setClosed: assign(() => {
      const newContext = {
        xyneAIState: 'closed' as XyneAIState,
        contextType: 'general' as XyneAIContextType,
        contextId: null,
        channelId: null,
        threadInfo: null,
        startFreshChat: false,
        canvasInfo: null,
        canvasContexts: [] as CanvasSelectionContext[],
      };

      // Clear from IndexedDB when closing
      void clearContextFromIndexedDB();

      return newContext;
    }),
    setContext: assign(({ event }) => {
      if (event.type === 'SET_CONTEXT') {
        const newContext = {
          contextType: event.contextType,
          contextId: event.contextId,
          channelId: event.contextType === 'chat' ? event.contextId : null, // Legacy support
        };

        // Persist to IndexedDB
        void saveContextToIndexedDB(newContext);

        return newContext;
      }
      return {};
    }),
    setChannel: assign(({ event }) => {
      if (event.type === 'SET_CHANNEL') {
        const newContext = {
          contextType: 'chat' as XyneAIContextType,
          contextId: event.channelId,
          channelId: event.channelId,
        };

        // Persist to IndexedDB
        void saveContextToIndexedDB(newContext);

        return newContext;
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

// Initialize actor with persisted state
const initializeActor = async (): Promise<void> => {
  try {
    const persistedContext = await loadContextFromIndexedDB();
    if (persistedContext && persistedContext.xyneAIState === 'open') {
      // Restore the open state with persisted context
      // Only include defined values in the send event
      xyneAIActor.send({
        type: 'OPEN',
        ...(persistedContext.contextType !== undefined &&
          persistedContext.contextType !== null && {
            contextType: persistedContext.contextType,
          }),
        ...(persistedContext.contextId !== undefined &&
          persistedContext.contextId !== null && {
            contextId: persistedContext.contextId,
          }),
        ...(persistedContext.channelId !== undefined &&
          persistedContext.channelId !== null && {
            channelId: persistedContext.channelId,
          }),
        ...(persistedContext.threadInfo !== undefined && {
          threadInfo: persistedContext.threadInfo,
        }),
      });
    }

    // Clean up old mermaid diagrams on app startup
    void clearOldMermaidDiagrams();
  } catch (error) {
    console.error('Failed to initialize XyneAI actor with persisted state:', error);
  }
};

// Global XyneAI actor instance
export const xyneAIActor = createActor(xyneAIMachine).start();

// Initialize with persisted state
void initializeActor();
