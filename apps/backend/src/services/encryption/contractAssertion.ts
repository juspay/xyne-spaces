import { REQUEST_CONTRACTS } from '@xyne/shared';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { getCryptoOperations } from '@/services/otel/cryptoMetrics';
import { getLatestClientManifest } from './clientManifestCache';

/**
 * Checks that the request contracts in @xyne/shared (route + body schema) and the rules
 * the encryption service serves (the encryption policy) agree on field names, in both
 * directions: a manifest field the schema doesn't have is a typo or a removed field, and a
 * schema field the manifest doesn't list would go out without a policy. Every REQUEST rule
 * must also have a contract. Policy values themselves are owned by the encryption service
 * and not compared. A mismatch throws in development and is logged plus counted elsewhere.
 * An encryption service outage is logged and never blocks startup.
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

  const rules = (manifest?.rules ?? []).filter((rule) => rule.type === 'REQUEST');
  const mismatches: string[] = [];

  for (const contract of REQUEST_CONTRACTS) {
    const rule = rules.find((candidate) => candidate.value === contract.route);
    if (!rule) {
      mismatches.push(`${contract.route}: no manifest rule for this route`);
      continue;
    }

    const schemaFields = new Set(Object.keys(contract.schema.shape));
    const ruleFields = new Set(Object.keys(rule.fields));
    const notInRule = [...schemaFields].filter((field) => !ruleFields.has(field));
    const notInSchema = [...ruleFields].filter((field) => !schemaFields.has(field));
    if (notInRule.length > 0) {
      mismatches.push(`${contract.route}: schema fields missing from the manifest rule: ${notInRule.join(', ')}`);
    }
    if (notInSchema.length > 0) {
      mismatches.push(`${contract.route}: manifest fields missing from the schema: ${notInSchema.join(', ')}`);
    }
  }

  for (const rule of rules) {
    if (!REQUEST_CONTRACTS.some((contract) => contract.route === rule.value)) {
      mismatches.push(`${rule.value}: manifest rule has no request contract`);
    }
  }

  if (mismatches.length === 0) {
    logger.info('[encContracts] request contracts and the client manifest agree on fields', {
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
