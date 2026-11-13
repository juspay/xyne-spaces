/**
 * Resolve the credentials a component declares, and check they fit.
 *
 * One implementation for every consumer: the executor before a step runs,
 * activation before a trigger goes live, and the ingest pipeline before a
 * webhook request is authenticated. Each used to be free to check a little
 * differently; now none can.
 */

import type { CredentialSlot } from '../steps/base-step.js';
import type { ResolvedCredential } from '../common/credentials.js';
import type { CredentialRequirement } from '../connectors/core/credentials.js';
import { acceptsCredential } from '../connectors/core/credentials.js';
import type { PersistenceAdapter } from '../persistence/types.js';
import type { WorkflowContext } from '../types/context.js';
import type { ResourceAttributes } from '../authz/attributes.js';

export type CredentialResolutionReason = 'unset' | 'not-a-name' | 'not-found' | 'wrong-type';

/** A slot could not be satisfied. Names the slot, so the error points at the config. */
export class CredentialResolutionError extends Error {
  readonly slot: string;
  readonly reason: CredentialResolutionReason;

  constructor(slot: string, reason: CredentialResolutionReason, message: string) {
    super(message);
    this.name = 'CredentialResolutionError';
    this.slot = slot;
    this.reason = reason;
  }
}

/** Anything that declares credentials: a step or a trigger. */
export interface CredentialConsumer {
  readonly credentialSlots?: readonly CredentialSlot[];
  readonly credential?: CredentialRequirement;
}

/** The running workflow, or the tenant attributes when no workflow is running. */
export type CredentialScope = WorkflowContext['workflow'] | ResourceAttributes<'workflow'>;

export class CredentialResolver {
  constructor(
    private readonly persistence: Pick<PersistenceAdapter<unknown>, 'resolveCredential'>,
  ) {}

  /**
   * Resolve every declared slot from `config`, keyed by slot name.
   *
   * Optional slots left unset are omitted. A consumer with an empty accepted
   * list takes any type; one with a list takes only those.
   *
   * @throws {CredentialResolutionError} for the first slot that cannot be satisfied.
   */
  async resolve(
    scope: CredentialScope,
    consumer: CredentialConsumer,
    config: Readonly<Record<string, unknown>> | undefined,
  ): Promise<Readonly<Record<string, ResolvedCredential>>> {
    const resolved: Record<string, ResolvedCredential> = {};
    for (const slot of consumer.credentialSlots ?? []) {
      const configured = config?.[slot.name];
      if (configured === undefined || configured === null || configured === '') {
        if (slot.required) {
          throw new CredentialResolutionError(
            slot.name,
            'unset',
            `Required credential slot "${slot.name}" is not configured`,
          );
        }
        continue;
      }
      if (typeof configured !== 'string') {
        throw new CredentialResolutionError(
          slot.name,
          'not-a-name',
          `Credential slot "${slot.name}" must resolve to a credential name`,
        );
      }

      const credential = await this.persistence.resolveCredential(scope, configured);
      if (!credential) {
        throw new CredentialResolutionError(
          slot.name,
          'not-found',
          slot.required
            ? `Required credential "${configured}" not found`
            : `Credential "${configured}" not found or revoked`,
        );
      }

      const accepts = consumer.credential ?? [];
      if (accepts.length > 0 && !acceptsCredential(accepts, credential.credType)) {
        throw new CredentialResolutionError(
          slot.name,
          'wrong-type',
          `Credential "${credential.name}" is ${credential.credType}, which is not ` +
            `accepted here (accepts: ${accepts.map((d) => d.credType).join(', ')})`,
        );
      }
      resolved[slot.name] = credential;
    }
    return resolved;
  }
}
