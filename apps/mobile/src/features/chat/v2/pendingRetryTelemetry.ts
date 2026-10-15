import type { Zero } from '@rocicorp/zero';
import { v4 as uuidv4 } from 'uuid';
import {
  firePendingMutator,
  getCurrentSessionId,
  type PendingMessage,
} from '@xyne/shared/messages';

import { logger } from '@/src/observability/logging/appLogger';
import {
  CHAT_PENDING_RETRY_MUTATION_RESULT,
  CHAT_PENDING_RETRY_TAPPED,
  type ChatPendingRetrySurface,
} from '@/src/observability/logging/events';

type MutationPhase = 'dispatch' | 'client' | 'server';
type MutationOutcome = 'started' | 'success' | 'error' | 'unknown';

type PendingRetryTrace = {
  retryAttemptId: string;
  surface: ChatPendingRetrySurface;
  messageId: string;
  conversationId: string;
  channelId: string;
  sendKind: PendingMessage['kind'];
  mutation: 'messages.send' | 'conversations.send';
};

let retryAttemptSequence = 0;

function createRetryAttemptId(): string {
  try {
    return uuidv4();
  } catch {
    // ID generation is diagnostic only; it must not prevent a retry.
    retryAttemptSequence += 1;
    return `${Date.now()}-${retryAttemptSequence}`;
  }
}

const expectedMutation = (pending: PendingMessage): PendingRetryTrace['mutation'] =>
  pending.kind === 'channel' ? 'conversations.send' : 'messages.send';

const getFailureReason = (
  pending: PendingMessage,
): 'previous_session' | 'mutator_app_error' | 'zero_state_at_send_failed' | 'unknown' => {
  if (pending.sessionId !== getCurrentSessionId()) return 'previous_session';
  if (pending.mutatorAppError) return 'mutator_app_error';
  if (pending.zeroStateAtSend !== 'connected') return 'zero_state_at_send_failed';
  return 'unknown';
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const getErrorFields = (error: unknown): { errorType?: string; error?: string } => {
  if (typeof error === 'string') {
    return { error: error.replace(/[\r\n\t]+/g, ' ').slice(0, 240) };
  }
  if (error instanceof Error) {
    try {
      return {
        errorType: error.name.slice(0, 80),
        error: error.message.replace(/[\r\n\t]+/g, ' ').slice(0, 240),
      };
    } catch {
      return { errorType: 'Error' };
    }
  }
  if (!isRecord(error)) return {};
  try {
    const type = typeof error['type'] === 'string' ? error['type'] : undefined;
    const message = typeof error['message'] === 'string' ? error['message'] : undefined;
    return {
      ...(type ? { errorType: type.slice(0, 80) } : {}),
      ...(message ? { error: message.replace(/[\r\n\t]+/g, ' ').slice(0, 240) } : {}),
    };
  } catch {
    return {};
  }
};

/**
 * Retry a failed pending message from a V2 UI surface and observe the exact
 * Zero client/server result without changing the shared retry implementation.
 */
export function retryPendingMessageFromV2(
  zero: Zero,
  pending: PendingMessage,
  surface: ChatPendingRetrySurface,
): void {
  const retryStartedAt = Date.now();
  const trace: PendingRetryTrace = {
    retryAttemptId: createRetryAttemptId(),
    surface,
    messageId: pending.messageId,
    conversationId: pending.conversationId,
    channelId: pending.channelId,
    sendKind: pending.kind,
    mutation: expectedMutation(pending),
  };

  try {
    logger.info(CHAT_PENDING_RETRY_TAPPED, {
      ...trace,
      failureReason: getFailureReason(pending),
      zeroStateAtSend: pending.zeroStateAtSend,
      zeroStateNow: zero.connection.state.current.name,
    });
  } catch {
    // Telemetry must never block a retry.
  }

  let mutationObserved = false;
  const observedZero = new Proxy(zero, {
    get(target, property) {
      // Zero getters access private fields, so keep the real instance as receiver.
      if (property !== 'mutate') return Reflect.get(target, property, target);

      return (request: Parameters<Zero['mutate']>[0]) => {
        mutationObserved = true;
        const startedAt = Date.now();
        let mutation: ReturnType<Zero['mutate']>;
        try {
          mutation = target.mutate(request as never);
        } catch (error) {
          logMutationResult(trace, 'dispatch', 'error', Date.now() - startedAt, true, error);
          throw error;
        }

        logMutationResult(trace, 'dispatch', 'started', Date.now() - startedAt, true);
        observeMutationPromise(trace, 'client', mutation.client, startedAt);
        observeMutationPromise(trace, 'server', mutation.server, startedAt);
        return mutation;
      };
    },
  });

  try {
    firePendingMutator(observedZero, pending);
  } catch (error) {
    if (!mutationObserved) {
      logMutationResult(trace, 'dispatch', 'error', Date.now() - retryStartedAt, false, error);
    }
    throw error;
  }
}

function observeMutationPromise(
  trace: PendingRetryTrace,
  phase: 'client' | 'server',
  promise: Promise<unknown>,
  startedAt: number,
): void {
  void promise.then(
    result => {
      if (isRecord(result) && result['type'] === 'error') {
        logMutationResult(trace, phase, 'error', Date.now() - startedAt, true, result['error']);
      } else if (isRecord(result) && result['type'] === 'success') {
        logMutationResult(trace, phase, 'success', Date.now() - startedAt, true);
      } else {
        logMutationResult(trace, phase, 'unknown', Date.now() - startedAt, true);
      }
    },
    error => logMutationResult(trace, phase, 'error', Date.now() - startedAt, true, error),
  );
}

function logMutationResult(
  trace: PendingRetryTrace,
  phase: MutationPhase,
  outcome: MutationOutcome,
  durationMs: number,
  zeroMutateCalled: boolean,
  error?: unknown,
): void {
  try {
    const errorFields = outcome === 'error' ? getErrorFields(error) : {};
    const fields = {
      ...trace,
      phase,
      outcome,
      durationMs,
      zeroMutateCalled,
      ...errorFields,
    };
    if (outcome === 'error') {
      logger.error(CHAT_PENDING_RETRY_MUTATION_RESULT, fields);
    } else {
      logger.info(CHAT_PENDING_RETRY_MUTATION_RESULT, fields);
    }
  } catch {
    // Telemetry must never block the send lifecycle.
  }
}
