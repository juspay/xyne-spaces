import { Event } from '@xyne/shared/logger';
import type { Instrumentation } from '@xyne/shared/hooks';

import type { Logger } from '../logging/Logger';
import type { AppLogEventMap } from '../logging/events';
import type { MetricsRecorder } from '../metrics/MetricsRecorder';
import {
  readBooleanField,
  readDurationMs,
  readDurationMsOrZero,
  readErrorField,
  readOperationStage,
  readRowCount,
  readStringField,
} from './zeroLogFields';

const CHAT_OPEN_ZERO_QUERIES = new Set(['channelConversationsPaginatedV3']);

export type CreateLotusInstrumentationOptions = Readonly<{
  structuredLogger: Pick<Logger<AppLogEventMap>, 'info' | 'warn' | 'error'>;
  metrics: MetricsRecorder;
  onChatOpenZeroRunComplete?: (fields: Record<string, unknown>) => void;
}>;

export function createLotusInstrumentation(
  options: CreateLotusInstrumentationOptions,
): Instrumentation {
  const { structuredLogger, metrics } = options;

  return {
    logger: {
      debug: () => {},
      info: (event, extraFields) => {
        switch (event) {
          case Event.ZERO_QUERY_CALLED:
            structuredLogger.info(Event.ZERO_QUERY_CALLED, {
              query: readStringField(extraFields, 'query'),
            });
            return;
          case Event.ZERO_QUERY_COMPLETE:
            structuredLogger.info(Event.ZERO_QUERY_COMPLETE, {
              query: readStringField(extraFields, 'query'),
              durationMs: readDurationMsOrZero(extraFields),
              skewed: readBooleanField(extraFields, 'skewed'),
              rowCount: readRowCount(extraFields),
            });
            return;
          case Event.ZERO_MUTATION_CALLED:
            structuredLogger.info(Event.ZERO_MUTATION_CALLED, {
              mutation: readStringField(extraFields, 'mutation'),
            });
            return;
          case Event.ZERO_MUTATION_COMPLETE:
            structuredLogger.info(Event.ZERO_MUTATION_COMPLETE, {
              mutation: readStringField(extraFields, 'mutation'),
              duration: readDurationMsOrZero(extraFields),
              skewed: readBooleanField(extraFields, 'skewed'),
            });
            return;
          case Event.ZERO_RUN_CALLED:
            structuredLogger.info(Event.ZERO_RUN_CALLED, {
              query: readStringField(extraFields, 'query'),
            });
            return;
          case Event.ZERO_RUN_COMPLETE: {
            const query = readStringField(extraFields, 'query');
            const duration = readDurationMsOrZero(extraFields);
            const skewed = readBooleanField(extraFields, 'skewed');

            if (CHAT_OPEN_ZERO_QUERIES.has(query)) {
              options.onChatOpenZeroRunComplete?.({
                ...(extraFields ?? {}),
                query,
                duration,
                durationMs: duration,
                skewed,
              });
            }

            structuredLogger.info(Event.ZERO_RUN_COMPLETE, { query, duration, skewed });
            return;
          }
          default:
            return;
        }
      },
      warn: () => {},
      error: (event, extraFields) => {
        switch (event) {
          case Event.ZERO_QUERY_FAILED:
            structuredLogger.error(Event.ZERO_QUERY_FAILED, {
              query: readStringField(extraFields, 'query'),
              error: readErrorField(extraFields),
            });
            return;
          case Event.ZERO_MUTATION_ERROR: {
            const duration = readDurationMs(extraFields);
            const skewed = extraFields?.['skewed'];
            structuredLogger.error(Event.ZERO_MUTATION_ERROR, {
              mutation: readStringField(extraFields, 'mutation'),
              error: readErrorField(extraFields),
              ...(duration !== undefined ? { duration } : {}),
              ...(typeof skewed === 'boolean' ? { skewed } : {}),
            });
            return;
          }
          case Event.ZERO_RUN_ERROR:
            structuredLogger.error(Event.ZERO_RUN_ERROR, {
              query: readStringField(extraFields, 'query'),
              error: readErrorField(extraFields),
              skewed: readBooleanField(extraFields, 'skewed'),
            });
            return;
          default:
            return;
        }
      },
    },
    metrics: {
      recordLatency: (name, durationMs, attributes) => {
        if (!Number.isFinite(durationMs) || durationMs < 0) {
          return;
        }

        switch (name) {
          case 'zero.query.latency':
            metrics.recordHistogram('zeroQueryLatency', durationMs, {
              query: readStringField(attributes, 'query'),
            });
            return;
          case 'zero.mutation.latency':
            metrics.recordHistogram('zeroMutationLatency', durationMs, {
              mutation: readStringField(attributes, 'mutation'),
            });
            return;
          case 'zero.run.latency':
            metrics.recordHistogram('zeroRunLatency', durationMs, {
              query: readStringField(attributes, 'query'),
            });
            return;
          default:
            return;
        }
      },
      incrementCounter: (name, attributes) => {
        const stage = readOperationStage(attributes);

        switch (name) {
          case 'zero.query.operations':
            metrics.incrementCounter('zeroQueryOperations', {
              query: readStringField(attributes, 'query'),
              stage,
            });
            return;
          case 'zero.mutation.operations':
            metrics.incrementCounter('zeroMutationOperations', {
              mutation: readStringField(attributes, 'mutation'),
              stage,
            });
            return;
          case 'zero.run.operations':
            metrics.incrementCounter('zeroRunOperations', {
              query: readStringField(attributes, 'query'),
              stage,
            });
            return;
          default:
            return;
        }
      },
    },
  };
}
