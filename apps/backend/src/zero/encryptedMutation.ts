import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import {
  CLIENT_MANIFEST_MUTATION_ARG,
  WorkspaceRole,
  conversationsSendClient,
  derivedContentFactsSchema,
  isEncryptedField,
  keepMentionsWithin,
} from '@xyne/shared';
import type { DerivedContentFacts, RequestContract } from '@xyne/shared';
import { config } from '@/config/env';
import { db } from '@/database/client';
import { getEncryptionProvider, runWithDekPassthrough } from '@/services/encryption';
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
 * prepareEncryptedMutations also scopes a guest's mentions (scopeGuestMentions) on every
 * mutation that declares it, plaintext or encrypted alike.
 */

/** Set on prepared args (server-side only): the key of the mutation's outcome. */
const PREPARED_ARG = '_encPrepared';

/** What a mutator declares about its args. */
type MutationSpec = {
  /** Its request contract. */
  contract: RequestContract;
  /** The arg naming the channel a guest's mentions must stay within (scopeGuestMentions). */
  guestMentionsWithinChannelArg?: string;
};

/** Mutators with a request contract, by Zero mutator name. */
const MUTATIONS: Record<string, MutationSpec> = {
  'conversations.send': { contract: conversationsSendClient, guestMentionsWithinChannelArg: 'channelId' },
};

/** Who is mutating, for the encryption service: the caller's transit public key and the request's manifest lane. */
export type MutationEncryptionContext = { clientKey?: string; environment: string };

/** The mutating user, as the mutators see it (authData). */
export type MutationAuth = { workspaceId: string; role?: string };

/** A push after prepareEncryptedMutations: each prepared mutation's outcome, and whether any args changed. */
export type PreparedPush = { prepared: PreparedMutations; changed: boolean };

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
  mentionScope: string[] | undefined,
): Promise<{ body: Record<string, unknown>; derived?: DerivedContentFacts }> {
  const { [CLIENT_MANIFEST_MUTATION_ARG]: client, ...body } = args;
  if (!config.enc.apiClientEncryptionEnabled || !config.enc.enableDbEncryption) {
    throw new MutationEncryptionError(
      'ENC_NOT_CONFIGURED',
      'Client-encrypted mutations need API client encryption and DB encryption enabled',
    );
  }
  if (!enc?.clientKey) {
    throw new MutationEncryptionError('TRANSIT_KEY_REQUIRED', 'Client-encrypted mutation without a transit key');
  }
  // The contract only feeds the drift check; a rule mutator without one is still transformed.
  const contract = MUTATIONS[mutatorName]?.contract;

  let transformed: { body: unknown; derived?: unknown };
  try {
    transformed = await getEncryptionProvider().transformRequest({
      body,
      clientKey: enc.clientKey,
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
      ...(mentionScope ? { keepMentionsWithin: mentionScope } : {}),
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
 * The user ids a guest's mentions must stay within (the channel's members), for a mutator
 * that declares guestMentionsWithinChannelArg; undefined for anyone else.
 */
async function guestMentionScope(
  spec: MutationSpec | undefined,
  args: Record<string, unknown>,
  auth: MutationAuth,
): Promise<string[] | undefined> {
  if (!spec?.guestMentionsWithinChannelArg || auth.role !== WorkspaceRole.GUEST) return undefined;
  const channelId = args[spec.guestMentionsWithinChannelArg];
  if (typeof channelId !== 'string') return undefined;
  const participants = await db.channelParticipant.findMany({ where: { channelId }, select: { userId: true } });
  return participants.map(participant => participant.userId);
}

/**
 * A guest may only mention members of the channel: any other mention loses its tag and stays
 * as plain text (keepMentionsWithin), so the stored message is the same however it arrived.
 *
 * - plaintext: rewritten here.
 * - encrypted: opaque here, so the scope goes to the encryption service, which has the
 *   content extractor rewrite the decrypted text before re-encrypting it and extracting its
 *   facts (transformMutationArgs).
 *
 * Returns the plaintext args to run (rewritten or as given) and the scope to send with
 * encrypted args.
 */
async function scopeGuestMentions(
  mutatorName: string,
  args: Record<string, unknown>,
  auth: MutationAuth,
): Promise<{ args: Record<string, unknown>; mentionScope?: string[] }> {
  const spec = MUTATIONS[mutatorName];
  const mentionScope = await guestMentionScope(spec, args, auth);
  if (!mentionScope) return { args };

  const field = spec.contract.derivedFrom;
  const text = field ? args[field] : undefined;
  if (CLIENT_MANIFEST_MUTATION_ARG in args || typeof text !== 'string' || isEncryptedField(text)) {
    return { args, mentionScope };
  }
  const scoped = keepMentionsWithin(text, new Set(mentionScope));
  return { args: scoped === text ? args : { ...args, [field!]: scoped } };
}

/**
 * Prepares every mutation of a push body (`{ mutations: [{ name, args }] }`, args as one
 * object or a one-element array) in place, concurrently, before any transaction opens:
 * a guest's mentions are scoped (scopeGuestMentions), and each rule-encrypted mutation's args
 * are replaced by the transformed args (or, when it is refused, the args without the
 * manifest) tagged with PREPARED_ARG; its outcome goes into the result. `changed` says
 * whether the push body has to be re-sent.
 */
export async function prepareEncryptedMutations(
  body: unknown,
  enc: MutationEncryptionContext | undefined,
  auth: MutationAuth,
): Promise<PreparedPush> {
  const prepared: PreparedMutations = new Map();
  let changed = false;
  const mutations = (body as { mutations?: unknown } | null)?.mutations;
  if (!Array.isArray(mutations)) return { prepared, changed };

  await Promise.all(
    mutations.map(async (mutation) => {
      const m = mutation as { name?: unknown; args?: unknown } | null;
      const wrapped = Array.isArray(m?.args);
      const args = wrapped ? (m!.args as unknown[])[0] : m?.args;
      if (!args || typeof args !== 'object' || Array.isArray(args)) return;
      const set = (next: Record<string, unknown>) => {
        if (wrapped) (m!.args as unknown[])[0] = next;
        else m!.args = next;
        changed = true;
      };
      const name = String(m!.name);
      const scoped = await scopeGuestMentions(name, args as Record<string, unknown>, auth);
      if (!(CLIENT_MANIFEST_MUTATION_ARG in args)) {
        // PREPARED_ARG is set here only; one the client sent is dropped.
        if (PREPARED_ARG in scoped.args) {
          const { [PREPARED_ARG]: _forged, ...rest } = scoped.args;
          set(rest);
        } else if (scoped.args !== args) {
          set(scoped.args);
        }
        return;
      }

      const key = randomUUID();
      let next: Record<string, unknown>;
      try {
        const { body: transformed, derived } = await transformMutationArgs(
          name,
          args as Record<string, unknown>,
          enc,
          auth.workspaceId,
          scoped.mentionScope,
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
  return { prepared, changed };
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
