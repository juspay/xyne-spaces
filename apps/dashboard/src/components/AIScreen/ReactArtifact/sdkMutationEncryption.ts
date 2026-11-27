import {
  CLIENT_MANIFEST_STALE_CODE,
  clientEncryptsField,
  encryptField,
  expandMentionShorthand,
  findMutatorRule,
  getClientManifest,
} from '@xyne/shared';
import { getEncryptionState, isEncryptionReady } from '../../../machines/encryptionMachine';
import { decryptResponseText } from '../../../services/encryptionInterceptors';
import { apiInstance } from '../../../services/clients/apiClient';

/** The SDK API's write endpoint: `{ op, args }`, where `op` runs a Zero mutator. */
export const SDK_MUTATE_PATH = '/api/sdk/v3/mutate';

/** `GET /api/sdk/v3/encryption-rules`: the SDK ops whose mutator has a manifest rule. */
interface EncryptionRules {
  ops: Record<string, { mutator: string; mentionFields: string[] }>;
}

let rules: Promise<EncryptionRules> | null = null;

/** Fetched on the first ruled-looking write, then kept; a failed fetch is tried again next time. */
function loadRules(): Promise<EncryptionRules> {
  if (!rules) {
    const loading = apiInstance.get<EncryptionRules>('/sdk/v3/encryption-rules').then(r => r.data);
    loading.catch(() => {
      if (rules === loading) rules = null;
    });
    rules = loading;
  }
  return rules;
}

/**
 * An artifact app's SDK write (`POST /api/sdk/v3/mutate` body), with the fields its mutator's
 * manifest rule has the client encrypt encrypted for the viewer's transit key, as the
 * dashboard's own Zero writes are. The server refuses plaintext in those fields and does not
 * expand mention shorthand in ciphertext, so shorthand in a mention field is expanded first.
 * Returned unchanged when the op has no rule or the dashboard has client encryption off.
 */
export async function encryptSdkMutation(body: string): Promise<string> {
  const { keyring, apiClientEncryptionEnabled } = getEncryptionState();
  if (!isEncryptionReady() || !apiClientEncryptionEnabled || !keyring || !getClientManifest()) {
    return body;
  }

  let call: unknown;
  try {
    call = JSON.parse(body);
  } catch {
    return body;
  }
  if (!call || typeof call !== 'object' || Array.isArray(call)) return body;
  const { op, args } = call as { op?: unknown; args?: unknown };
  if (typeof op !== 'string' || !args || typeof args !== 'object' || Array.isArray(args))
    return body;

  const entry = (await loadRules()).ops[op];
  const manifest = getClientManifest();
  const rule = entry && manifest ? findMutatorRule(manifest, entry.mutator) : undefined;
  if (!entry || !rule) return body;

  const encrypted: Record<string, unknown> = { ...(args as Record<string, unknown>) };
  for (const [field, value] of Object.entries(encrypted)) {
    if (!clientEncryptsField(rule, field) || typeof value !== 'string' || value.length === 0)
      continue;
    const text = entry.mentionFields.includes(field) ? expandMentionShorthand(value) : value;
    encrypted[field] = await encryptField(text, keyring);
  }
  return JSON.stringify({ ...(call as Record<string, unknown>), args: encrypted });
}

/**
 * Whether the server refused a write for a manifest it no longer serves (`reason`
 * ENC_MANIFEST_STALE, transit-encrypted like the rest of the error). The body is read
 * from a clone, so the response can still be relayed.
 */
export async function isStaleManifestReply(response: Response): Promise<boolean> {
  if (response.status !== 400) return false;
  try {
    const text = await decryptResponseText(await response.clone().text());
    const parsed = JSON.parse(text) as { error?: { reason?: unknown } };
    return parsed.error?.reason === CLIENT_MANIFEST_STALE_CODE;
  } catch {
    return false;
  }
}
