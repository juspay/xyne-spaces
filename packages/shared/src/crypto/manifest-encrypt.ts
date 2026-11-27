import type { ClientEncryptionManifest, ClientManifestRule } from './client-manifest.js';
import { matchesRoute, normalizeRequestPath } from './route-match.js';

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
 * Whether the client encrypts top-level field `key` under `rule`: every field a
 * `plaintextFields` rule does not list, the fields a `fields` rule marks `client: true`.
 * Undefined for a field a `fields` rule does not name.
 */
export function clientEncryptsField(rule: ClientManifestRule, key: string): boolean | undefined {
  if (rule.plaintextFields) return !rule.plaintextFields.includes(key);
  return rule.fields?.[key]?.client;
}

/**
 * Encrypt the top-level keys `clientEncryptsField` says the client encrypts (non-empty strings
 * only). Keys a `fields` rule does not name are left as-is and returned in `unknownKeys`.
 */
export async function encryptBodyWithRule(
  body: Record<string, unknown>,
  rule: ClientManifestRule,
  encrypt: FieldEncryptor,
): Promise<{ body: Record<string, unknown>; unknownKeys: string[] }> {
  const result: Record<string, unknown> = {};
  const unknownKeys: string[] = [];

  for (const [key, value] of Object.entries(body)) {
    const encrypted = clientEncryptsField(rule, key);
    if (encrypted === undefined) unknownKeys.push(key);
    result[key] =
      encrypted && typeof value === 'string' && value.length > 0
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
    const encrypted = clientEncryptsField(rule, key);
    if (encrypted === undefined) {
      if (!unknownKeys.includes(key)) unknownKeys.push(key);
      continue;
    }
    if (encrypted && value.length > 0) {
      formData.set(key, await encrypt(value, key));
    }
  }

  return { unknownKeys };
}
