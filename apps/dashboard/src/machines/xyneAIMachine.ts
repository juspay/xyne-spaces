import { logger, Event as LogEvent } from '../utils/logger';
import { setup, createActor, assign } from 'xstate';
import { RefObject } from 'react';
import type { CanvasRole } from '../components/Chat/XyneAISidebar/utils/XyneAITypes';

// Available XyneAI states
export type XyneAIState = 'closed' | 'open';

// XyneAI context types - what section is XyneAI being used in
export type XyneAIContextType = 'chat' | 'ticket' | 'call' | 'canvas' | 'general';

// Thread info interface
export interface DeskAutoDraftContext {
  conversationId: string;
  channelId: string;
}

export interface ThreadInfo {
  conversationId: string;
  // The channel the context was captured from. Pinned here rather than read off
  // the machine's live `channelId`, which `SET_CHANNEL` repoints on every chat
  // route change while leaving `threadInfo` attached — without it, clicking the
  // pill after navigating elsewhere routes the captured conversation into
  // whatever channel is currently open. Absent on sessions persisted before it
  // existed; the pill falls back to the current channel then.
  channelId?: string;
  senderName?: string;
  // Lets the context pill show the sender's avatar instead of their name. Absent
  // on non-message contexts (tickets, calls, recordings) and on sessions
  // persisted before it existed — the pill falls back to `senderName` then.
  senderId?: string;
  // The message the context was taken from. Clicking the pill scrolls to and
  // highlights it, the same way activity/search navigation does. Absent on
  // non-message contexts and on sessions persisted before it existed.
  messageId?: string;
  // Whether the context came from inside a thread. Only an explicit `false`
  // routes the pill to the channel instead of the thread panel — contexts that
  // don't know (tickets, calls, recordings) and sessions persisted before this
  // existed leave it undefined and keep opening the thread.
  isThreadMessage?: boolean;
  previewText: string;
  attachmentIds?: string[]; // Attachment IDs from the message to fetch from GCS
}

// Canvas info interface for canvas context
export interface CanvasInfo {
  canvasId: string;
  title?: string;
}

// Selection info interface for selected text from canvas
export interface SelectionInfo {
  text: string;
  preview: string; // First 50 chars for display
  canvasId: string;
  canvasTitle?: string;
}

// Canvas selection context - groups canvas with its selections
// This enforces hierarchy: selections belong to a specific canvas
export interface CanvasSelectionContext {
  canvasId: string;
  title?: string;
  selections: SelectionInfo[];
}

/**
 * Context pills to seed when Ask AI is opened from a surface that already knows
 * exactly which records the question is about. Keeping this in the machine
 * means the global sidebar, rather than an ad-hoc query string, owns the same
 * context that it sends to the Claw API.
 */
export interface AskAIInitialContextSelections {
  /** `canvasRole` marks what an auto-attached canvas IS (a recording attaches
   *  both its AI summary and the user's own notes) so the agent can weigh them
   *  differently. Must stay declared here or the role is dropped in transit. */
  canvases: Array<{ id: string; title: string; canvasId?: string; canvasRole?: CanvasRole }>;
  tickets?: Array<{ id: string; title: string; xyneId?: string; status?: string }>;
  recordings: Array<{
    id: string;
    title: string;
    channelId?: string;
    conversationId?: string;
    externalId?: string;
  }>;
}

