import { createMachine, createActor, fromPromise, assign } from 'xstate';
import { fetchFile } from '../services/clients/fileFetchService';
import { MessageType } from '@xyne/shared';

export interface AttachmentRef {
  attachmentId: string;
  fileName: string;
  fileUrl: string;
  mimeType: string;
  fileSize: number;
  initialTime?: number;
  initialPage?: number;
  autoPlay?: boolean;
  thumbnailUrl?: string | null;

  // Thread context
  conversationId?: string;
  channelId?: string;
  replyCount?: number;
  // Parent message data for showing synthetic message while thread loads
  parentMessage?: {
    messageId: string;
    senderId: string;
    content: string;
    createdAt: number;
    msgType: MessageType;
    hasAttachment?: boolean;
    attachments?: readonly {
      id: string;
      originalFilename: string;
      mimetype: string;
      size: number;
      thumbnailUrl?: string | null;
      uploadedByUserId: string;
    }[];
    reactions_md?: string | null;
    metadata?: unknown;
    edited?: boolean;
    isDeleted?: boolean;
    conversationId: string;
  };
}

/**
 * Check if mime type is a video that should use streaming
 * instead of full download
 */
const isVideoMimeType = (mimeType: string): boolean => {
  return mimeType.toLowerCase().startsWith('video/');
};

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
                currentVideoTime: () => undefined,
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
          onDone: [
            {
              // If attachment is undefined, transition to waitingForData and wait for UPDATE event
              target: 'waitingForData',
              guard: ({ context }) => !context.attachments[context.currentIndex],
            },
            {
              target: 'viewing',
              actions: assign({
                fileData: ({ event }) => event.output as File | null,
                status: () => 'success',
                error: null,
              }),
            },
          ],
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
          // Allow closing during loading — the invoked actor is automatically cancelled
          // by XState when transitioning away from the `opening` state.
          CLOSE: {
            target: 'closed',
            actions: assign(({ context }) => ({
              ...initialContext,
              currentVideoTime: context.currentVideoTime,
            })),
          },
        },
      },
      waitingForData: {
        // Transient state when attachment data isn't available yet
        // Waits for UPDATE event with valid attachments
        on: {
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
          SET_VIDEO_TIME: {
            actions: assign({
              currentVideoTime: ({ event }) => event.time,
            }),
          },
          CLOSE: {
            target: 'closed',
            actions: assign(({ context }) => ({
              ...initialContext,
              currentVideoTime: context.currentVideoTime,
            })),
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
                attachments: ({ context }) => {
                  const newAttachments = [...context.attachments];
                  const currentAtt = newAttachments[context.currentIndex];
                  if (currentAtt && context.currentVideoTime !== undefined) {
                    currentAtt.initialTime = context.currentVideoTime;
                  }
                  return newAttachments;
                },
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
                attachments: ({ context }) => {
                  const newAttachments = [...context.attachments];
                  const currentAtt = newAttachments[context.currentIndex];
                  if (currentAtt && context.currentVideoTime !== undefined) {
                    currentAtt.initialTime = context.currentVideoTime;
                  }
                  return newAttachments;
                },
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
      loadAttachment: fromPromise<File | null, { attachment: AttachmentRef | undefined }>(
        async ({ input }) => {
          // Return null instead of throwing - the guard in 'opening' state will handle this
          // by transitioning to 'waitingForData' state instead of error state
          if (!input.attachment) {
            return null;
          }
          const { attachmentId, fileName, mimeType } = input.attachment;

          // SHORT CIRCUIT: For video mime types, skip full download and use streaming
          // VideoViewer component uses the /stream endpoint directly, so we don't need
          // to download the full file via fetchFile at the start
          if (isVideoMimeType(mimeType)) {
            return null;
          }

          return fetchFile(attachmentId, fileName, mimeType);
        },
      ),
    },
  },
);

export const attachmentViewerActor = createActor(attachmentViewerMachine).start();

export type AttachmentViewerState = ReturnType<typeof attachmentViewerActor.getSnapshot>;
