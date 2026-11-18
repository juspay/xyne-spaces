import type { ClientEncryptionManifest, ClientManifestRule } from './client-manifest.js';
import { matchesRoute, normalizeRequestPath } from '../enc-contracts/route-match.js';

export type FieldEncryptor = (value: string, fieldName: string) => Promise<string>;

/**
 * REQUEST rule for `method` + `path`. `path` may carry a query string and the `/api`
 * prefix; both are stripped so client and server match the same way.
 */
export function findRequestRule(
  manifest: ClientEncryptionManifest,
  method: string,
  path: string,
): ClientManifestRule | undefined {
  const normalizedPath = normalizeRequestPath(path);
  return manifest.rules.find(
    rule => rule.type === 'REQUEST' && matchesRoute(rule.value, method, normalizedPath),
  );
}

/** MUTATOR rule for the Zero mutator `name` ("conversations.send"). */
export function findMutatorRule(
  manifest: ClientEncryptionManifest,
  name: string,
): ClientManifestRule | undefined {
  return manifest.rules.find(rule => rule.type === 'MUTATOR' && rule.value === name);
}

/**
 * Encrypt the top-level keys the rule marks `client: true` (non-empty strings only).
 * Keys missing from the rule are left as-is and returned in `unknownKeys`.
 */
export async function encryptBodyWithRule(
  body: Record<string, unknown>,
  rule: ClientManifestRule,
  encrypt: FieldEncryptor,
): Promise<{ body: Record<string, unknown>; unknownKeys: string[] }> {
  const result: Record<string, unknown> = {};
  const unknownKeys: string[] = [];

  for (const [key, value] of Object.entries(body)) {
    const fieldRule = rule.fields[key];
    if (!fieldRule) unknownKeys.push(key);
    result[key] =
      fieldRule?.client && typeof value === 'string' && value.length > 0
        ? await encrypt(value, key)
        : value;
  }

  return { body: result, unknownKeys };
}

/**
 * FormData counterpart of encryptBodyWithRule; mutates `formData` with `set`. File/Blob
 * entries are never touched and are not reported as unknown (they are file parts, not
 * body fields).
 */
export async function encryptFormDataWithRule(
  formData: FormData,
  rule: ClientManifestRule,
  encrypt: FieldEncryptor,
): Promise<{ unknownKeys: string[] }> {
  const unknownKeys: string[] = [];

  // Snapshot first: `set` while iterating would reorder entries.
  const entries: Array<[string, string]> = [];
  formData.forEach((value, key) => {
    if (typeof value === 'string') entries.push([key, value]);
  });

  for (const [key, value] of entries) {
    const fieldRule = rule.fields[key];
    if (!fieldRule) {
      if (!unknownKeys.includes(key)) unknownKeys.push(key);
      continue;
    }
    if (fieldRule.client && value.length > 0) {
      formData.set(key, await encrypt(value, key));
    }
  }

  return { unknownKeys };
}
