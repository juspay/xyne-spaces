import type { z } from 'zod';
import type { ExtractorName, PersistPath } from './extractors.js';
import type { ClientManifestFieldRule, ClientManifestRule, PersistPolicy, ExtractionPolicy } from './manifest.js';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * One API's encryption contract: the request body's shape, which of its fields the
 * client encrypts, and what the encryption service extracts and persists from them.
 * The manifest rule is generated from this (contractToRule), never written by hand.
 */
export interface RequestContract<S extends z.ZodObject = z.ZodObject> {
  kind: 'REQUEST';
  route: `${Method} /${string}`;
  revision: number;
  schema: S;
  encrypt: ReadonlyArray<keyof z.infer<S> & string>;
  derive: ReadonlyArray<ExtractorName>;
  /**
   * Which derived facts should be kept with the written row. Declarative policy only for
   * now: nothing is stored until a read-time consumer exists.
   */
  persist: ReadonlyArray<PersistPath>;
}

/**
 * `persist` is typed against this contract's `derive`, so persisting a path whose root
 * extractor is not derived fails to compile; the runtime check covers callers that widen
 * the arrays (e.g. built from `string[]`).
 */
export function defineRequestContract<S extends z.ZodObject, const D extends ReadonlyArray<ExtractorName>>(
  contract: Omit<RequestContract<S>, 'kind' | 'derive' | 'persist'> & {
    derive: D;
    persist: ReadonlyArray<D[number] | `${D[number]}.${string}`>;
  },
): RequestContract<S> {
  for (const path of contract.persist) {
    const root = path.split('.')[0];
    if (!(contract.derive as ReadonlyArray<string>).includes(root)) {
      throw new Error(
        `Encryption contract ${contract.route}: persist path "${path}" needs "${root}" in derive`,
      );
    }
  }
  return { kind: 'REQUEST', ...contract };
}

export type RequestBody<C> = C extends RequestContract<infer S> ? z.infer<S> : never;

const ENCRYPTED_FIELD: ClientManifestFieldRule = { client: true, transform: 'MASTER_DEK', storage: 'MASTER_DEK' };
const PLAIN_FIELD: ClientManifestFieldRule = { client: false, transform: 'NONE', storage: 'NONE' };

/** The manifest rule a contract stands for: every schema key, encrypted or not. */
export function contractToRule(contract: RequestContract): ClientManifestRule {
  const encrypted = new Set<string>(contract.encrypt);
  const fields: Record<string, ClientManifestFieldRule> = {};
  for (const key of Object.keys(contract.schema.shape)) {
    fields[key] = { ...(encrypted.has(key) ? ENCRYPTED_FIELD : PLAIN_FIELD) };
  }

  // Each derived extractor persists everything (bare name in `persist`), only the listed
  // sub-paths ("<name>.<sub>"), or nothing.
  const extractionPolicy: ExtractionPolicy = {};
  for (const name of contract.derive) {
    const subPaths = contract.persist
      .filter(path => path.startsWith(`${name}.`))
      .map(path => path.slice(name.length + 1));
    const persist: PersistPolicy = contract.persist.includes(name)
      ? true
      : subPaths.length > 0
        ? subPaths
        : false;
    extractionPolicy[name] = { persist };
  }

  return {
    type: 'REQUEST',
    value: contract.route,
    revision: contract.revision,
    fields,
    extractionPolicy,
  };
}
