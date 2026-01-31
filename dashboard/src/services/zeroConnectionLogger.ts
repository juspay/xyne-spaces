import { useRef, useEffect } from 'react';
import type { ConnectionState } from '@rocicorp/zero';
import { logger, Logger } from '../utils/logger';
import {
  zeroSocketConnectionAttemptDuration,
  zeroSocketConnectionTotalDuration,
  zeroSocketConnectionRetriesPerRequest,
  zeroSocketSessionDuration,
  zeroSocketEventsTotal,
  safeRecordMetric,
} from './otel';

export function useZeroConnectionLogger(state: ConnectionState) {
  const connectionStartTime = useRef<number | null>(null);
  const wasConnected = useRef<boolean>(false);
  const connectionAttempts = useRef<number>(0);
  const sessionStartTime = useRef<number | null>(null);
  const firstConnectionAttemptTime = useRef<number | null>(null);
  const previousState = useRef<string | null>(null);

  const getSessionDuration = (): number | null => {
    if (wasConnected.current && sessionStartTime.current) {
      return Date.now() - sessionStartTime.current;
    }
    return null;
  };

  useEffect(() => {
    switch (state.name) {
      case 'connecting': {
        const attemptLatency = connectionStartTime.current
          ? Date.now() - connectionStartTime.current
          : 0;
        const sessionDuration = getSessionDuration();
        connectionAttempts.current += 1;
        if (!firstConnectionAttemptTime.current) {
          firstConnectionAttemptTime.current = Date.now();
        }
        safeRecordMetric(() => {
          logger.info(Logger.Event.ZERO_SOCKET_CONNECTING, {
            reason: state.reason,
            zeroReconnectionAttempts: connectionAttempts.current,
            attemptLatencyMs: attemptLatency,
            currentState: state.name,
            previousState: previousState.current,
            sessionDurationMs: sessionDuration,
          });
          zeroSocketConnectionAttemptDuration.record(attemptLatency);
          zeroSocketEventsTotal.add(1, {
            state: state.name,
            reason: state.reason,
          });
          if (sessionDuration !== null) {
            zeroSocketSessionDuration.record(sessionDuration);
          }
        });
        sessionStartTime.current = null;
        connectionStartTime.current = Date.now();
        break;
      }

      case 'connected': {
        const attemptLatency = connectionStartTime.current
          ? Date.now() - connectionStartTime.current
          : 0;
        const totalLatency = firstConnectionAttemptTime.current
          ? Date.now() - firstConnectionAttemptTime.current
          : attemptLatency;

        logger.info(Logger.Event.ZERO_SOCKET_CONNECTED, {
          latencyMs: attemptLatency,
          totalLatencyMs: totalLatency,
          currentState: state.name,
          previousState: previousState.current,
          connectionAttempts: connectionAttempts.current,
        });
        safeRecordMetric(() => {
          zeroSocketConnectionAttemptDuration.record(attemptLatency);
          zeroSocketConnectionTotalDuration.record(totalLatency);
          zeroSocketConnectionRetriesPerRequest.record(connectionAttempts.current);
          zeroSocketEventsTotal.add(1, {
            state: state.name,
          });
        });
        wasConnected.current = true;
        if (!sessionStartTime.current) {
          sessionStartTime.current = Date.now();
        }
        firstConnectionAttemptTime.current = null;
        connectionStartTime.current = null;
        connectionAttempts.current = 0;
        break;
      }

      case 'disconnected': {
        const sessionDurationDisconnected = getSessionDuration();
        safeRecordMetric(() => {
          logger.warn(Logger.Event.ZERO_SOCKET_DISCONNECTED, {
            reason: state.reason,
            currentState: state.name,
            previousState: previousState.current,
            sessionDurationMs: sessionDurationDisconnected,
          });
          if (sessionDurationDisconnected !== null) {
            zeroSocketSessionDuration.record(sessionDurationDisconnected);
          }
          zeroSocketEventsTotal.add(1, {
            state: state.name,
            reason: typeof state.reason === 'string' ? state.reason : JSON.stringify(state.reason),
          });
        });
        connectionStartTime.current = Date.now();
        sessionStartTime.current = null;
        wasConnected.current = false;
        firstConnectionAttemptTime.current = null;
        break;
      }

      case 'needs-auth': {
        const sessionDurationNeedsAuth = getSessionDuration();
        logger.error(Logger.Event.ZERO_SOCKET_AUTH_REQUIRED, {
          reason: state.reason,
          currentState: state.name,
          previousState: previousState.current,
          sessionDurationMs: sessionDurationNeedsAuth,
        });
        safeRecordMetric(() => {
          if (sessionDurationNeedsAuth !== null) {
            zeroSocketSessionDuration.record(sessionDurationNeedsAuth);
          }
          zeroSocketEventsTotal.add(1, {
            state: state.name,
            reason: typeof state.reason === 'string' ? state.reason : JSON.stringify(state.reason),
          });
        });
        sessionStartTime.current = null;
        connectionStartTime.current = Date.now();
        wasConnected.current = false;
        firstConnectionAttemptTime.current = null;
        break;
      }

      case 'error': {
        const errorAttemptLatency = connectionStartTime.current
          ? Date.now() - connectionStartTime.current
          : 0;
        const sessionDurationError = getSessionDuration();
        logger.error(Logger.Event.ZERO_SOCKET_CONNECTION_ERROR, {
          reason: state.reason,
          currentState: state.name,
          previousState: previousState.current,
          sessionDurationMs: sessionDurationError,
        });
        safeRecordMetric(() => {
          zeroSocketConnectionAttemptDuration.record(errorAttemptLatency);
          if (sessionDurationError !== null) {
            zeroSocketSessionDuration.record(sessionDurationError);
          }
          zeroSocketEventsTotal.add(1, {
            state: state.name,
            reason: typeof state.reason === 'string' ? state.reason : JSON.stringify(state.reason),
          });
        });
        sessionStartTime.current = null;
        wasConnected.current = false;
        connectionStartTime.current = Date.now();
        firstConnectionAttemptTime.current = null;
        break;
      }

      case 'closed': {
        const sessionDurationClosed = getSessionDuration();
        logger.info(Logger.Event.ZERO_SOCKET_CONNECTION_CLOSED, {
          reason: state.reason,
          currentState: state.name,
          previousState: previousState.current,
          sessionDurationMs: sessionDurationClosed,
        });
        safeRecordMetric(() => {
          if (sessionDurationClosed !== null) {
            zeroSocketSessionDuration.record(sessionDurationClosed);
          }
          zeroSocketEventsTotal.add(1, {
            state: state.name,
            reason: typeof state.reason === 'string' ? state.reason : JSON.stringify(state.reason),
          });
        });
        sessionStartTime.current = null;
        wasConnected.current = false;
        firstConnectionAttemptTime.current = null;
        connectionStartTime.current = Date.now();
        break;
      }
    }
    previousState.current = state.name;
  }, [state]);
}
