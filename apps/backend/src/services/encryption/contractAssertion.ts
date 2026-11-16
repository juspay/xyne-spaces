import { REQUEST_CONTRACTS, contractToRule } from '@xyne/shared';
import type { ClientManifestRule, PersistPolicy, ExtractionPolicy } from '@xyne/shared';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { getCryptoOperations } from '@/services/otel/cryptoMetrics';
import { getLatestClientManifest } from './clientManifestCache';

// Order-insensitive.
function sameList(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  const left = [...(a ?? [])].sort();
  const right = [...(b ?? [])].sort();
  return left.length === right.length && left.every((value, i) => value === right[i]);
}

function sameFields(a: ClientManifestRule['fields'], b: ClientManifestRule['fields']): boolean {
  const keys = Object.keys(a);
  if (!sameList(keys, Object.keys(b))) return false;
  return keys.every(
    (key) =>
      a[key].client === b[key].client &&
      a[key].transform === b[key].transform &&
      a[key].storage === b[key].storage,
  );
}

function samePersist(a: PersistPolicy, b: PersistPolicy): boolean {
  if (typeof a === 'boolean' || typeof b === 'boolean') return a === b;
  return sameList(a, b);
}

// A rule served without an extractionPolicy (not shipped yet) counts as {}.
function sameExtractionPolicy(a: ExtractionPolicy | undefined, b: ExtractionPolicy | undefined): boolean {
  const left = a ?? {};
  const right = b ?? {};
  const names = Object.keys(left) as Array<keyof ExtractionPolicy>;
  if (!sameList(names, Object.keys(right))) return false;
  return names.every((name) => {
    const l = left[name];
    const r = right[name];
    return Boolean(l && r) && samePersist(l!.persist, r!.persist);
  });
}

function describeMismatch(expected: ClientManifestRule, served: ClientManifestRule | undefined): string | null {
  if (!served) return 'no manifest rule with this value and revision';
  const diffs: string[] = [];
  if (!sameFields(expected.fields, served.fields)) diffs.push('fields');
  if (!sameExtractionPolicy(expected.extractionPolicy, served.extractionPolicy)) diffs.push('extractionPolicy');
  return diffs.length > 0 ? `differs in ${diffs.join(', ')}` : null;
}

/**
 * Checks that every request contract in @xyne/shared matches the rule the encryption
 * service serves for it (same value + revision; fields and extractionPolicy equal). A
 * mismatch throws in development and is logged plus counted elsewhere. An encryption
 * service outage is logged and never blocks startup.
 */
export async function assertEncContractsMatchManifest(): Promise<void> {
  if (!config.enc.apiClientEncryptionEnabled) return;

  let manifest: Awaited<ReturnType<typeof getLatestClientManifest>>;
  try {
    manifest = await getLatestClientManifest('default');
  } catch (error) {
    logger.error('[encContracts] could not load the client manifest; contract check skipped', {
      environment: config.env,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  const mismatches: string[] = [];
  for (const contract of REQUEST_CONTRACTS) {
    const expected = contractToRule(contract);
    const served = manifest?.rules.find(
      (rule) => rule.type === expected.type && rule.value === expected.value && rule.revision === expected.revision,
    );
    const mismatch = describeMismatch(expected, served);
    if (mismatch) mismatches.push(`${expected.value} (rev ${expected.revision}): ${mismatch}`);
  }

  if (mismatches.length === 0) {
    logger.info('[encContracts] request contracts match the client manifest', {
      contracts: REQUEST_CONTRACTS.length,
      manifestVersion: manifest?.version ?? null,
    });
    return;
  }

  const message = `Encryption contracts do not match the client manifest: ${mismatches.join('; ')}`;
  if (config.env === 'development') {
    throw new Error(message);
  }

  logger.error(`[encContracts] ${message}`, { environment: config.env, manifestVersion: manifest?.version ?? null });
  getCryptoOperations().add(mismatches.length, {
    operation: 'enc_contract_mismatch',
    status: 'error',
  });
}
