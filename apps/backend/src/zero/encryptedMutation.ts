import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import { defineMutator } from '@rocicorp/zero';
import type { DefaultContext, DefaultWrappedTransaction, MutatorDefinition, ReadonlyJSONValue } from '@rocicorp/zero';
import type { z } from 'zod';
import {
  deriveFactsFromPlaintext,
  derivedFactsSchema,
  derivedNames,
  UnreadableString,
  isMutatorName,
  mutatorContracts,
} from '@xyne/shared';
import type { DerivedFacts, FieldDerived, MutatorName, RequestContract } from '@xyne/shared';
import { config } from '@/config/env';
import { getEncryptionProvider, runWithDekPassthrough } from '@/services/encryption';
import type { TransitCaller } from '@/services/encryption';
import { getCryptoOperations } from '@/services/otel/cryptoMetrics';
import { logger } from '@/utils/logger';
import { type UnreadableTransaction, unreadableTransaction } from './unreadableTransaction';
import { recordContractApplied, recordFactsDerived, recordFactsError, recordUnreadableWrapped } from './zeroMetrics';

/**
 * The Zero-mutation counterpart of middleware/encryptedRoute.ts. A mutator is
 * `defineContractMutator('<name>', fn)`, its contract in mutatorContracts (shared
 * enc-contracts/mutator-contracts.ts): the args schema, `unreadableString()` marking the sensitive
 * args, and `sourceToDerived` naming the facts the mutator decides on instead of their text.
 *
 * - Client encryption on (API_CLIENT_ENCRYPTION_ENABLED, the client gets the manifest): the client
 *   sent the args its rule does not list as transit ciphertext. The encryption service turns them
 *   into workspace-DEK ciphertext and extracts the facts, after checking the contract against the
 *   rule (no rule, or a disagreement, is refused) and the args against the rule. The mutator runs
 *   under DEK passthrough, so the ciphertext is stored as it is.
 * - Off: the args are plaintext. The same extractors run here; the Prisma extension encrypts the
 *   plaintext at rest on write.
 *
 * Either way the mutator gets the `unreadableString()` args as `UnreadableString` and the facts as
 * `facts`, so it cannot read or log the values.
 *
 * Two steps, so no encryption-service call is made while a database transaction holds a
 * connection: prepareEncryptedMutations runs before Zero opens any transaction, and
 * runEncryptedMutation, inside it, only looks the outcome up.
 */

/** Set on prepared args (server-side only): the key of the mutation's outcome. */
const PREPARED_ARG = '_encPrepared';

/** Whether `value` holds transit ciphertext (`ENC:v<n>|tk-<version>|…`) anywhere. */
function hasTransitCiphertext(value: unknown): boolean {
  if (typeof value === 'string') return /^ENC:v\d+\|tk-/.test(value);
  if (Array.isArray(value)) return value.some(hasTransitCiphertext);
  if (value && typeof value === 'object') return Object.values(value).some(hasTransitCiphertext);
  return false;
}

/** Who is mutating, for the encryption service: the transit caller (transitCaller). */
export type MutationEncryptionContext = TransitCaller;

/**
 * Each prepared mutation's outcome: the facts to run with and whether its fields are now
 * workspace-DEK ciphertext (run under DEK passthrough), or why it is refused.
 */
export type PreparedMutations = Map<string, { derived?: DerivedFacts; dekPassthrough?: boolean; error?: Error }>;

/** The facts of the running mutation, set by runEncryptedMutation and handed to the mutator as `facts`. */
const mutationDerivedContext = new AsyncLocalStorage<DerivedFacts | undefined>();

/** The arg fields `derived` has facts for. */
function fieldsWithFacts(derived: DerivedFacts | undefined): string[] {
  return Object.entries(derived?.fields ?? {}).flatMap(([field, facts]) => (Object.keys(facts).length > 0 ? [field] : []));
}

/** Logs that a mutation got its derived facts and where they came from. */
function logDerivedFacts(mutatorName: string, source: 'local' | 'encryption-service', derived: DerivedFacts | undefined): void {
  logger.info(`[encryptedMutation] ${mutatorName}: ${derived ? 'derived facts extracted' : 'no derived facts'} via ${source}`);
}

type MutatorContract<N extends MutatorName> = (typeof mutatorContracts)[N];

/** The facts of each source field of mutator `N`, as its `sourceToDerived` lists them; a field that carried no text has none. */
export type MutatorFacts<N extends MutatorName> = {
  [F in keyof MutatorContract<N>['sourceToDerived']]?: FieldDerived<MutatorContract<N>['sourceToDerived'], F>;
};

