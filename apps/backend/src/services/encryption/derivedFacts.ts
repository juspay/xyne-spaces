import { isEncryptedField, runExtractors } from '@xyne/shared';
import type { DerivedContentFacts, RequestContract } from '@xyne/shared';

/**
 * The facts a request's handler reads in place of parsing its content, whichever way the
 * content arrived. Encrypted content is opaque here, so its facts are the ones the
 * encryption service extracted (`fromService`). Plaintext is extracted here, with the same
 * extractors the encryption service runs, for every fact the contract names that the
 * service did not return (it is off, the client did not encrypt, or the rule's extraction
 * policy leaves some out). Handlers therefore read `derived` only.
 */
export function resolveDerived(
  contract: RequestContract,
  body: unknown,
  fromService?: DerivedContentFacts,
): DerivedContentFacts | undefined {
  if (!contract.derivedFrom) return fromService;
  const source = (body as Record<string, unknown> | null | undefined)?.[contract.derivedFrom];
  if (isEncryptedField(source)) return fromService;

  const missing = contract.derived.filter(name => fromService?.[name] === undefined);
  if (missing.length === 0) return fromService;
  return { ...runExtractors(typeof source === 'string' ? source : '', missing), ...fromService };
}
