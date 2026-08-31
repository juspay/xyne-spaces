import { setup, assign, createActor, fromPromise } from 'xstate';
import { CallType } from '@xyne/shared';
import { roomActor } from './roomMachine';
import type { Zero } from '@rocicorp/zero';
import { detectPlatform } from '../hooks/usePlatform';
import { logger, Event } from '../utils/logger';

// Simplified context - only what we need for main screen states
export interface CallContext {
  // Queue of incoming calls (first item is the active incoming call)
  incomingCallQueue: Array<{
    callId: string;
    caller: {
      id: string;
      name: string;
      email: string;
      picture?: string;
    };
    callType: CallType;
  }>;
  // Store the callId being accepted to use after removing from queue
  acceptingCallId: string | null;
  // Store zero instance to use after state transitions
  zero: Zero | null;
  // Track call ID that was joined via native VoIP notification (before Zero syncs)
  // Used to prevent IncomingCallModal from showing for calls already joined from native
  nativeActiveCallId: string | null;
}

// Simplified event types - only accept/reject for incoming calls
export type CallEvent =
  | { type: 'INCOMING_CALL'; callData: CallContext['incomingCallQueue'][0] }
  | { type: 'ACCEPT'; zero: Zero | null; callId?: string | undefined }
  | { type: 'REJECT'; callId?: string | undefined }
  | { type: 'SWITCH_CALL'; zero: Zero | null; callId?: string | undefined }
  | { type: 'SET_NATIVE_ACTIVE_CALL'; callId: string }
  | { type: 'CLEAR_NATIVE_ACTIVE_CALL' };

