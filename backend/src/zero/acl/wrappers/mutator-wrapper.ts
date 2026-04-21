import type { Transaction } from '@rocicorp/zero';
import { Schema } from '@xyne/shared';
import type { QueryContext } from '../core/types';
import { wrapTransactionWithACL } from './transaction-wrapper';
import type { AuthData } from '../../mutators';
import type { VespaJobsAccumulator } from '../../vespa-injection';
import type { SideEffectJobsAccumulator } from '../../side-effects';

/**
 * Wraps a mutators object with a Proxy that automatically applies ACL to transactions
 * and collects Vespa jobs for indexing.
 *
 * This creates a nested Proxy structure:
 * 1. First level: mutators.channel → Proxy intercepts namespace access
 * 2. Second level: mutators.channel.joinChannel → Proxy intercepts mutator access
 * 3. Third level: joinChannel(tx, args) → Wraps tx with ACL and Vespa collection before calling original
 *
 * @param mutators - The mutators object returned from createMutators()
 * @param authData - The authenticated user's data
 * @param vespaJobs - Accumulator array to collect Vespa indexing jobs
 * @param sideEffectJobs - Accumulator array to collect side effect jobs (activities & notifications)
 * @returns Proxied mutators object that automatically wraps transactions with ACL and Vespa injection
 *
 * @example
 * const mutators = createMutators(authData, asyncTasks);
 * const vespaJobs = createVespaJobsAccumulator();
 * const sideEffectJobs = createSideEffectJobsAccumulator();
 * const wrapped = wrapMutatorsWithACL(mutators, authData, vespaJobs, sideEffectJobs);
 *
 * // When PushProcessor calls:
 * // wrapped.channel.joinChannel(tx, args)
 * // The tx is automatically wrapped with ACL and Vespa injection before reaching the mutator
 */
export function wrapMutatorsWithACL<T extends Record<string, any>>(
  mutators: T,
  authData: AuthData,
  vespaJobs: VespaJobsAccumulator,
  sideEffectJobs: SideEffectJobsAccumulator,
): T {
  const ctx: QueryContext = { userID: authData.sub, workspaceId: authData.workspaceId, role: authData.role, memberId: authData.memberId, orgRole: authData.orgRole};

  return new Proxy(mutators, {
    get(target, namespace: string | symbol) {
      if (typeof namespace !== 'string') {
        return (target as Record<string | symbol, unknown>)[namespace];
      }

      const namespaceObj = target[namespace];
      if (typeof namespaceObj !== 'object' || namespaceObj === null) {
        return namespaceObj;
      }

      return new Proxy(namespaceObj, {
        get(nsTarget, mutatorName: string | symbol) {
          if (typeof mutatorName !== 'string') {
            return (nsTarget as Record<string | symbol, unknown>)[mutatorName];
          }

          const originalMutator = nsTarget[mutatorName];
          if (typeof originalMutator !== 'function') {
            return originalMutator;
          }

          return async function(tx: Transaction<Schema>, args: unknown) {
            const wrappedTx = await wrapTransactionWithACL(tx, ctx, vespaJobs, sideEffectJobs);
            return originalMutator(wrappedTx, args);
          };
        }
      });
    }
  }) as T;
}