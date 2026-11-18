import { AsyncLocalStorage } from 'async_hooks';
import {
  CLIENT_MANIFEST_MUTATION_ARG,
  conversationsSendClient,
  derivedContentFactsSchema,
} from '@xyne/shared';
import type { DerivedContentFacts, RequestContract } from '@xyne/shared';
import { config } from '@/config/env';
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
 */

/** Mutators with a request contract, by Zero mutator name. */
const MUTATION_CONTRACTS: Record<string, RequestContract> = {
  'conversations.send': conversationsSendClient,
};

/** Who is mutating, for the encryption service: the caller's transit public key and the request's manifest lane. */
export type MutationEncryptionContext = { clientKey?: string; environment: string };

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
 * Runs `run` with the mutation's args transformed by its manifest rule, when the client
 * encrypted it by one; otherwise with the args as sent (the manifest arg stripped).
 */
export async function runEncryptedMutation<T>(
  mutatorName: string,
  args: unknown,
  enc: MutationEncryptionContext | undefined,
  workspaceId: string,
  run: (args: unknown, derived: DerivedContentFacts | undefined) => Promise<T>,
): Promise<T> {
  if (!args || typeof args !== 'object' || Array.isArray(args) || !(CLIENT_MANIFEST_MUTATION_ARG in args)) {
    return run(args, undefined);
  }
  const { [CLIENT_MANIFEST_MUTATION_ARG]: client, ...body } = args as Record<string, unknown>;
  const contract = MUTATION_CONTRACTS[mutatorName];
  if (!contract || !config.enc.apiClientEncryptionEnabled || !config.enc.enableDbEncryption || !enc?.clientKey) {
    return run(body, undefined);
  }

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
      contractFields: Object.keys(contract.schema.shape),
      contractEncrypted: [...contract.encrypted],
      contractDerived: [...contract.derived],
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

  return runWithDekPassthrough(() =>
    mutationDerivedContext.run(derived, () => run(transformed.body, derived)),
  );
}
