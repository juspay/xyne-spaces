import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import { defineMutator } from '@rocicorp/zero';
import type { DefaultContext, DefaultWrappedTransaction, MutatorDefinition, ReadonlyJSONValue } from '@rocicorp/zero';
import type { z } from 'zod';
import {
  conversationsForwardMessageClient,
  messagesUpdateClient,
  messagesSendClient,
  ticketUpdateClient,
  markChannelAsViewedClient,
  markThreadActivitiesAsReadV2Client,
  recapSetCustomRecapPromptClient,
  userPresenceUpsertClient,
  draftCreateAttachmentsClient,
  sdlcAddSdlcFolderItemClient,
  sdlcCreateTrackClient,
  sdlcUpdateTrackClient,
  channelUpdateCallSummaryPromptClient,
  emailChannelPreferenceUpsertClassificationClient,
  emailChannelPreferenceUpsertPriorityClassificationClient,
  workspaceUpdateClient,
  canvasCreateClient,
  canvasUpdateClient,
  coeCreateClient,
  coeUpdateClient,
  impactCreateClient,
  impactUpdateClient,
  rcaCreateClient,
  rcaUpdateClient,
  dashboardUpsertClient,
  delayedMessagesCreateClient,
  delayedMessagesEditClient,
  draftMessagesEditClient,
  subTicketCreateClient,
  emailDraftUpsertClient,
  emailDraftUpsertComposeDraftClient,
  canvasCommentCreateThreadClient,
  canvasCommentReplyClient,
  canvasCommentUpdateClient,
  collectionCreateClient,
  collectionUpdateClient,
  conversationsSendClient,
  emailSignatureCreateClient,
  emailSignatureUpdateClient,
  linksCreateClient,
  linksUpdateClient,
  roleCreateClient,
  roleUpdateClient,
  deriveFactsFromPlaintext,
  derivedFactsSchema,
  derivedNames,
  makeUnreadable,
  UnreadableString,
  CLIENT_MANIFEST_STALE_CODE,
  isCiphertextValue,
} from '@xyne/shared';
import type { DerivedFacts, FieldDerived, RequestContract, UnreadableBody } from '@xyne/shared';
import { config } from '@/config/env';
import { getEncryptionProvider, isDekPassthrough, runWithDekPassthrough } from '@/services/encryption';
import type { TransitCaller } from '@/services/encryption';
import { getCryptoOperations } from '@/services/otel/cryptoMetrics';
import { logger } from '@/utils/logger';
import { type UnreadableTransaction, unreadableTransaction } from './unreadableTransaction';
import { recordContractApplied, recordFactsDerived, recordFactsError, recordUnreadableWrapped } from './zeroMetrics';

/**
 * The Zero-mutation counterpart of middleware/encryptedRoute.ts. Every mutation the
 * encryption service has a MUTATOR rule for is sent to it; it picks the rule by name, turns the
 * transit ciphertext of every field the rule does not list as plaintext into workspace-DEK
 * ciphertext and extracts facts; the mutator then runs with DEK passthrough on and reads those
 * facts from getMutationDerived(). Each arg is checked against its type in the contract when
 * the mutator starts (assertArgsMatchContract).
 *
 * Two steps, so no encryption-service call is made while a database transaction holds a
 * connection: prepareEncryptedMutations transforms a push's rule-encrypted mutations before
 * Zero opens any transaction, and runEncryptedMutation, inside it, only looks the result up.
 *
 * A contracted mutator whose args arrived as plaintext (the client had no manifest: client
 * encryption off, or the encryption service unavailable to it) still gets its facts: the same
 * extractors run here, over the contract's source fields, projected to the picked keys, so the
 * mutator reads the same typed facts in both cases and never parses content itself. That run
 * stays outside the DEK passthrough, so the Prisma extension encrypts the plaintext at rest as
 * before. Args that carry a manifest can only be transformed by the service (they are transit
 * ciphertext), so a service outage refuses them rather than falling back.
 */

/** Set on prepared args (server-side only): the key of the mutation's outcome. */
const PREPARED_ARG = '_encPrepared';

