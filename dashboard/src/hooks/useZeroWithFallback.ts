import { useZeroFallbackConfig } from '../contexts/ZeroFallbackContext';
import { executeFallbackMutate } from '../services/zeroMutateFallbackClient';
import type {
  Zero,
  MutateRequest,
  ReadonlyJSONValue,
  Schema,
  PromiseWithServerResult,
} from '@rocicorp/zero';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useZero } from './useZero';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useZeroWithFallback(): Zero<any, any> {
  const zero = useZero();
  const { fallbackEnabled, allowMutations } = useZeroFallbackConfig();
  const queryClient = useQueryClient();

  if (!fallbackEnabled) {
    return zero; // Return original Zero client
  }

  return Object.create(zero, {
    mutate: {
      value: (
        mutateRequest: MutateRequest<ReadonlyJSONValue | undefined, Schema>,
      ): PromiseWithServerResult => {
        const name = mutateRequest.mutator.mutatorName;
        const args = mutateRequest.args;

        if (!allowMutations) {
          toast.error('Mutations are disabled', {
            description: 'Mutations/Writes are currently disabled while in fallback mode.',
          });
          const blockedResult = Promise.resolve({
            type: 'error' as const,
            error: {
              type: 'app' as const,
              message: 'Mutations are disabled while fallback mode is active',
              details: undefined,
            },
          });
          return { client: blockedResult, server: blockedResult };
        }

        const wrappedPromise = executeFallbackMutate(name, args)
          .then(() => {
            void queryClient.invalidateQueries({
              queryKey: ['zero-fallback'],
            });
            return { type: 'success' as const };
          })
          .catch((error: Error) => {
            return {
              type: 'error' as const,
              error: {
                type: 'app' as const,
                message: error.message || 'Mutation failed',
                details: undefined,
              },
            };
          });

        return {
          client: wrappedPromise,
          server: wrappedPromise,
        };
      },
    },
  }) as Zero<never, never>;
}
