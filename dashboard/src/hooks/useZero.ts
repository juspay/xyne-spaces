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
import {
  zeroMutationLatency,
  zeroMutationOperations,
  zeroRunLatency,
  zeroRunOperations,
  safeRecordMetric,
} from '../services/otel';
import { logger, Event } from '../utils/logger';

interface RunOptionsWithName {
  queryName?: string;
  [key: string]: unknown;
}

export function useZero(): Zero {
  const originalZero = useOriginalZero();
  // Create a proxy to intercept mutate and run calls
  const handler: ProxyHandler<Zero> = {
    get(target, prop) {
      if (prop === 'mutate') {
        return <TArgs extends ReadonlyJSONValue | undefined>(
          mutationRequest: MutateRequest<TArgs>,
        ): PromiseWithServerResult => {
          const startTime = performance.now();
          const mutationName = mutationRequest.mutator.mutatorName;

          // Log start
          logger.info(Event.ZERO_MUTATION_CALLED, { mutation: mutationName });
          safeRecordMetric(() => {
            zeroMutationOperations.add(1, { mutation: mutationName, stage: 'start' });
          });

          // Execute mutation
          const result = target.mutate(mutationRequest as Parameters<Zero['mutate']>[0]);

          // Handle completion
          Promise.all([result.client, result.server])
            .then(([_clientResult, serverResult]) => {
              const duration = performance.now() - startTime;
              let hasError = false;
              let errorMessage = '';

              if (serverResult && typeof serverResult === 'object') {
                if (serverResult.type === 'error' && serverResult.error) {
                  hasError = true;
                  errorMessage =
                    serverResult.error.message || serverResult.error.type || 'Unknown error';
                }
              }

              if (hasError) {
                logger.error(Event.ZERO_MUTATION_ERROR, {
                  mutation: mutationName,
                  error: errorMessage,
                  duration,
                });
                safeRecordMetric(() => {
                  zeroMutationLatency.record(duration, { mutation: mutationName });
                  zeroMutationOperations.add(1, {
                    mutation: mutationName,
                    stage: 'error',
                  });
                });
              } else {
                logger.info(Event.ZERO_MUTATION_COMPLETE, {
                  mutation: mutationName,
                  duration,
                });
                safeRecordMetric(() => {
                  zeroMutationLatency.record(duration, { mutation: mutationName });
                  zeroMutationOperations.add(1, {
                    mutation: mutationName,
                    stage: 'success',
                  });
                });
              }
            })
            .catch(error => {
              const duration = performance.now() - startTime;
              const errorMessage = error instanceof Error ? error.message : String(error);
              logger.error(Event.ZERO_MUTATION_ERROR, {
                mutation: mutationName,
                error: errorMessage,
                duration,
              });
              safeRecordMetric(() => {
                zeroMutationLatency.record(duration, { mutation: mutationName });
                zeroMutationOperations.add(1, {
                  mutation: mutationName,
                  stage: 'error',
                });
              });
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
          safeRecordMetric(() => {
            zeroRunOperations.add(1, { query: queryName, stage: 'start' });
          });

          try {
            const result = (await target.run(
              query as Parameters<Zero['run']>[0],
              runOptions as Parameters<Zero['run']>[1],
            )) as Promise<HumanReadable<TReturn>>;

            const duration = performance.now() - startTime;
            logger.info(Event.ZERO_RUN_COMPLETE, {
              query: queryName,
              duration,
              args: queryArgs,
            });
            safeRecordMetric(() => {
              zeroRunLatency.record(duration, { query: queryName });
              zeroRunOperations.add(1, {
                query: queryName,
                stage: 'success',
              });
            });

            return result;
          } catch (error) {
            const duration = performance.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(Event.ZERO_RUN_ERROR, {
              query: queryName,
              error: errorMessage,
              args: queryArgs,
            });
            safeRecordMetric(() => {
              zeroRunLatency.record(duration, { query: queryName });
              zeroRunOperations.add(1, {
                query: queryName,
                stage: 'error',
              });
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