/** Mutators with a request contract, by Zero mutator name. */
const MUTATION_CONTRACTS: Record<string, RequestContract> = {
  'conversations.send': conversationsSendClient,
  'canvasComment.createThread': canvasCommentCreateThreadClient,
  'canvasComment.reply': canvasCommentReplyClient,
  'canvasComment.updateComment': canvasCommentUpdateClient,
  'role.create': roleCreateClient,
  'role.update': roleUpdateClient,
  'collection.createCollection': collectionCreateClient,
  'collection.updateCollection': collectionUpdateClient,
  'emailSignature.create': emailSignatureCreateClient,
  'emailSignature.update': emailSignatureUpdateClient,
  'links.create': linksCreateClient,
  'links.update': linksUpdateClient,
  'emailDraft.upsert': emailDraftUpsertClient,
  'emailDraft.upsertComposeDraft': emailDraftUpsertComposeDraftClient,
  'dashboard.upsert': dashboardUpsertClient,
  'delayedMessages.create': delayedMessagesCreateClient,
  'delayedMessages.edit': delayedMessagesEditClient,
  'draftMessages.edit': draftMessagesEditClient,
  'subTicket.create': subTicketCreateClient,
  'canvas.create': canvasCreateClient,
  'canvas.update': canvasUpdateClient,
  'rca.create': rcaCreateClient,
  'rca.update': rcaUpdateClient,
  'impact.create': impactCreateClient,
  'impact.update': impactUpdateClient,
  'coe.create': coeCreateClient,
  'coe.update': coeUpdateClient,
  'channel.updateCallSummaryPrompt': channelUpdateCallSummaryPromptClient,
  'emailChannelPreference.upsertClassificationConfig': emailChannelPreferenceUpsertClassificationClient,
  'emailChannelPreference.upsertPriorityClassificationConfig': emailChannelPreferenceUpsertPriorityClassificationClient,
  'workspace.update': workspaceUpdateClient,
  'sdlc.createTrack': sdlcCreateTrackClient,
  'sdlc.updateTrack': sdlcUpdateTrackClient,
  'sdlc.addSdlcFolderItem': sdlcAddSdlcFolderItemClient,
  'draft.createAttachments': draftCreateAttachmentsClient,
  'channel.markChannelAsViewed': markChannelAsViewedClient,
  'activities.markThreadActivitiesAsReadV2': markThreadActivitiesAsReadV2Client,
  'recap.setCustomRecapPrompt': recapSetCustomRecapPromptClient,
  'userPresence.upsert': userPresenceUpsertClient,
  'ticket.update': ticketUpdateClient,
  'messages.send': messagesSendClient,
  'messages.update': messagesUpdateClient,
  'conversations.forwardMessage': conversationsForwardMessageClient,
};

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

/**
 * Facts for a contracted mutator's plaintext args, extracted here instead of by the
 * encryption service, from the same contract (`sourceToDerived`). Undefined when the mutator
 * has no contract or none of its source fields holds plaintext.
 */
function deriveLocally(mutatorName: string, args: Record<string, unknown>): DerivedFacts | undefined {
  const contract = MUTATION_CONTRACTS[mutatorName];
  if (!contract) return undefined;
  const derived = deriveFactsFromPlaintext(args, derivedNames(contract));
  if (derived) {
    getCryptoOperations().add(1, { operation: 'derive_mutation_local', status: 'ok' });
  }
  return derived;
}

const mutationDerivedContext = new AsyncLocalStorage<DerivedFacts | undefined>();

/** The arg fields `derived` has facts for. */
function fieldsWithFacts(derived: DerivedFacts | undefined): string[] {
  return Object.entries(derived?.fields ?? {}).flatMap(([field, facts]) => (Object.keys(facts).length > 0 ? [field] : []));
}

/** Logs that a mutation got its derived facts and where they came from. */
function logDerivedFacts(mutatorName: string, source: 'local' | 'encryption-service', derived: DerivedFacts | undefined): void {
  logger.info(`[encryptedMutation] ${mutatorName}: ${derived ? 'derived facts extracted' : 'no derived facts'} via ${source}`);
}

