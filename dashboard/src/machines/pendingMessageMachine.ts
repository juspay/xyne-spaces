/**
 *
 * A lightweight, module-level store that holds optimistic "pending" messages —
 * messages the sender has submitted but whose file-upload round-trips have not
 * yet completed (i.e. awaitEntityUploads is still pending).
 *
 * The sender sees the message immediately in the chat list with spinning
 * attachment thumbnails. Once uploads settle and the Zero mutator fires, the
 * pending entry is removed and the real message from Zero takes over.
 */

import { createMachine, createActor, assign } from 'xstate';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PendingAttachment = {
  /** Stable ID generated alongside the draft-attachment upload */
  id: string;
  name: string;
  mimeType: string;
  objectUrl?: string;
  size?: number;
  width?: number;
  height?: number;
};

export type PendingMessage = {
  /** Temporary UUID — never stored in DB */
  id: string;
  channelId: string;
  conversationId: string | null;
  /** Processed HTML content of the message */
  html: string;
  createdAt: number;
  senderId: string;
  senderName: string;
  senderAvatarUrl?: string | undefined;
  attachments: PendingAttachment[];
};

// ---------------------------------------------------------------------------
// Internal xstate machine
// ---------------------------------------------------------------------------

interface MachineContext {
  messages: PendingMessage[];
}

type MachineEvent =
  | { type: 'addMessage'; message: PendingMessage }
  | { type: 'removeMessage'; id: string };

const pendingMessagesMachine = createMachine(
  {
    id: 'pendingMessages',
    initial: 'active',
    types: {
      context: {} as MachineContext,
      events: {} as MachineEvent,
    },
    context: {
      messages: [] as PendingMessage[],
    },
    states: {
      active: {
        on: {
          addMessage: {
            actions: assign({
              messages: ({ context, event }) => [...context.messages, event.message],
            }),
          },
          removeMessage: {
            actions: assign({
              messages: ({ context, event }) => {
                const existing = context.messages.find((m: PendingMessage) => m.id === event.id);
                if (existing) {
                  // Revoke any object URLs to free memory
                  existing.attachments.forEach((a: PendingAttachment) => {
                    if (a.objectUrl) {
                      URL.revokeObjectURL(a.objectUrl);
                    }
                  });
                }
                return context.messages.filter((m: PendingMessage) => m.id !== event.id);
              },
            }),
          },
        },
      },
    },
  },
  {},
);

// ---------------------------------------------------------------------------
// Actor instance
// ---------------------------------------------------------------------------

const actor = createActor(pendingMessagesMachine).start();

// ---------------------------------------------------------------------------
// Public mutators
// ---------------------------------------------------------------------------

export function addPendingMessage(msg: PendingMessage): void {
  actor.send({ type: 'addMessage', message: msg });
}

export function removePendingMessage(id: string): void {
  actor.send({ type: 'removeMessage', id });
}

// ---------------------------------------------------------------------------
// Store API (for non-hook usage)
// ---------------------------------------------------------------------------

function subscribe(cb: () => void): () => void {
  const subscription = actor.subscribe(() => cb());
  return () => subscription.unsubscribe();
}

function getState(): PendingMessage[] {
  return actor.getSnapshot().context.messages;
}

/**
 * Direct store access for components that manage their own subscription.
 */
export const pendingMessageMachine = {
  subscribe,
  getState,
};
