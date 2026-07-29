import { useZero as useOriginalZero } from '@rocicorp/zero/react';
import type {
  Zero,
  MutateRequest,
  PromiseWithServerResult,
  ReadonlyJSONValue,
  QueryRequest,
  Query,
  HumanReadable,
} from '@rocicorp/zero';
import { createContext, useContext } from 'react';
import type { Logger, MetricsRecorder } from '../logger/index.js';
import { noopLogger, noopMetrics } from '../logger/index.js';
import { Event } from '../logger/events.js';
import { wasInterrupted } from './metricValidity.js';
import { trackMutationStart, trackMutationSettled } from './pendingMutations.js';

/**
 * Instrumentation context — inject logger + metrics at the app root.
 */
export interface Instrumentation {
  logger: Logger;
  metrics: MetricsRecorder;
}

const InstrumentationContext = createContext<Instrumentation>({
  logger: noopLogger,
  metrics: noopMetrics,
});

export const InstrumentationProvider = InstrumentationContext.Provider;
export const useInstrumentation = (): Instrumentation => useContext(InstrumentationContext);

interface RunOptionsWithName {
  queryName?: string;
  [key: string]: unknown;
}

/**
 * Shared useZero with Proxy instrumentation.
 * Intercepts mutate() and run() calls for logging and metrics.
 * Both dashboard and lotus use this — instrumentation comes from InstrumentationProvider.
 */
export function useZero(): Zero {
  const originalZero = useOriginalZero();
  const { logger, metrics } = useInstrumentation();

  const handler: ProxyHandler<Zero> = {
    get(target, prop) {
      if (prop === 'mutate') {
        return <TArgs extends ReadonlyJSONValue | undefined>(
          mutationRequest: MutateRequest<TArgs>,
        ): PromiseWithServerResult => {
          const startTime = performance.now();
          const mutationName = mutationRequest.mutator.mutatorName;

          logger.info(Event.ZERO_MUTATION_CALLED, { mutation: mutationName });
          metrics.incrementCounter('zero.mutation.operations', {
            mutation: mutationName,
            stage: 'start',
          });

          trackMutationStart();
          const result = target.mutate(mutationRequest as Parameters<Zero['mutate']>[0]);

          Promise.all([result.client, result.server])
            .then(([_clientResult, serverResult]) => {
              const duration = performance.now() - startTime;
              const skewed = wasInterrupted(startTime);
              let hasError = false;
              let errorMessage = '';

              if (serverResult && typeof serverResult === 'object') {
                const sr = serverResult as Record<string, unknown>;
                if (sr.type === 'error' && sr.error) {
                  hasError = true;
                  const err = sr.error as Record<string, unknown>;
                  errorMessage =
                    (err.message as string) || (err.type as string) || 'Unknown error';
                }
              }

              if (hasError) {
                logger.error(Event.ZERO_MUTATION_ERROR, {
                  mutation: mutationName,
                  error: errorMessage,
                  duration,
                  skewed,
                });
                if (!skewed) {
                  metrics.recordLatency('zero.mutation.latency', duration, {
                    mutation: mutationName,
                  });
                }
                metrics.incrementCounter('zero.mutation.operations', {
                  mutation: mutationName,
                  stage: 'error',
                });
              } else {
                logger.info(Event.ZERO_MUTATION_COMPLETE, {
                  mutation: mutationName,
                  duration,
                  skewed,
                });
                if (!skewed) {
                  metrics.recordLatency('zero.mutation.latency', duration, {
                    mutation: mutationName,
                  });
                }
                metrics.incrementCounter('zero.mutation.operations', {
                  mutation: mutationName,
                  stage: 'success',
                });
              }
            })
            .catch(error => {
              const duration = performance.now() - startTime;
              const skewed = wasInterrupted(startTime);
              const errorMessage = error instanceof Error ? error.message : String(error);
              logger.error(Event.ZERO_MUTATION_ERROR, {
                mutation: mutationName,
                error: errorMessage,
                skewed,
              });
              if (!skewed) {
                metrics.recordLatency('zero.mutation.latency', duration, {
                  mutation: mutationName,
                });
              }
              metrics.incrementCounter('zero.mutation.operations', {
                mutation: mutationName,
                stage: 'error',
              });
            })
            .finally(() => {
              trackMutationSettled();
            });

          return result;
        };
      }

      if (prop === 'run') {
        return async <
          TTable extends keyof Zero['schema']['tables'],
          TInput extends ReadonlyJSONValue | undefined,
          TOutput extends ReadonlyJSONValue | undefined,
          TReturn,
        >(
          query:
            | QueryRequest<TTable, TInput, TOutput, Zero['schema'], TReturn, Zero['context']>
            | Query<TTable, Zero['schema'], TReturn>,
          runOptions?: RunOptionsWithName,
        ): Promise<HumanReadable<TReturn>> => {
          const startTime = performance.now();

          let queryName: string;
          let queryArgs: unknown = undefined;

          if ('query' in query && 'args' in query) {
            queryName = query.query.queryName || 'unknown';
            queryArgs = query.args;
          } else {
            queryName = runOptions?.queryName || 'unknown';
          }

          logger.info(Event.ZERO_RUN_CALLED, { query: queryName, args: queryArgs });
          metrics.incrementCounter('zero.run.operations', { query: queryName, stage: 'start' });

          try {
            const result = (await target.run(
              query as Parameters<Zero['run']>[0],
              runOptions as Parameters<Zero['run']>[1],
            )) as Promise<HumanReadable<TReturn>>;

            const duration = performance.now() - startTime;
            const skewed = wasInterrupted(startTime);
            logger.info(Event.ZERO_RUN_COMPLETE, {
              query: queryName,
              duration,
              args: queryArgs,
              skewed,
            });
            if (!skewed) {
              metrics.recordLatency('zero.run.latency', duration, { query: queryName });
            }
            metrics.incrementCounter('zero.run.operations', {
              query: queryName,
              stage: 'success',
            });

            return result;
          } catch (error) {
            const duration = performance.now() - startTime;
            const skewed = wasInterrupted(startTime);
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(Event.ZERO_RUN_ERROR, {
              query: queryName,
              error: errorMessage,
              args: queryArgs,
              skewed,
            });
            if (!skewed) {
              metrics.recordLatency('zero.run.latency', duration, { query: queryName });
            }
            metrics.incrementCounter('zero.run.operations', {
              query: queryName,
              stage: 'error',
            });
            throw error;
          }
        };
      }
      return Reflect.get(target, prop) as never;
    },
  };

  return new Proxy(originalZero, handler);
}