/** Facts the encryption service extracted from this mutation's encrypted args, if any. */
export function getMutationDerived(): DerivedFacts | undefined {
  return mutationDerivedContext.getStore();
}

/**
 * The facts of one source field of a contracted mutator, typed by its contract entry: exactly
 * the extractors and keys listed under that field in `sourceToDerived`. Undefined when the
 * field carried no text (empty, null, not sent).
 */
export function getMutationFacts<C extends RequestContract, F extends Extract<keyof C['sourceToDerived'], string>>(
  _contract: C,
  field: F,
): FieldDerived<C['sourceToDerived'], F> | undefined {
  return mutationDerivedContext.getStore()?.fields[field] as FieldDerived<C['sourceToDerived'], F> | undefined;
}

/**
 * getMutationFacts for a field the mutator knows held text. Facts exist whenever the
 * encryption service transformed the field, so their absence means the mutator is not in
 * MUTATION_CONTRACTS or the service returned none: a wiring bug, not a case to parse the
 * ciphertext for.
 */
export function requireMutationFacts<C extends RequestContract, F extends Extract<keyof C['sourceToDerived'], string>>(
  contract: C,
  field: F,
): FieldDerived<C['sourceToDerived'], F> {
  const facts = getMutationFacts(contract, field);
  if (!facts) {
    const name = Object.entries(MUTATION_CONTRACTS).find(([, c]) => c === contract)?.[0] ?? 'a contracted mutator';
    throw new MutationEncryptionError('ENC_DERIVED_MISSING', `${name} ran without derived facts for "${field}"`);
  }
  return facts;
}

type ContractMutatorFn<TArgs> = (options: {
  tx: UnreadableTransaction;
  ctx: DefaultContext;
  args: TArgs;
}) => Promise<void>;

/**
 * `defineMutator` with unreadable values: the one place a mutator's args and reads are made
 * unreadable.
 *
 * - Args: with a contract, each arg is first checked against its type in the contract
 *   (assertArgsMatchContract), then the contract's `unreadableString()` fields come in as
 *   `UnreadableString`, every other field as validated. Without one, the args pass through.
 *   The wrapping happens after Zero has validated the args against `validator`, because a
 *   mutator's validated args must be JSON and an `UnreadableString` is not.
 * - Reads: `tx.run` returns the columns in UNREADABLE_COLUMNS as `UnreadableString`, every
 *   other column as stored; `tx.read(query, facts)` also returns the facts asked for from
 *   those columns (see unreadableTransaction).
 *
 * The body reads an unreadable value only through reveal().
 */
export function defineContractMutator<
  C extends RequestContract,
  TInput extends ReadonlyJSONValue | undefined,
  TOutput extends ReadonlyJSONValue & object,
>(
  contract: C,
  validator: z.ZodType<TOutput, TInput>,
  mutator: ContractMutatorFn<UnreadableBody<C, TOutput>>,
): MutatorDefinition<TInput, TOutput, DefaultContext, DefaultWrappedTransaction>;
export function defineContractMutator<
  TInput extends ReadonlyJSONValue | undefined,
  TOutput extends ReadonlyJSONValue | undefined,
>(
  validator: z.ZodType<TOutput, TInput>,
  mutator: ContractMutatorFn<TOutput>,
): MutatorDefinition<TInput, TOutput, DefaultContext, DefaultWrappedTransaction>;
export function defineContractMutator(
  ...params:
    | [RequestContract, z.ZodType<ReadonlyJSONValue, ReadonlyJSONValue>, ContractMutatorFn<never>]
    | [z.ZodType<ReadonlyJSONValue, ReadonlyJSONValue>, ContractMutatorFn<never>]
) {
  const [contract, validator, mutator] = params.length === 3 ? params : [undefined, ...params];
  return defineMutator(validator, ({ tx, ctx, args }) => {
    let body: unknown = args;
    if (contract) {
      assertArgsMatchContract(contract, args as Record<string, unknown>);
      body = makeUnreadable(contract, args as object);
      recordContractApplied();
      recordUnreadableWrapped({
        side: 'args',
        // Validated args are JSON, so every UnreadableString here was wrapped just now.
        columns: Object.entries(body as object).flatMap(([field, value]) => (value instanceof UnreadableString ? [field] : [])),
      });
    }
    return mutator({
      tx: unreadableTransaction(tx, ctx.workspaceId),
      ctx,
      // The overloads tie the args type to the contract; here it is the value either way.
      args: body as never,
    });
  });
}