type MutatorFn<N extends MutatorName> = (options: {
  tx: UnreadableTransaction;
  ctx: DefaultContext;
  /** Validated by the contract: its `unreadableString()` fields are `UnreadableString`. */
  args: z.output<MutatorContract<N>['schema']>;
  facts: MutatorFacts<N>;
}) => Promise<void>;

/**
 * The mutator `name` of mutatorContracts: Zero validates its args with the contract's schema, and
 * the mutator gets them with its `facts`. Its reads are unreadable too: `tx.run` returns the
 * columns in UNREADABLE_COLUMNS as `UnreadableString` (see unreadableTransaction). The body never
 * reads an unreadable value: it decides on `facts` and on the facts `tx.read` returns.
 */
export function defineContractMutator<N extends MutatorName>(
  name: N,
  mutator: MutatorFn<N>,
): MutatorDefinition<z.input<MutatorContract<N>['schema']>, z.input<MutatorContract<N>['schema']>, DefaultContext, DefaultWrappedTransaction> {
  const contract: RequestContract = mutatorContracts[name];
  // Zero hands the validator's output to the mutator as it is: the unreadable fields arrive as
  // `UnreadableString`, which only Zero's types say must be JSON.
  const validator = contract.schema as unknown as z.ZodType<ReadonlyJSONValue, ReadonlyJSONValue>;
  // Cast back from that JSON typing to the contract's input type, which is what callers send.
  return defineMutator(validator, ({ tx, ctx, args }) => {
    recordContractApplied();
    recordUnreadableWrapped({
      side: 'args',
      columns: contract.unreadableFields.filter(field => (args as Record<string, unknown>)[field] instanceof UnreadableString),
    });
    return mutator({
      tx: unreadableTransaction(tx, ctx.workspaceId),
      ctx,
      args: args as never,
      facts: (mutationDerivedContext.getStore()?.fields ?? {}) as never,
    });
  }) as never;
}

/** An encryption-service verdict on the mutation (stale manifest, rule violation, drift). */
export class MutationEncryptionError extends Error {
  constructor(
    readonly code: string,
    message: string,
    /** The encryption service's HTTP status, when the verdict came from it. */
    readonly status?: number,
  ) {
    super(`${code}: ${message}`);
    this.name = 'MutationEncryptionError';
  }
}

/**
 * Has the encryption service transform `args` by mutator `name`'s rule. Throws when it cannot be
 * transformed: the fields are transit ciphertext, so the mutation is never run (and stored) as sent.
 */
