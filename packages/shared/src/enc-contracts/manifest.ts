import type { ExtractorName } from './extractors.js';

export type ClientManifestTransform = 'NONE' | 'MASTER_DEK';

export interface ClientManifestFieldRule {
  client: boolean;
  transform: ClientManifestTransform;
  storage: ClientManifestTransform;
}

/** Persist all of an extractor's output, none of it, or only these sub-paths (e.g. "pr"). */
export type PersistPolicy = true | false | readonly string[];

/** Extractors the encryption service runs for a rule, keyed by name; absent or {} = none. */
export type ExtractionPolicy = Partial<Record<ExtractorName, { persist: PersistPolicy }>>;

export interface ClientManifestRule {
  type: 'REQUEST' | 'MUTATOR';
  value: string;
  revision: number;
  fields: Record<string, ClientManifestFieldRule>;
  extractionPolicy?: ExtractionPolicy;
}

export interface ClientEncryptionManifest {
  schemaKey: string;
  version: number;
  tag: string;
  environment: string;
  rules: ClientManifestRule[];
}
