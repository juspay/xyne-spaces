import { useZero as useOriginalZero } from '@rocicorp/zero/react';
import type {
  Zero,
  MutateRequest,
  PromiseWithServerResult,
  ReadonlyJSONValue,
} from '@rocicorp/zero';
import { zeroMutationLatency, zeroMutationOperations, safeRecordMetric } from '../services/otel';
import { logger, Event } from '../utils/logger';

export function useZero(): Zero {
  const originalZero = useOriginalZero();

  // Create a proxy to intercept mutate calls
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
            .then(() => {
              const duration = performance.now() - startTime;
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
            })
            .catch(error => {
              const duration = performance.now() - startTime;
              const errorMessage = error instanceof Error ? error.message : String(error);
              logger.error(Event.ZERO_MUTATION_ERROR, {
                mutation: mutationName,
                error: errorMessage,
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
      return Reflect.get(target, prop) as never;
    },
  };

  return new Proxy(originalZero, handler);
}