async function transformMutationArgs(
  name: MutatorName,
  args: Record<string, unknown>,
  enc: MutationEncryptionContext | undefined,
  workspaceId: string,
): Promise<{ body: Record<string, unknown>; derived?: DerivedFacts }> {
  if (!config.enc.enableDbEncryption) {
    throw new MutationEncryptionError('ENC_NOT_CONFIGURED', 'Client-encrypted mutations need DB encryption enabled');
  }
  // The encryption service finds the client's key from the access token's session; no fallback key.
  if (!enc?.authToken) {
    throw new MutationEncryptionError('TRANSIT_KEY_REQUIRED', 'Client-encrypted mutation without an access token');
  }
  const contract = mutatorContracts[name];

  let transformed: { body: unknown; derived?: unknown };
  try {
    transformed = await getEncryptionProvider().transformRequest({
      body: args,
      authToken: enc.authToken,
      mutator: name,
      contractFields: Object.keys(contract.schema.shape),
      contractEncrypted: [...contract.unreadableFields],
      contractDerived: derivedNames(contract),
      entityId: workspaceId,
      entityType: 'WORKSPACE',
    });
  } catch (error) {
    const verdict = (error as { body?: { code?: unknown; message?: unknown; problem?: unknown } }).body;
    getCryptoOperations().add(1, {
      operation: 'transform_mutation',
      status: 'error',
      reason: typeof verdict?.code === 'string' ? verdict.code : 'transform_failed',
    });
    if (typeof verdict?.code === 'string') {
      // A drift verdict names what disagrees in `problem`.
      throw new MutationEncryptionError(verdict.code, String(verdict.problem ?? verdict.message ?? verdict.code));
    }
    logger.error('[encryptedMutation] failed to transform mutation args', {
      mutator: name,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error('Failed to transform encrypted mutation');
  }

  let derived: DerivedFacts | undefined;
  if (transformed.derived !== undefined) {
    const parsed = derivedFactsSchema.safeParse(transformed.derived);
    if (!parsed.success) {
      logger.error('[encryptedMutation] encryption service returned invalid derived facts', {
        mutator: name,
        issues: parsed.error.issues,
      });
      throw new MutationEncryptionError('ENC_DERIVED_INVALID', 'Derived content facts are invalid');
    }
    derived = parsed.data;
  }
  return { body: transformed.body as Record<string, unknown>, derived };
}

/**
 * Prepares every mutation of a push body (`{ mutations: [{ name, args }] }`, args as one object
 * or a one-element array) in place, concurrently, before any transaction opens: a mutatorContracts
 * mutation goes to the encryption service when client encryption is on, and otherwise gets its
 * facts here. Prepared args are tagged with PREPARED_ARG; the outcome goes into the result.
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
      const name = String(m!.name);
      // PREPARED_ARG is set here only; one the client sent is dropped.
      const plain = { ...(args as Record<string, unknown>) };
      delete plain[PREPARED_ARG];
      const key = randomUUID();

      if (isMutatorName(name) && config.enc.apiClientEncryptionEnabled) {
        try {
          const { body: transformed, derived } = await transformMutationArgs(name, plain, enc, workspaceId);
          logDerivedFacts(name, 'encryption-service', derived);
          recordFactsDerived({ mutator: name, side: 'args', source: 'enc-rust', columns: fieldsWithFacts(derived) });
          prepared.set(key, { derived, dekPassthrough: true });
          set({ ...transformed, [PREPARED_ARG]: key });
        } catch (error) {
          recordFactsError({ mutator: name, side: 'args', source: 'enc-rust' });
          prepared.set(key, { error: error instanceof Error ? error : new Error(String(error)) });
          set({ ...plain, [PREPARED_ARG]: key });
        }
        return;
      }

      // Plaintext args. Transit ciphertext here comes from a client still encrypting by a manifest
      // (an old tab); it is refused, never decrypted or stored.
      if (hasTransitCiphertext(plain)) {
        getCryptoOperations().add(1, { operation: 'mutation_args', status: 'error', reason: 'transit_without_rule' });
        logger.warn('[encryptedMutation] transit ciphertext in a mutation sent as plaintext', { mutator: name });
        prepared.set(key, {
          error: new MutationEncryptionError('TRANSIT_WITHOUT_RULE', `${name} args must be sent as plaintext; reload the page`),
        });
        set({ ...plain, [PREPARED_ARG]: key });
        return;
      }
      if (!isMutatorName(name)) {
        set(plain);
        return;
      }
      let derived: DerivedFacts | undefined;
      try {
        derived = deriveFactsFromPlaintext(plain, derivedNames(mutatorContracts[name]));
      } catch (error) {
        recordFactsError({ mutator: name, side: 'args', source: 'local' });
        throw error;
      }
      recordFactsDerived({ mutator: name, side: 'args', source: 'local', columns: fieldsWithFacts(derived) });
      if (derived) {
        getCryptoOperations().add(1, { operation: 'derive_mutation_local', status: 'ok' });
        logDerivedFacts(name, 'local', derived);
        prepared.set(key, { derived, dekPassthrough: false });
        set({ ...plain, [PREPARED_ARG]: key });
      } else {
        set(plain);
      }
    }),
  );
  return prepared;
}

/**
 * Inside the mutation's transaction: runs `run` with the args prepareEncryptedMutations
 * transformed and their facts (DEK passthrough on), or with plaintext args and the facts derived
 * here (passthrough off), or throws its refusal. Args it did not tag run as sent.
 */
export async function runEncryptedMutation<T>(
  args: unknown,
  prepared: PreparedMutations,
  run: (args: unknown, derived: DerivedFacts | undefined) => Promise<T>,
): Promise<T> {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return run(args, undefined);
  const record = args as Record<string, unknown>;
  if (!(PREPARED_ARG in record)) return run(args, undefined);
  const { [PREPARED_ARG]: key, ...body } = record;
  const outcome = prepared.get(String(key));
  if (!outcome) {
    throw new MutationEncryptionError('ENC_NOT_PREPARED', 'Client-encrypted mutation was not transformed');
  }
  if (outcome.error) throw outcome.error;
  const derived = outcome.derived;
  const withDerived = () => mutationDerivedContext.run(derived, () => run(body, derived));
  return outcome.dekPassthrough ? runWithDekPassthrough(withDerived) : withDerived();
}
