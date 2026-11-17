import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import {
  CLIENT_MANIFEST_MUTATION_ARG,
  conversationsSendClient,
  derivedContentFactsSchema,
} from '@xyne/shared';
import type { DerivedContentFacts, RequestContract } from '@xyne/shared';
import { config } from '@/config/env';
import { getEncryptionProvider, runWithDekPassthrough } from '@/services/encryption';
import type { TransitCaller } from '@/services/encryption';
import { getCryptoOperations } from '@/services/otel/cryptoMetrics';
import { logger } from '@/utils/logger';

/**
 * The Zero-mutation counterpart of middleware/encryptedRoute.ts. A mutation the client
 * encrypted by its manifest rule carries the manifest it used in CLIENT_MANIFEST_MUTATION_ARG
 * (zero-cache, not the browser, makes the push call, so there are no client headers). Its
 * args go to the encryption service, which picks the MUTATOR rule by name, runs every check,
 * turns transit ciphertext into workspace-DEK ciphertext and extracts facts; the mutator then
 * runs with DEK passthrough on and reads those facts from getMutationDerived().
 *
 * Two steps, so no encryption-service call is made while a database transaction holds a
 * connection: prepareEncryptedMutations transforms a push's rule-encrypted mutations before
 * Zero opens any transaction, and runEncryptedMutation, inside it, only looks the result up.
 */

/** Set on prepared args (server-side only): the key of the mutation's outcome. */
const PREPARED_ARG = '_encPrepared';

/** Mutators with a request contract, by Zero mutator name. */
const MUTATION_CONTRACTS: Record<string, RequestContract> = {
  'conversations.send': conversationsSendClient,
};

/** Who is mutating, for the encryption service: the transit caller (transitCaller) and the request's manifest lane. */
export type MutationEncryptionContext = TransitCaller & { environment: string };

/** Each prepared mutation's outcome: the facts to run with, or why it is refused. */
export type PreparedMutations = Map<string, { derived?: DerivedContentFacts; error?: Error }>;

const mutationDerivedContext = new AsyncLocalStorage<DerivedContentFacts | undefined>();

/** Facts the encryption service extracted from this mutation's encrypted args, if any. */
export function getMutationDerived(): DerivedContentFacts | undefined {
  return mutationDerivedContext.getStore();
}

/** An encryption-service verdict on the mutation (stale manifest, rule violation, drift). */
export class MutationEncryptionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'MutationEncryptionError';
  }
}

/**
 * Transforms `args` (one rule-encrypted mutation, CLIENT_MANIFEST_MUTATION_ARG included) by
 * its manifest rule. Throws when it cannot be transformed: the fields are transit ciphertext
 * from here on, so the mutation is never run (and stored) as sent.
 */