/**
 * Refuses args whose form does not match their type in the contract, before they are made
 * unreadable. The encryption service only turns the transit ciphertext of every field the
 * mutator's rule does not list as plaintext (enc_contract_entries) into workspace-DEK
 * ciphertext; this is where the rule and the contract are held to agree:
 *
 * - ciphertext in a field the contract keeps plaintext: the field is missing from the rule's
 *   plaintext list (a new non-sensitive field nobody listed), so the client encrypted it;
 * - plaintext in an `unreadableString()` field of args the encryption service transformed: the
 *   rule lists the field as plaintext (a sensitive field listed by mistake). Args the client
 *   sent without a manifest (DB or client encryption off) are plaintext throughout and are
 *   encrypted at rest on write, so this side is checked only under DEK passthrough.
 *
 * Empty strings are never encrypted and pass. A client whose manifest predates the rule sends
 * the same mismatch, so the refusal is ENC_MANIFEST_STALE: it refetches the manifest and resends
 * once; a mismatch that survives that is drift between the rule and the contract.
 */
function assertArgsMatchContract(contract: RequestContract, args: Record<string, unknown>): void {
  const transformed = isDekPassthrough();
  for (const [field, value] of Object.entries(args)) {
    if (typeof value !== 'string' || value.length === 0) continue;
    const unreadable = contract.unreadableFields.includes(field);
    let problem: string | undefined;
    if (!unreadable && isCiphertextValue(value)) {
      problem = 'is plaintext in the contract but arrived encrypted: list it as plaintext in its manifest rule, or mark it unreadableString()';
    } else if (unreadable && transformed && !isCiphertextValue(value)) {
      problem = 'is unreadableString() in the contract but arrived as plaintext: remove it from its manifest rule\'s plaintext fields';
    }
    if (!problem) continue;
    const mutator = Object.entries(MUTATION_CONTRACTS).find(([, c]) => c === contract)?.[0] ?? 'a contracted mutator';
    logger.error('[encryptedMutation] arg does not match its type in the contract', { mutator, field, problem });
    getCryptoOperations().add(1, { operation: 'mutation_arg_form', status: 'error', reason: transformed ? 'transformed' : 'plaintext' });
    throw new MutationEncryptionError(CLIENT_MANIFEST_STALE_CODE, `${mutator}: "${field}" ${problem}`);
  }
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
 * Transforms `args` (one mutation with a MUTATOR rule) by
 * its manifest rule. Throws when it cannot be transformed: the fields are transit ciphertext
 * from here on, so the mutation is never run (and stored) as sent.
 */
async function transformMutationArgs(
  mutatorName: string,
  args: Record<string, unknown>,
  enc: MutationEncryptionContext | undefined,
  workspaceId: string,
): Promise<{ body: Record<string, unknown>; derived?: DerivedFacts }> {
  if (!config.enc.apiClientEncryptionEnabled || !config.enc.enableDbEncryption) {
    throw new MutationEncryptionError(
      'ENC_NOT_CONFIGURED',
      'Client-encrypted mutations need API client encryption and DB encryption enabled',
    );
  }
  if (!enc?.authToken && !enc?.clientKey) {
    throw new MutationEncryptionError('TRANSIT_KEY_REQUIRED', 'Client-encrypted mutation without a transit key');
  }
  // The contract only names the facts to extract; a rule mutator without one is still transformed.
  const contract = MUTATION_CONTRACTS[mutatorName];

  let transformed: { body: unknown; derived?: unknown };
  try {
    transformed = await getEncryptionProvider().transformRequest({
      body: args,
      ...(enc.authToken ? { authToken: enc.authToken } : {}),
      ...(enc.clientKey ? { clientKey: enc.clientKey } : {}),
      mutator: mutatorName,
      // Mutator rules list their plaintext fields; the args are checked against the contract
      // here (assertArgsMatchContract), so only the facts to extract go along.
      ...(contract ? { contractDerived: derivedNames(contract) } : {}),
      entityId: workspaceId,
      entityType: 'WORKSPACE',
    });
  } catch (error) {
    const { body: verdict, status } = error as { body?: { code?: unknown; message?: unknown }; status?: unknown };
    getCryptoOperations().add(1, {
      operation: 'transform_mutation',
      status: 'error',
      reason: typeof verdict?.code === 'string' ? verdict.code : 'transform_failed',
    });
    if (typeof verdict?.code === 'string') {
      throw new MutationEncryptionError(
        verdict.code,
        String(verdict.message ?? verdict.code),
        typeof status === 'number' ? status : undefined,
      );
    }
    logger.error('[encryptedMutation] failed to transform mutation args', {
      mutator: mutatorName,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error('Failed to transform encrypted mutation');
  }

  let derived: DerivedFacts | undefined;
  if (transformed.derived !== undefined) {
    const parsed = derivedFactsSchema.safeParse(transformed.derived);
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
  const ruled = new Set(await getEncryptionProvider().getClientEncryptedMutators());

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
      if (!ruled.has(String(m?.name))) {
        // PREPARED_ARG is set here only; one the client sent is dropped.
        const { [PREPARED_ARG]: _forged, ...plain } = args as Record<string, unknown>;
        // No rule: the args are plaintext. Transit ciphertext here comes from a client still
        // encrypting every arg (an old tab); it is refused, never decrypted or stored.
        if (hasTransitCiphertext(plain)) {
          const key = randomUUID();
          getCryptoOperations().add(1, { operation: 'mutation_args', status: 'error', reason: 'transit_without_rule' });
          logger.warn('[encryptedMutation] transit ciphertext in a mutation without a manifest rule', { mutator: String(m!.name) });
          prepared.set(key, {
            error: new MutationEncryptionError(
              'TRANSIT_WITHOUT_RULE',
              `${String(m!.name)} has no manifest rule, so its args must be sent as plaintext; reload the page`,
            ),
          });
          set({ ...plain, [PREPARED_ARG]: key });
          return;
        }
        // Plaintext args of a contracted mutator: extract the facts here, no passthrough.
        let derived: DerivedFacts | undefined;
        try {
          derived = deriveLocally(String(m!.name), plain);
        } catch (error) {
          recordFactsError({ mutator: String(m!.name), side: 'args', source: 'local' });
          throw error;
        }
        recordFactsDerived({ mutator: String(m!.name), side: 'args', source: 'local', columns: fieldsWithFacts(derived) });
        if (derived) {
          logDerivedFacts(String(m!.name), 'local', derived);
          const key = randomUUID();
          prepared.set(key, { derived, dekPassthrough: false });
          set({ ...plain, [PREPARED_ARG]: key });
        } else if (PREPARED_ARG in args) {
          set(plain);
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
        logDerivedFacts(String(m!.name), 'encryption-service', derived);
        recordFactsDerived({ mutator: String(m!.name), side: 'args', source: 'enc-rust', columns: fieldsWithFacts(derived) });
        prepared.set(key, { derived, dekPassthrough: true });
        next = { ...transformed, [PREPARED_ARG]: key };
      } catch (error) {
        recordFactsError({ mutator: String(m!.name), side: 'args', source: 'enc-rust' });
        prepared.set(key, { error: error instanceof Error ? error : new Error(String(error)) });
        next = { ...(args as Record<string, unknown>), [PREPARED_ARG]: key };
      }
      set(next);
    }),
  );
  return prepared;
}

/**
 * Inside the mutation's transaction: runs `run` with the args prepareEncryptedMutations
 * transformed and their derived facts (DEK passthrough on), or with plaintext args and the
 * facts extracted locally (passthrough off), or throws its refusal. Args of a mutator without
 * a contract run as sent.
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
