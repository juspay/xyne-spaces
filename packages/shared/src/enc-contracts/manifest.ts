export type ClientManifestTransform = 'NONE' | 'MASTER_DEK';

export interface ClientManifestFieldRule {
  client: boolean;
  transform: ClientManifestTransform;
  storage: ClientManifestTransform;
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
  environment: string;
  rules: ClientManifestRule[];
}