async function transformMutationArgs(
  mutatorName: string,
  args: Record<string, unknown>,
  enc: MutationEncryptionContext | undefined,
  workspaceId: string,
): Promise<{ body: Record<string, unknown>; derived?: DerivedContentFacts }> {
  const { [CLIENT_MANIFEST_MUTATION_ARG]: client, ...body } = args;
  if (!config.enc.apiClientEncryptionEnabled || !config.enc.enableDbEncryption) {
    throw new MutationEncryptionError(
      'ENC_NOT_CONFIGURED',
      'Client-encrypted mutations need API client encryption and DB encryption enabled',
    );
  }
  if (!enc?.authToken && !enc?.clientKey) {
    throw new MutationEncryptionError('TRANSIT_KEY_REQUIRED', 'Client-encrypted mutation without a transit key');
  }
  // The contract only feeds the drift check; a rule mutator without one is still transformed.
  const contract = MUTATION_CONTRACTS[mutatorName];

  let transformed: { body: unknown; derived?: unknown };
  try {
    transformed = await getEncryptionProvider().transformRequest({
      body,
      ...(enc.authToken ? { authToken: enc.authToken } : {}),
      ...(enc.clientKey ? { clientKey: enc.clientKey } : {}),
      mutator: mutatorName,
      environment: enc.environment,
      client: (client && typeof client === 'object' ? client : {}) as {
        tag?: string;
        version?: number;
        environment?: string;
      },
      ...(contract
        ? {
            contractFields: Object.keys(contract.schema.shape),
            contractEncrypted: [...contract.encrypted],
            contractDerived: [...contract.derived],
          }
        : {}),
      entityId: workspaceId,
      entityType: 'WORKSPACE',
    });
  } catch (error) {
    const verdict = (error as { body?: { code?: unknown; message?: unknown } }).body;
    getCryptoOperations().add(1, {
      operation: 'transform_mutation',
      status: 'error',
      reason: typeof verdict?.code === 'string' ? verdict.code : 'transform_failed',
    });
    if (typeof verdict?.code === 'string') {
      throw new MutationEncryptionError(verdict.code, String(verdict.message ?? verdict.code));
    }
    logger.error('[encryptedMutation] failed to transform mutation args', {
      mutator: mutatorName,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error('Failed to transform encrypted mutation');
  }

  let derived: DerivedContentFacts | undefined;
  if (transformed.derived !== undefined) {
    const parsed = derivedContentFactsSchema.safeParse(transformed.derived);
    if (!parsed.success) {
      logger.error('[encryptedMutation] encryption service returned invalid derived facts', {
        mutator: mutatorName,
        issues: parsed.error.issues,
      });
      throw new MutationEncryptionError('ENC_DERIVED_INVALID', 'Derived content facts are invalid');
    }
    derived = parsed.data;
  }
  return { body: transformed.body as Record<string, unknown>, derived };
}

/**
 * Transforms every rule-encrypted mutation of a push body (`{ mutations: [{ name, args }] }`,
 * args as one object or a one-element array) in place, concurrently, before any transaction
 * opens. Each one's args are replaced by the transformed args (or, when it is refused, the
 * args without the manifest) tagged with PREPARED_ARG; the outcome goes into the result.
 */
export async function prepareEncryptedMutations(
  body: unknown,
  enc: MutationEncryptionContext | undefined,
  workspaceId: string,
): Promise<PreparedMutations> {
  const prepared: PreparedMutations = new Map();
  const mutations = (body as { mutations?: unknown } | null)?.mutations;
  if (!Array.isArray(mutations)) return prepared;

  await Promise.all(
    mutations.map(async (mutation) => {
      const m = mutation as { name?: unknown; args?: unknown } | null;
      const wrapped = Array.isArray(m?.args);
      const args = wrapped ? (m!.args as unknown[])[0] : m?.args;
      if (!args || typeof args !== 'object' || Array.isArray(args)) return;
      const set = (next: Record<string, unknown>) => {
        if (wrapped) (m!.args as unknown[])[0] = next;
        else m!.args = next;
      };
      if (!(CLIENT_MANIFEST_MUTATION_ARG in args)) {
        // PREPARED_ARG is set here only; one the client sent is dropped.
        if (PREPARED_ARG in args) {
          const { [PREPARED_ARG]: _forged, ...rest } = args as Record<string, unknown>;
          set(rest);
        }
        return;
      }

      const key = randomUUID();
      let next: Record<string, unknown>;
      try {
        const { body: transformed, derived } = await transformMutationArgs(
          String(m!.name),
          args as Record<string, unknown>,
          enc,
          workspaceId,
        );
        prepared.set(key, { derived });
        next = { ...transformed, [PREPARED_ARG]: key };
      } catch (error) {
        prepared.set(key, { error: error instanceof Error ? error : new Error(String(error)) });
        const { [CLIENT_MANIFEST_MUTATION_ARG]: _manifest, ...rest } = args as Record<string, unknown>;
        next = { ...rest, [PREPARED_ARG]: key };
      }
      set(next);
    }),
  );
  return prepared;
}

/**
 * Inside the mutation's transaction: runs `run` with the args prepareEncryptedMutations
 * transformed and their derived facts (DEK passthrough on), or throws its refusal. Args that
 * were never encrypted by a rule run as sent.
 */
export async function runEncryptedMutation<T>(
  args: unknown,
  prepared: PreparedMutations,
  run: (args: unknown, derived: DerivedContentFacts | undefined) => Promise<T>,
): Promise<T> {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return run(args, undefined);
  const record = args as Record<string, unknown>;
  if (!(PREPARED_ARG in record)) {
    if (CLIENT_MANIFEST_MUTATION_ARG in record) {
      throw new MutationEncryptionError('ENC_NOT_PREPARED', 'Client-encrypted mutation was not transformed');
    }
    return run(args, undefined);
  }
  const { [PREPARED_ARG]: key, ...body } = record;
  const outcome = prepared.get(String(key));
  if (!outcome) {
    throw new MutationEncryptionError('ENC_NOT_PREPARED', 'Client-encrypted mutation was not transformed');
  }
  if (outcome.error) throw outcome.error;
  const derived = outcome.derived;
  return runWithDekPassthrough(() => mutationDerivedContext.run(derived, () => run(body, derived)));
}
