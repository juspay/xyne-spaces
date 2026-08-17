import { createMachine, createActor, assign } from 'xstate';
import type { EncryptionConfig } from '@xyne/shared/hooks';

export interface EncryptionState {
  key: CryptoKey | null;
  sessionFingerprint: string | null;
  encryptedFields: Record<string, { fields: string[]; enforceClientEncryption: boolean }>;
  clientEncryptionEnabled: boolean;
  apiClientEncryptionEnabled: boolean;
}

interface EncryptionContext {
  state: EncryptionState;
}

type EncryptionEvent =
  | {
      type: 'INIT';
      config: EncryptionConfig;
      sessionFingerprint: string | null;
      key: CryptoKey | null;
    }
  | { type: 'RESET' };

const INITIAL_STATE: EncryptionState = {
  key: null,
  sessionFingerprint: null,
  encryptedFields: {},
  clientEncryptionEnabled: false,
  apiClientEncryptionEnabled: false,
};

const encryptionMachine = createMachine({
  id: 'encryption',
  initial: 'idle',
  types: {
    context: {} as EncryptionContext,
    events: {} as EncryptionEvent,
  },
  context: {
    state: INITIAL_STATE,
  },
  states: {
    idle: {
      on: {
        INIT: {
          target: 'ready',
          actions: assign({
            state: ({ event }) => ({
              key: event.key,
              sessionFingerprint: event.sessionFingerprint,
              encryptedFields: event.config.encryptedFields,
              clientEncryptionEnabled: event.config.clientEncryptionEnabled,
              apiClientEncryptionEnabled: event.config.apiClientEncryptionEnabled,
            }),
          }),
        },
      },
    },
    ready: {
      on: {
        RESET: {
          target: 'idle',
          actions: assign({
            state: INITIAL_STATE,
          }),
        },
      },
    },
  },
});

export const encryptionActor = createActor(encryptionMachine).start();

export function getEncryptionState(): EncryptionState {
  return encryptionActor.getSnapshot().context.state;
}

export function isEncryptionReady(): boolean {
  return encryptionActor.getSnapshot().matches('ready');
}

export function resetEncryption(): void {
  encryptionActor.send({ type: 'RESET' });
}
