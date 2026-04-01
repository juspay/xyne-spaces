import { createMachine, createActor, fromPromise, assign } from 'xstate';
import { fetchFile } from '../services/clients/fileFetchService';

export interface AttachmentRef {
  attachmentId: string;
  fileName: string;
  fileUrl: string;
  mimeType: string;
  fileSize: number;
  initialTime?: number;
  thumbnailUrl?: string | null;

  // Thread context
  conversationId?: string;
  channelId?: string;
  replyCount?: number;
}

interface AttachmentViewerContext {
  attachments: AttachmentRef[];
  currentIndex: number;
  fileData: File | null;
  status: 'idle' | 'loading' | 'success' | 'error';
  error: string | null;
  retryCount: number;
  currentVideoTime?: number | undefined;
}

type AttachmentViewerEvent =
  | { type: 'OPEN'; attachments: AttachmentRef[]; startIndex?: number }
  | { type: 'UPDATE'; attachments: AttachmentRef[]; startIndex?: number }
  | { type: 'NEXT' }
  | { type: 'PREV' }
  | { type: 'CLOSE' }
  | { type: 'RETRY' }
  | { type: 'SET_VIDEO_TIME'; time: number };

const initialContext: AttachmentViewerContext = {
  attachments: [],
  currentIndex: 0,
  fileData: null,
  status: 'idle',
  error: null,
  retryCount: 0,
};

export const attachmentViewerMachine = createMachine(
  {
    id: 'attachmentViewer',
    initial: 'closed',
    types: {
      context: {} as AttachmentViewerContext,
      events: {} as AttachmentViewerEvent,
    },
    context: initialContext,
    states: {
      closed: {
        on: {
          OPEN: {
            target: 'opening',
            actions: [
              assign({
                attachments: ({ event }) => event.attachments,
                currentIndex: ({ event }) => event.startIndex ?? 0,
                fileData: null,
                status: () => 'loading',
                error: null,
                retryCount: 0,
              }),
            ],
          },
        },
      },
      opening: {
        invoke: {
          src: 'loadAttachment',
          input: ({ context }) => ({
            attachment: context.attachments[context.currentIndex],
          }),
          onDone: {
            target: 'viewing',
            actions: assign({
              fileData: ({ event }) => event.output as File,
              status: () => 'success',
              error: null,
            }),
          },
          onError: {
            target: 'error',
            actions: assign({
              error: ({ event }) =>
                event.error instanceof Error ? event.error.message : 'Failed to load file',
              status: () => 'error',
            }),
          },
        },
        // Handle UPDATE while loading - replace attachments and restart loading
        on: {
          UPDATE: {
            target: 'opening',
            reenter: true,
            actions: assign({
              attachments: ({ event }) => event.attachments,
              currentIndex: ({ event }) => event.startIndex ?? 0,
              fileData: null,
              status: () => 'loading',
              error: null,
              retryCount: 0,
            }),
          },
        },
      },
      viewing: {
        on: {
          CLOSE: {
            target: 'closed',
            actions: assign(({ context }) => ({
              ...initialContext,
              currentVideoTime: context.currentVideoTime,
            })),
          },
          UPDATE: {
            target: 'opening',
            actions: assign({
              attachments: ({ event }) => event.attachments,
              currentIndex: ({ event }) => event.startIndex ?? 0,
              fileData: null,
              status: () => 'loading',
              error: null,
              retryCount: 0,
            }),
          },
          NEXT: {
            target: 'opening',
            guard: ({ context }) => context.currentIndex < context.attachments.length - 1,
            actions: [
              assign({
                currentIndex: ({ context }) => context.currentIndex + 1,
                fileData: null,
                status: () => 'loading',
                error: null,
              }),
            ],
          },
          PREV: {
            target: 'opening',
            guard: ({ context }) => context.currentIndex > 0,
            actions: [
              assign({
                currentIndex: ({ context }) => context.currentIndex - 1,
                fileData: null,
                status: () => 'loading',
                error: null,
              }),
            ],
          },
          SET_VIDEO_TIME: {
            actions: assign({
              currentVideoTime: ({ event }) => event.time,
            }),
          },
        },
      },
      error: {
        on: {
          RETRY: {
            target: 'opening',
            actions: assign(({ context }) => ({
              retryCount: context.retryCount + 1,
              error: null,
              status: 'loading' as const,
            })),
          },
          CLOSE: {
            target: 'closed',
            actions: assign(() => initialContext),
          },
        },
      },
    },
  },
  {
    actors: {
      loadAttachment: fromPromise<File, { attachment: AttachmentRef | undefined }>(
        async ({ input }) => {
          if (!input.attachment) {
            throw new Error('No attachment to load');
          }
          const { attachmentId, fileName, mimeType } = input.attachment;
          return fetchFile(attachmentId, fileName, mimeType);
        },
      ),
    },
  },
);

export const attachmentViewerActor = createActor(attachmentViewerMachine).start();

export type AttachmentViewerState = ReturnType<typeof attachmentViewerActor.getSnapshot>;