export const callMachine = setup({
  types: {
    context: {} as CallContext,
    events: {} as CallEvent,
  },
  actors: {
    // Actor to wait for room to disconnect before joining new call
    waitForDisconnect: fromPromise(async (): Promise<void> => {
      // Poll roomActor state until it reaches 'idle'
      return new Promise<void>(resolve => {
        const checkState = (): void => {
          const roomState = roomActor.getSnapshot().value;
          if (roomState === 'idle') {
            resolve();
          } else {
            setTimeout(checkState, 100); // Check every 100ms
          }
        };
        checkState();
      });
    }),

    // Actor to join call - just sends JOIN_CALL to roomActor
    joinCall: fromPromise(
      ({
        input,
      }: {
        input: { callId: string; zero: Zero | null };
      }): Promise<{ callId: string }> => {
        const { callId, zero } = input;

        // Debug: Check roomActor state before sending
        const currentState = roomActor.getSnapshot().value;
        logger.info(Event.LIVEKIT_ROOM_EVENT, {
          callId,
          eventName: 'join_call_sent_to_room_actor',
          hasZero: !!zero,
          roomActorState: currentState,
        });
        // Detect platform to set appropriate viewMode
        const platform = detectPlatform();
        const isMobile = platform === 'mobile';

        // Send JOIN_CALL event to roomActor (it will handle token fetching and connection)
        // Desktop: mini view, Mobile: full view
        roomActor.send({
          type: 'JOIN_CALL',
          callId,
          zero,
          viewMode: isMobile ? 'full' : 'mini',
        });

        return Promise.resolve({ callId });
      },
    ),
  },
  guards: {
    queueIsEmpty: ({ context }) => context.incomingCallQueue.length === 0,
    isInActiveCall: () => {
      const snapshot = roomActor.getSnapshot();
      return (
        snapshot.matches('initiating') ||
        snapshot.matches('joining') ||
        snapshot.matches('connecting') ||
        snapshot.matches('connected')
      );
    },
  },
  actions: {
    // Disconnect from current call via roomActor
    disconnectCurrentCall: () => {
      roomActor.send({ type: 'DISCONNECT' });
    },

    // Store zero from the event
    storeZero: assign({
      zero: ({ event }) =>
        event.type === 'ACCEPT' || event.type === 'SWITCH_CALL' ? event.zero : null,
    }),

    // Store the callId being accepted before removing from queue
    storeAcceptingCallId: assign({
      acceptingCallId: ({ context, event }) => {
        const requested =
          event.type === 'ACCEPT' || event.type === 'SWITCH_CALL' ? event.callId : undefined;
        return requested ?? context.incomingCallQueue[0]?.callId ?? null;
      },
    }),

    // Clear the accepting callId and zero after joining
    clearAcceptingCallId: assign({
      acceptingCallId: () => null,
      zero: () => null,
    }),

    // Add incoming call to queue
    addIncomingCall: assign({
      incomingCallQueue: ({ context, event }) => {
        if (event.type === 'INCOMING_CALL' && event.callData) {
          // Add to queue if not already present (prevent duplicates)
          const exists = context.incomingCallQueue.some(
            call => call.callId === event.callData.callId,
          );
          if (!exists) {
            return [...context.incomingCallQueue, event.callData];
          }
        }
        return context.incomingCallQueue;
      },
    }),

    // Remove the accepted call by id. Positional removal drops whichever entry is at
    // the head, which is the oldest call queued — not necessarily the one being joined.
    removeAcceptedFromQueue: assign({
      incomingCallQueue: ({ context }) =>
        context.acceptingCallId
          ? context.incomingCallQueue.filter(call => call.callId !== context.acceptingCallId)
          : context.incomingCallQueue.slice(1),
    }),

    // Remove the rejected call by id, so the queue stays in step with the call the
    // reject mutator actually ended.
    removeRejectedFromQueue: assign({
      incomingCallQueue: ({ context, event }) => {
        const rejectedId =
          (event.type === 'REJECT' ? event.callId : undefined) ??
          context.incomingCallQueue[0]?.callId;
        return rejectedId
          ? context.incomingCallQueue.filter(call => call.callId !== rejectedId)
          : context.incomingCallQueue.slice(1);
      },
    }),

    // Set native active call ID (from VoIP notification join)
    setNativeActiveCallId: assign({
      nativeActiveCallId: ({ event }) =>
        event.type === 'SET_NATIVE_ACTIVE_CALL' ? event.callId : null,
      // Also remove from incoming queue if present (prevents double modal)
      incomingCallQueue: ({ context, event }) => {
        if (event.type === 'SET_NATIVE_ACTIVE_CALL') {
          return context.incomingCallQueue.filter(call => call.callId !== event.callId);
        }
        return context.incomingCallQueue;
      },
    }),

    // Clear native active call ID (when call ends)
    clearNativeActiveCallId: assign({
      nativeActiveCallId: () => null,
    }),
  },
}).createMachine({
  context: () => ({
    incomingCallQueue: [],
    acceptingCallId: null,
    zero: null,
    nativeActiveCallId: null,
  }),
  id: 'callMachine',
  initial: 'idle',
  states: {
    idle: {
      on: {
        INCOMING_CALL: {
          target: 'ringing',
          actions: 'addIncomingCall',
        },
        // Native call events can be received in any state
        SET_NATIVE_ACTIVE_CALL: {
          actions: 'setNativeActiveCallId',
        },
        CLEAR_NATIVE_ACTIVE_CALL: {
          actions: 'clearNativeActiveCallId',
        },
      },
    },
    ringing: {
      on: {
        ACCEPT: {
          target: 'accepting',
          actions: ['storeZero', 'storeAcceptingCallId'],
        },
        REJECT: {
          target: 'ringing',
          actions: 'removeRejectedFromQueue',
        },
        SWITCH_CALL: {
          guard: 'isInActiveCall',
          target: 'switching',
          actions: ['storeZero', 'storeAcceptingCallId'],
        },
        INCOMING_CALL: {
          actions: 'addIncomingCall',
        },
        // Native call events - also clears matching call from queue
        SET_NATIVE_ACTIVE_CALL: {
          actions: 'setNativeActiveCallId',
        },
        CLEAR_NATIVE_ACTIVE_CALL: {
          actions: 'clearNativeActiveCallId',
        },
      },
      // After entering ringing state, check if queue is empty
      always: {
        target: 'idle',
        guard: 'queueIsEmpty',
      },
    },
    switching: {
      entry: 'disconnectCurrentCall',
      invoke: {
        src: 'waitForDisconnect',
        onDone: {
          target: 'accepting',
        },
        onError: {
          target: 'ringing',
        },
      },
    },
    accepting: {
      entry: [
        ({ context }): void => {
          logger.info(Event.LIVEKIT_ROOM_EVENT, {
            callId: context.acceptingCallId,
            eventName: 'accepting_state_entered',
            queueLength: context.incomingCallQueue.length,
          });
        },
        'removeAcceptedFromQueue',
      ],
      invoke: {
        src: 'joinCall',
        input: ({ context }) => ({
          callId: context.acceptingCallId || '',
          zero: context.zero,
        }),
        // Back to ringing, not idle: a second call can still be queued, and idle only
        // re-enters ringing on a fresh INCOMING_CALL — which addIncomingCall dedupes
        // away, stranding that call. ringing's always-guard falls through to idle when
        // the queue is empty.
        onDone: {
          target: 'ringing',
          actions: 'clearAcceptingCallId',
        },
        onError: {
          target: 'ringing',
          actions: 'clearAcceptingCallId',
        },
      },
    },
  },
});

// Create the global call actor instance
export const callActor = createActor(callMachine).start();