export interface XyneAIResearchContext {
  type: 'product' | 'repository';
  id: string;
  name: string;
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
  /** Context pills supplied by the surface that opened Ask AI. */
  initialContextSelections: AskAIInitialContextSelections | null;
  /** Re-seeds context even when a user clicks Ask AI on the same item twice. */
  contextOpenNonce: number;
  /** Session to focus when opening from a background completion toast */
  focusSessionId: string | null;
  /** Set when Ask AI is opened on a Xyne Desk auto-draft. That claw conversation
   *  belongs to the desk persona, so the viewer has no turns of their own in it:
   *  history must be hydrated through the Spaces proxy, and the first message the
   *  viewer sends has to fork the conversation into one they own. */
  deskAutoDraft: DeskAutoDraftContext | null;
  // Knowledge Base context
  kbCollectionId: string | null;
  kbChannelId: string | null;
  // Single-file scope when Ask AI is opened from a file viewer
  kbDocId: string | null;
  kbDocName: string | null;
  // Single-folder scope when Ask AI is opened while browsing inside a
  // sub-folder (not the collection root) — narrower than kbCollectionId,
  // mutually exclusive with it (see the OPEN handler below).
  kbFolderId: string | null;
  kbFolderName: string | null;
  // Bumped on every OPEN dispatched with a kbCollectionId. Lets the input box
  // re-attach the KB collection chip when the user clicks the Ask AI button
  // again from /knowledge-base after manually removing the chip.
  kbOpenNonce: number;
  // Trusted entity selected by the surface opening the assistant.
  researchContext: XyneAIResearchContext | null;
  // Parent-driven message submission (for contextual CTAs such as SDLC actions).
  initialQuery: string | null;
  autoSendNonce: number;
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
      /** When set, selects this Ask AI session after OPEN (e.g. toast View) */
      focusSessionId?: string | null;
      deskAutoDraft?: DeskAutoDraftContext | null;
      kbCollectionId?: string | null;
      kbChannelId?: string | null;
      kbDocId?: string | null;
      kbDocName?: string | null;
      kbFolderId?: string | null;
      kbFolderName?: string | null;
      initialContextSelections?: AskAIInitialContextSelections | null;
      researchContext?: XyneAIResearchContext | null;
      initialQuery?: string | null;
    }
  | { type: 'CLOSE' }
  | { type: 'SET_FOCUS_SESSION'; sessionId: string | null }
  | { type: 'CLEAR_KB_CONTEXT' }
  | { type: 'SET_KB_CONTEXT'; kbCollectionId: string | null; kbChannelId?: string | null }
  | { type: 'SET_CONTEXT'; contextType: XyneAIContextType; contextId: string }
  | { type: 'SET_CHANNEL'; channelId: string }
  | { type: 'SET_TICKET_CONTEXT'; channelId: string; threadInfo: ThreadInfo }
  | { type: 'CLEAR_TICKET_CONTEXT' }
  | { type: 'REMOVE_CANVAS_CONTEXT'; canvasId: string }
  | { type: 'CLEAR_SELECTIONS'; canvasId?: string }
  | { type: 'REMOVE_SELECTION'; canvasId: string; selectionIndex: number };

