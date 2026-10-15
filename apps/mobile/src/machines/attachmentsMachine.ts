import { setup, assign, createActor } from 'xstate';

export type AttachmentsViewerItem = {
  id: string;
  mimetype: string;
  originalFilename?: string | undefined;
  size?: number | undefined;
};

export type AttachmentsViewerSource = {
  kind: 'message' | 'ticket' | 'search' | 'other';
  id: string;
};

export interface AttachmentsContext {
  attachments: AttachmentsViewerItem[];
  currentIndex: number;
  source: AttachmentsViewerSource | null;
}

export type AttachmentsEvent =
  | {
      type: 'OPEN';
      attachments: AttachmentsViewerItem[];
      initialIndex?: number;
      source?: AttachmentsViewerSource;
    }
  | { type: 'CLOSE' }
  | { type: 'SET_INDEX'; index: number };

const initialContext: AttachmentsContext = {
  attachments: [],
  currentIndex: 0,
  source: null,
};

export const attachmentsMachine = setup({
  types: {
    context: {} as AttachmentsContext,
    events: {} as AttachmentsEvent,
  },
  actions: {
    setOpenContext: assign(({ event }) => {
      if (event.type !== 'OPEN') return {};
      const initialIndex = event.initialIndex ?? 0;
      const clampedIndex =
        event.attachments.length === 0
          ? 0
          : Math.max(0, Math.min(initialIndex, event.attachments.length - 1));
      return {
        attachments: event.attachments,
        currentIndex: clampedIndex,
        source: event.source ?? null,
      };
    }),
    resetContext: assign(() => initialContext),
    setIndex: assign(({ context, event }) => {
      if (event.type !== 'SET_INDEX') return {};
      const max = context.attachments.length - 1;
      if (max < 0) return {};
      return {
        currentIndex: Math.max(0, Math.min(event.index, max)),
      };
    }),
  },
}).createMachine({
  id: 'attachments',
  initial: 'idle',
  context: initialContext,
  states: {
    idle: {
      on: {
        OPEN: { target: 'open', actions: 'setOpenContext' },
      },
    },
    open: {
      on: {
        CLOSE: { target: 'idle', actions: 'resetContext' },
        SET_INDEX: { actions: 'setIndex' },
        OPEN: { actions: 'setOpenContext' },
      },
    },
  },
});

export const attachmentsActor = createActor(attachmentsMachine);
attachmentsActor.start();
