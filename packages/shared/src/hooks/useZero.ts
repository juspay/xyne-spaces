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
import { useEncryptionConfig } from './useEncryptionConfig.js';
import { encryptField, decryptField, isEncryptedField } from '../crypto/field-decrypt.js';
import {
  CLIENT_MANIFEST_STALE_CODE,
  getClientManifest,
  refetchClientManifest,
} from '../crypto/client-manifest.js';
import { clientEncryptsField, findMutatorRule } from '../crypto/manifest-encrypt.js';
import type { TransitKeyring } from '../crypto/keyring.js';
import { validateQueryWhereClause } from '../zero/query-validation.js';
import { wasInterrupted } from './metricValidity.js';
import { trackMutationStart, trackMutationSettled } from './pendingMutations.js';

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

async function decryptQueryResult(
  result: unknown,
  keyring: TransitKeyring,
  metrics: MetricsRecorder,
  queryName: string,
  depth: number = 0,
): Promise<unknown> {
  if (typeof result === 'string' && isEncryptedField(result)) {
    const startTime = performance.now();
    try {
      const decrypted = await decryptField(result, keyring);
      const duration = performance.now() - startTime;
      metrics.recordLatency('crypto.decrypt.field', duration, {
        query: queryName,
        depth: depth.toString(),
      });
      metrics.incrementCounter('crypto.decrypt.operations', {
        query: queryName,
        status: 'success',
      });
      return decrypted;
    } catch {
      metrics.incrementCounter('crypto.decrypt.operations', {
        query: queryName,
        status: 'error',
      });
      throw new Error(`Failed to decrypt field for query ${queryName}`);
    }
  }
  if (Array.isArray(result)) {
    return await Promise.all(
      result.map(item => decryptQueryResult(item, keyring, metrics, queryName, depth)),
    );
  }
  if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    const decryptedObj: Record<string, unknown> = {};
    for (const [k, value] of Object.entries(obj)) {
      decryptedObj[k] = await decryptQueryResult(value, keyring, metrics, queryName, depth + 1);
    }
    return decryptedObj;
  }
  return result;
}

export function useZero(): Zero {
  const originalZero = useOriginalZero();
  const { logger, metrics } = useInstrumentation();
  const { keyring, config } = useEncryptionConfig();
  const clientEncryptionEnabled = config?.clientEncryptionEnabled ?? false;
  const apiClientEncryptionEnabled = config?.apiClientEncryptionEnabled ?? false;

  const handler: ProxyHandler<Zero> = {
    get(target, prop) {
      if (prop === 'mutate') {
        return <TArgs extends ReadonlyJSONValue | undefined>(
          mutationRequest: MutateRequest<TArgs>,
        ): PromiseWithServerResult => {
          const startTime = performance.now();
          const mutationName = mutationRequest.mutator.mutatorName;
          const originalMutator = mutationRequest.mutator;

          logger.info(Event.ZERO_MUTATION_CALLED, { mutation: mutationName });
          metrics.incrementCounter('zero.mutation.operations', {
            mutation: mutationName,
            stage: 'start',
          });

          trackMutationStart();
          const handleCompletion = (result: PromiseWithServerResult) => {
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
          };

          // Mutators with a manifest rule: encrypt the fields the rule has the client encrypt
          // (clientEncryptsField); the local (optimistic) run keeps the plaintext args.
          if (keyring && apiClientEncryptionEnabled && getClientManifest() && findMutatorRule(getClientManifest()!, mutationName)) {
            const plainArgs = mutationRequest.args;
            const originalFn = originalMutator.fn;
            (originalMutator as { fn: (options: unknown) => Promise<unknown> }).fn = (options: unknown) =>
              originalFn({ ...(options as Record<string, unknown>), args: plainArgs } as Parameters<typeof originalFn>[0]);

            // Encrypts with the manifest held right now and sends.
            const send = async () => {
              const manifest = getClientManifest();
              const rule = manifest ? findMutatorRule(manifest, mutationName) : undefined;
              const record = (plainArgs ?? {}) as Record<string, ReadonlyJSONValue>;
              let args: Record<string, ReadonlyJSONValue> = record;
              if (manifest && rule) {
                args = { ...record };
                for (const [field, value] of Object.entries(record)) {
                  if (clientEncryptsField(rule, field) && typeof value === 'string' && value.length > 0) {
                    args[field] = await encryptField(value, keyring);
                  }
                }
              }
              return target.mutate({
                ...mutationRequest,
                args: args as TArgs,
                mutator: originalMutator,
              } as Parameters<Zero['mutate']>[0]);
            };

            // A manifest published since this tab fetched its own is rejected with
            // ENC_MANIFEST_STALE (the mutation is rolled back). Refetch it and send once more,
            // re-encrypted, as the REST interceptor does for a 409.
            const deferredResult = send();
            const server = deferredResult
              .then(r => r.server)
              .then(async serverResult => {
                if (!JSON.stringify(serverResult ?? null).includes(CLIENT_MANIFEST_STALE_CODE)) {
                  return serverResult;
                }
                if (!(await refetchClientManifest())) return serverResult;
                return (await send()).server;
              });

            const result = {
              client: deferredResult.then(r => r.client),
              server,
            } as PromiseWithServerResult;
            handleCompletion(result);
            return result;
          }

          const result = target.mutate(mutationRequest as Parameters<Zero['mutate']>[0]);
          handleCompletion(result);

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

          if ('query' in query && 'args' in query) {
            queryName = query.query.queryName || 'unknown';
          } else {
            queryName = runOptions?.queryName || 'unknown';
          }

          logger.info(Event.ZERO_RUN_CALLED, { query: queryName });
          metrics.incrementCounter('zero.run.operations', { query: queryName, stage: 'start' });

          try {
            validateQueryWhereClause(query, config?.encryptedFields ?? {});
            const rawResult = (await target.run(
              query as Parameters<Zero['run']>[0],
              runOptions as Parameters<Zero['run']>[1],
            )) as HumanReadable<TReturn>;

            let result: HumanReadable<TReturn> = rawResult;
            if (keyring && clientEncryptionEnabled) {
              try {
                result = (await decryptQueryResult(
                  rawResult,
                  keyring,
                  metrics,
                  queryName,
                  0,
                )) as HumanReadable<TReturn>;
              } catch {
                result = rawResult;
              }
            }

            const duration = performance.now() - startTime;
            const skewed = wasInterrupted(startTime);
            logger.info(Event.ZERO_RUN_COMPLETE, {
              query: queryName,
              duration,
              skewed,
            });
            if (!skewed) {
              metrics.recordLatency('zero.run.latency', duration, { query: queryName });
            }
            metrics.incrementCounter('zero.run.operations', {
              query: queryName,
              stage: 'success',
            });

            return result as Promise<HumanReadable<TReturn>>;
          } catch (error) {
            const duration = performance.now() - startTime;
            const skewed = wasInterrupted(startTime);
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error(Event.ZERO_RUN_ERROR, {
              query: queryName,
              error: errorMessage,
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
