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

export interface ClientManifestRule {
  type: 'REQUEST' | 'MUTATOR';
  value: string;
  revision: number;
  fields: Record<string, ClientManifestFieldRule>;
}

export interface ClientEncryptionManifest {
  schemaKey: string;
  version: number;
  tag: string;
  rules: ClientManifestRule[];
}
