import type { Instrumentation } from '@xyne/shared/hooks';
import { logger } from '../../utils/logger';
import {
  zeroQueryLatency,
  zeroQueryOperations,
  zeroMutationLatency,
  zeroMutationOperations,
  zeroRunLatency,
  zeroRunOperations,
  safeRecordMetric,
} from './index';

/** Logger and Zero metrics for @xyne/shared, shared by the app and the call window. */
export const dashboardInstrumentation: Instrumentation = {
  logger,
  metrics: {
    recordLatency: (name: string, durationMs: number, attributes?: Record<string, string>) => {
      safeRecordMetric(() => {
        if (name === 'zero.query.latency') {
          zeroQueryLatency.record(durationMs, attributes);
        } else if (name === 'zero.mutation.latency') {
          zeroMutationLatency.record(durationMs, attributes);
        } else if (name === 'zero.run.latency') {
          zeroRunLatency.record(durationMs, attributes);
        }
      });
    },
    incrementCounter: (name: string, attributes?: Record<string, string>) => {
      safeRecordMetric(() => {
        if (name === 'zero.query.operations') {
          zeroQueryOperations.add(1, attributes);
        } else if (name === 'zero.mutation.operations') {
          zeroMutationOperations.add(1, attributes);
        } else if (name === 'zero.run.operations') {
          zeroRunOperations.add(1, attributes);
        }
      });
    },
  },
};
