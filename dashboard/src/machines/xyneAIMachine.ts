import { setup, createActor, assign } from 'xstate';
import { RefObject } from 'react';

// Available XyneAI states
export type XyneAIState = 'closed' | 'open';

// XyneAI context types - what section is XyneAI being used in
export type XyneAIContextType = 'chat' | 'ticket' | 'call' | 'general';

// Thread info interface
export interface ThreadInfo {
  conversationId: string;
  senderName?: string;
  previewText: string;
  attachmentIds?: string[]; // Attachment IDs from the message to fetch from GCS
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
    }
  | { type: 'CLOSE' }
  | { type: 'SET_CONTEXT'; contextType: XyneAIContextType; contextId: string }
  | { type: 'SET_CHANNEL'; channelId: string };

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

export const xyneAIMachine = setup({
  types: {
    context: {} as XyneAIContext,
    events: {} as XyneAIEvent,
  },
  actions: {
    // Update context when transitioning to different states
    setOpen: assign(({ event }) => {
      if (event.type === 'OPEN') {
        // Support both new contextType/contextId and legacy channelId
        const contextType = event.contextType ?? (event.channelId ? 'chat' : 'general');
        const contextId = event.contextId ?? event.channelId ?? null;

        return {
          xyneAIState: 'open' as XyneAIState,
          contextType,
          contextId,
          channelId: contextType === 'chat' ? contextId : null, // Legacy support
          threadInfo: event.threadInfo ?? null,
          startFreshChat: event.startFreshChat ?? false,
        };
      }
      return { xyneAIState: 'open' as XyneAIState };
    }),
    // Update context when already open
    updateOpen: assign(({ event }) => {
      if (event.type === 'OPEN') {
        // Support both new contextType/contextId and legacy channelId
        const contextType = event.contextType ?? (event.channelId ? 'chat' : 'general');
        const contextId = event.contextId ?? event.channelId ?? null;

        return {
          contextType,
          contextId,
          channelId: contextType === 'chat' ? contextId : null, // Legacy support
          threadInfo: event.threadInfo ?? null,
          startFreshChat: event.startFreshChat ?? false,
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
  },
}).createMachine({
  context: () => ({
    xyneAIState: 'closed' as XyneAIState,
    contextType: 'general' as XyneAIContextType,
    contextId: null,
    channelId: null,
    threadInfo: null,
    startFreshChat: false,
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
      },
    },
  },
});

// Global XyneAI actor instance
export const xyneAIActor = createActor(xyneAIMachine).start();