// Interface for panel handle (to avoid importing react-resizable-panels here).
// Sizes are strings so units are explicit — a bare number means pixels.
interface PanelHandle {
  resize: (size: number | string) => void;
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
    contextMap.set(ctx.canvasId, { ...ctx, selections: [...ctx.selections] });
  }

  // Add or update with new selections
  if (newSelections) {
    for (const selection of newSelections) {
      const canvasId = selection.canvasId;
      const existing = contextMap.get(canvasId);

      if (existing) {
        // Check for duplicate selection
        const isDuplicate = existing.selections.some(s => s.text === selection.text);
        if (!isDuplicate) {
          existing.selections.push(selection);
        }
      } else {
        // Create new context - only include title if defined
        const newContext: CanvasSelectionContext = {
          canvasId,
          selections: [selection],
        };
        if (selection.canvasTitle) {
          newContext.title = selection.canvasTitle;
        }
        contextMap.set(canvasId, newContext);
      }
    }
  }

  // If canvasInfo provided, ensure context exists for it
  if (canvasInfo) {
    const existing = contextMap.get(canvasInfo.canvasId);
    if (!existing) {
      // Create new context - only include title if defined
      const newContext: CanvasSelectionContext = {
        canvasId: canvasInfo.canvasId,
        selections: [],
      };
      if (canvasInfo.title) {
        newContext.title = canvasInfo.title;
      }
      contextMap.set(canvasInfo.canvasId, newContext);
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
    logger.error(LogEvent.FRONTEND_ERROR, {
      type: 'migrated_console_error',
      message: String('Failed to save XyneAI context to IndexedDB:'),
      error: error,
    });
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
    logger.error(LogEvent.FRONTEND_ERROR, {
      type: 'migrated_console_error',
      message: String('Failed to load XyneAI context from IndexedDB:'),
      error: error,
    });
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
    logger.error(LogEvent.FRONTEND_ERROR, {
      type: 'migrated_console_error',
      message: String('Failed to clear XyneAI context from IndexedDB:'),
      error: error,
    });
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
    logger.error(LogEvent.FRONTEND_ERROR, {
      type: 'migrated_console_error',
      message: String('Failed to save mermaid diagram to IndexedDB:'),
      error: error,
    });
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
    logger.error(LogEvent.FRONTEND_ERROR, {
      type: 'migrated_console_error',
      message: String('Failed to load mermaid diagram from IndexedDB:'),
      error: error,
    });
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
    logger.error(LogEvent.FRONTEND_ERROR, {
      type: 'migrated_console_error',
      message: String('Failed to delete mermaid diagram from IndexedDB:'),
      error: error,
    });
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
    logger.error(LogEvent.FRONTEND_ERROR, {
      type: 'migrated_console_error',
      message: String('Failed to clear old mermaid diagrams from IndexedDB:'),
      error: error,
    });
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
        // Determine context type: canvas -> canvas, has channelId -> chat,
        // else preserve existing chat context (from SET_TICKET_CONTEXT), else general.
        let contextType: XyneAIContextType = 'general';
        if (event.canvasInfo) {
          contextType = 'canvas';
        } else if (event.contextType) {
          contextType = event.contextType;
        } else if (event.channelId) {
          contextType = 'chat';
        } else if (context.contextType === 'chat' && context.channelId) {
          // Preserve ticket-context-driven chat state when OPEN has no payload
          contextType = 'chat';
        }

        const contextId = event.contextId ?? event.channelId ?? context.contextId ?? null;

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

        // Preserve existing threadInfo when OPEN doesn't supply one (e.g.,
        // ticket Ask AI button after SET_TICKET_CONTEXT already set it).
        const threadInfo = event.threadInfo !== undefined ? event.threadInfo : context.threadInfo;

        const newContext = {
          xyneAIState: 'open' as XyneAIState,
          contextType,
          contextId,
          channelId: contextType === 'chat' ? contextId : null, // Legacy support
          threadInfo,
          startFreshChat,
          canvasInfo: event.canvasInfo ?? null,
          canvasContexts: newCanvasContexts,
          initialContextSelections: event.initialContextSelections ?? null,
          contextOpenNonce:
            event.initialContextSelections !== undefined
              ? context.contextOpenNonce + 1
              : context.contextOpenNonce,
          focusSessionId:
            'focusSessionId' in event && event.focusSessionId !== undefined
              ? event.focusSessionId
              : null,
          deskAutoDraft: event.deskAutoDraft ?? null,
          kbCollectionId: event.kbCollectionId ?? null,
          kbChannelId: event.kbChannelId ?? null,
          kbDocId: event.kbDocId ?? null,
          kbDocName: event.kbDocName ?? null,
          kbFolderId: event.kbFolderId ?? null,
          kbFolderName: event.kbFolderName ?? null,
          researchContext: event.researchContext ?? null,
          initialQuery: event.initialQuery?.trim() || null,
          autoSendNonce: event.initialQuery?.trim()
            ? context.autoSendNonce + 1
            : context.autoSendNonce,
          // Bump the nonce on every KB-scoped OPEN (collection, file, OR
          // folder) so the sidebar re-attaches the right chip even if the
          // user previously removed it.
          kbOpenNonce:
            event.kbCollectionId || event.kbDocId || event.kbFolderId
              ? context.kbOpenNonce + 1
              : context.kbOpenNonce,
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
        // Determine context type: canvas -> canvas, has channelId -> chat,
        // else preserve existing chat context, else general.
        let contextType: XyneAIContextType = 'general';
        if (event.canvasInfo) {
          contextType = 'canvas';
        } else if (event.contextType) {
          contextType = event.contextType;
        } else if (event.channelId) {
          contextType = 'chat';
        } else if (context.contextType === 'chat' && context.channelId) {
          contextType = 'chat';
        }

        const contextId = event.contextId ?? event.channelId ?? context.contextId ?? null;

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

        const threadInfo = event.threadInfo !== undefined ? event.threadInfo : context.threadInfo;

        const newContext = {
          contextType,
          contextId,
          channelId: contextType === 'chat' ? contextId : null, // Legacy support
          threadInfo,
          startFreshChat,
          canvasInfo: event.canvasInfo ?? null,
          canvasContexts: newCanvasContexts,
          initialContextSelections:
            event.initialContextSelections !== undefined
              ? event.initialContextSelections
              : context.initialContextSelections,
          contextOpenNonce:
            event.initialContextSelections !== undefined
              ? context.contextOpenNonce + 1
              : context.contextOpenNonce,
          focusSessionId:
            'focusSessionId' in event && event.focusSessionId !== undefined
              ? event.focusSessionId
              : context.focusSessionId,
          kbCollectionId:
            event.kbCollectionId !== undefined ? event.kbCollectionId : context.kbCollectionId,
          kbChannelId: event.kbChannelId !== undefined ? event.kbChannelId : context.kbChannelId,
          kbDocId: event.kbDocId !== undefined ? event.kbDocId : context.kbDocId,
          kbDocName: event.kbDocName !== undefined ? event.kbDocName : context.kbDocName,
          kbFolderId: event.kbFolderId !== undefined ? event.kbFolderId : context.kbFolderId,
          kbFolderName:
            event.kbFolderName !== undefined ? event.kbFolderName : context.kbFolderName,
          researchContext: event.researchContext ?? null,
          initialQuery: event.initialQuery?.trim() || null,
          autoSendNonce: event.initialQuery?.trim()
            ? context.autoSendNonce + 1
            : context.autoSendNonce,
          // Re-bump on every KB-scoped OPEN (collection, file, OR folder).
          kbOpenNonce:
            event.kbCollectionId || event.kbDocId || event.kbFolderId
              ? context.kbOpenNonce + 1
              : context.kbOpenNonce,
        };

        // Persist to IndexedDB
        void saveContextToIndexedDB(newContext);

        return newContext;
      }
      return {};
    }),
    clearKbContext: assign(() => {
      const newContext = {
        kbCollectionId: null,
        kbChannelId: null,
        kbDocId: null,
        kbDocName: null,
        kbFolderId: null,
        kbFolderName: null,
      };
      void saveContextToIndexedDB(newContext);
      return newContext;
    }),
    setKbContext: assign(({ event }) => {
      if (event.type === 'SET_KB_CONTEXT') {
        const newContext = {
          kbCollectionId: event.kbCollectionId,
          kbChannelId: event.kbChannelId ?? null,
        };
        void saveContextToIndexedDB(newContext);
        return newContext;
      }
      return {};
    }),
    setClosed: assign(({ context }) => {
      const newContext = {
        xyneAIState: 'closed' as XyneAIState,
        contextType: 'general' as XyneAIContextType,
        contextId: null,
        channelId: null,
        threadInfo: null,
        startFreshChat: false,
        canvasInfo: null,
        canvasContexts: [] as CanvasSelectionContext[],
        initialContextSelections: null,
        contextOpenNonce: context.contextOpenNonce,
        focusSessionId: null,
        deskAutoDraft: null,
        kbCollectionId: null,
        kbChannelId: null,
        kbDocId: null,
        kbDocName: null,
        kbFolderId: null,
        kbFolderName: null,
        kbOpenNonce: context.kbOpenNonce,
        researchContext: null,
        initialQuery: null,
        autoSendNonce: context.autoSendNonce,
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
    setTicketContext: assign(({ event }) => {
      if (event.type === 'SET_TICKET_CONTEXT') {
        const newContext = {
          contextType: 'chat' as XyneAIContextType,
          contextId: event.channelId,
          channelId: event.channelId,
          threadInfo: event.threadInfo,
        };
        void saveContextToIndexedDB(newContext);
        return newContext;
      }
      return {};
    }),
    clearTicketContext: assign(() => {
      const newContext = {
        contextType: 'general' as XyneAIContextType,
        contextId: null,
        channelId: null,
        threadInfo: null,
      };
      void saveContextToIndexedDB(newContext);
      return newContext;
    }),
    // Remove entire canvas context (cascades to all its selections)
    removeCanvasContext: assign(({ event, context }) => {
      if (event.type === 'REMOVE_CANVAS_CONTEXT') {
        const newCanvasContexts = context.canvasContexts.filter(
          ctx => ctx.canvasId !== event.canvasId,
        );
        return {
          canvasContexts: newCanvasContexts,
          // Clear canvasInfo if it matches
          canvasInfo: context.canvasInfo?.canvasId === event.canvasId ? null : context.canvasInfo,
        };
      }
      return {};
    }),
    // Clear selections from a canvas (keeps the canvas context)
    clearSelections: assign(({ event, context }) => {
      if (event.type === 'CLEAR_SELECTIONS') {
        if (event.canvasId) {
          // Clear selections for specific canvas
          const newCanvasContexts = context.canvasContexts.map(ctx => {
            if (ctx.canvasId === event.canvasId) {
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
          if (ctx.canvasId === event.canvasId) {
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
    setFocusSession: assign(({ event }) => {
      if (event.type === 'SET_FOCUS_SESSION') {
        return { focusSessionId: event.sessionId };
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
    initialContextSelections: null,
    contextOpenNonce: 0,
    focusSessionId: null,
    deskAutoDraft: null,
    kbCollectionId: null,
    kbChannelId: null,
    kbDocId: null,
    kbDocName: null,
    kbFolderId: null,
    kbFolderName: null,
    kbOpenNonce: 0,
    researchContext: null,
    initialQuery: null,
    autoSendNonce: 0,
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
        SET_TICKET_CONTEXT: {
          actions: 'setTicketContext',
        },
        CLEAR_TICKET_CONTEXT: {
          actions: 'clearTicketContext',
        },
        CLEAR_KB_CONTEXT: {
          actions: 'clearKbContext',
        },
        SET_KB_CONTEXT: {
          actions: 'setKbContext',
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
        CLEAR_KB_CONTEXT: {
          actions: 'clearKbContext',
        },
        SET_KB_CONTEXT: {
          actions: 'setKbContext',
        },
        SET_CONTEXT: {
          actions: 'setContext',
        },
        SET_CHANNEL: {
          actions: 'setChannel',
        },
        SET_TICKET_CONTEXT: {
          actions: 'setTicketContext',
        },
        CLEAR_TICKET_CONTEXT: {
          actions: 'clearTicketContext',
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
        SET_FOCUS_SESSION: {
          actions: 'setFocusSession',
        },
      },
    },
  },
});

// Initialize actor with persisted state
const initializeActor = async (): Promise<void> => {
  try {
    const persistedContext = await loadContextFromIndexedDB();
    const isSdlcRoute = window.location.pathname.split('/').includes('sdlc');
    if (persistedContext && persistedContext.xyneAIState === 'open' && !isSdlcRoute) {
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
        ...(persistedContext.initialContextSelections !== undefined && {
          initialContextSelections: persistedContext.initialContextSelections,
        }),
      });
    }

    // Clean up old mermaid diagrams on app startup
    void clearOldMermaidDiagrams();
  } catch (error) {
    logger.error(LogEvent.FRONTEND_ERROR, {
      type: 'migrated_console_error',
      message: String('Failed to initialize XyneAI actor with persisted state:'),
      error: error,
    });
  }
};

// Global XyneAI actor instance
export const xyneAIActor = createActor(xyneAIMachine).start();

// Initialize with persisted state
void initializeActor();
