export type ClientManifestTransform = 'NONE' | 'MASTER_DEK';

/**
 * One field of a manifest rule: whether the client encrypts it and what the encryption
 * service turns the ciphertext into. The key a stored value is under is named by the
 * ciphertext itself (`ENC:v1|<keyId>|…`), so it is not part of the rule.
 */
export interface ClientManifestFieldRule {
  client: boolean;
  transform: ClientManifestTransform;
}

/**
 * A rule names its fields one of two ways. `plaintextFields` (Zero mutators): the fields sent as
 * plaintext; the client encrypts every other non-empty top-level string. `fields` (older
 * rules): each field's treatment; a field it does not name is sent as it is.
 */
export interface ClientManifestRule {
  type: 'REQUEST' | 'MUTATOR';
  value: string;
  revision: number;
  fields?: Record<string, ClientManifestFieldRule>;
  plaintextFields?: string[];
}

export interface ClientEncryptionManifest {
  schemaKey: string;
  version: number;
  tag: string;
  rules: ClientManifestRule[];
}
