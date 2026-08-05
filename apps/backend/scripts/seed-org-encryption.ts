#!/usr/bin/env tsx

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

type DefaultOrgRow = {
  orgId: string;
  name: string;
  createdBy: string;
};

type DefaultWorkspaceRow = {
  orgId: string;
  workspaceId: string;
};

type ActiveDekRow = {
  dekId: string;
  orgId: string;
  workspaceId: string;
  wrappedDek: Uint8Array;
  wrappingProvider: string;
  wrappingKeyRef: string;
};

type OrgEncryptionConfigRow = {
  provider: string;
  kmsKeyRef: string;
  useCustomerManagedKey: boolean;
  status: string;
};

const ACTIVE_STATUS = 'ACTIVE';
const INACTIVE_STATUS = 'INACTIVE';
const ENV_KEY_REF = 'env-master-key';

const prisma = new PrismaClient();

function loadEncryptionLocalEnv(): Record<string, string> {
  const scriptPath = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(scriptPath), '../..');
  const envPath = path.join(repoRoot, 'encryption/.env.local');

  if (!fs.existsSync(envPath)) {
    throw new Error(`Missing encryption env file at ${envPath}`);
  }

  return dotenv.parse(fs.readFileSync(envPath));
}

function getEnvValue(env: Record<string, string>, key: string): string | undefined {
  return env[key] ?? process.env[key];
}

function getEnvMasterKey(env: Record<string, string>): Buffer {
  const masterKeyHex = getEnvValue(env, 'ENC_ENV_MASTER_KEY_HEX')?.trim();

  if (!masterKeyHex || !/^[0-9a-fA-F]{64}$/.test(masterKeyHex)) {
    throw new Error('ENC_ENV_MASTER_KEY_HEX must be a 64-character hex value in apps/encryption/.env.local');
  }

  return Buffer.from(masterKeyHex, 'hex');
}

function wrapDek(plaintextDek: Buffer, masterKey: Buffer): Buffer {
  const cipher = crypto.createCipheriv('aes256-wrap', masterKey, Buffer.alloc(8, 0xa6));
  return Buffer.concat([cipher.update(plaintextDek), cipher.final()]);
}

function unwrapDek(wrappedDek: Uint8Array, masterKey: Buffer): Buffer {
  const decipher = crypto.createDecipheriv('aes256-wrap', masterKey, Buffer.alloc(8, 0xa6));
  return Buffer.concat([decipher.update(Buffer.from(wrappedDek)), decipher.final()]);
}

function compactDekId(): string {
  return crypto.randomBytes(8).toString('base64url');
}

function isValidActiveDek(row: ActiveDekRow, masterKey: Buffer, provider: string, keyRef: string): boolean {
  if (row.wrappingProvider !== provider || row.wrappingKeyRef !== keyRef) {
    return false;
  }

  try {
    return unwrapDek(row.wrappedDek, masterKey).length === 32;
  } catch {
    return false;
  }
}

async function getDefaultOrgs(): Promise<DefaultOrgRow[]> {
  return prisma.$queryRaw<DefaultOrgRow[]>`
    SELECT "orgId", "name", "createdBy"
    FROM public.organizations
    WHERE "createdBy" = 'system-seed'
       OR "orgId" = 'xyne-default-org'
    ORDER BY "orgId"
  `;
}

async function getDefaultWorkspaces(orgId: string): Promise<DefaultWorkspaceRow[]> {
  return prisma.$queryRawUnsafe<DefaultWorkspaceRow[]>(
    `SELECT w."orgId" AS "orgId", w."id" AS "workspaceId"
     FROM public.workspaces w
     WHERE w."orgId" = $1
     ORDER BY w."id"`,
    orgId,
  );
}

async function upsertOrgEncryptionConfig(orgId: string, provider: string, keyRef: string): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO encryption.org_encryption_configs
      ("orgId", "provider", "kmsKeyRef", "useCustomerManagedKey", "providerConfig", "status", "createdAt", "updatedAt")
     VALUES
      ($1, $2, $3, false, NULL, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT ("orgId") DO UPDATE SET
      "provider" = EXCLUDED."provider",
      "kmsKeyRef" = EXCLUDED."kmsKeyRef",
      "useCustomerManagedKey" = EXCLUDED."useCustomerManagedKey",
      "providerConfig" = EXCLUDED."providerConfig",
      "status" = EXCLUDED."status",
      "updatedAt" = CURRENT_TIMESTAMP`,
    orgId,
    provider,
    keyRef,
    ACTIVE_STATUS,
  );
}

async function getOrgEncryptionConfig(orgId: string): Promise<OrgEncryptionConfigRow | null> {
  const rows = await prisma.$queryRawUnsafe<OrgEncryptionConfigRow[]>(
    `SELECT "provider", "kmsKeyRef", "useCustomerManagedKey", "status"
     FROM encryption.org_encryption_configs
     WHERE "orgId" = $1
     LIMIT 1`,
    orgId,
  );

  return rows[0] ?? null;
}

function isValidOrgEncryptionConfig(
  row: OrgEncryptionConfigRow | null,
  provider: string,
  keyRef: string,
): boolean {
  return Boolean(
    row
      && row.provider === provider
      && row.kmsKeyRef === keyRef
      && row.useCustomerManagedKey === false
      && row.status === ACTIVE_STATUS,
  );
}

async function getActiveDek(workspaceId: string): Promise<ActiveDekRow | null> {
  const rows = await prisma.$queryRawUnsafe<ActiveDekRow[]>(
    `SELECT "dekId", "orgId", "workspaceId", "wrappedDek", "wrappingProvider", "wrappingKeyRef"
     FROM encryption.org_data_encryption_keys
     WHERE "workspaceId" = $1 AND "status" = $2
     ORDER BY "activatedAt" DESC
     LIMIT 1`,
    workspaceId,
    ACTIVE_STATUS,
  );

  return rows[0] ?? null;
}

async function deactivateActiveDeks(workspaceId: string): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE encryption.org_data_encryption_keys
     SET "status" = $1,
         "deactivatedAt" = CURRENT_TIMESTAMP
     WHERE "workspaceId" = $2 AND "status" = $3`,
    INACTIVE_STATUS,
    workspaceId,
    ACTIVE_STATUS,
  );
}

async function insertActiveDek(
  orgId: string,
  workspaceId: string,
  provider: string,
  keyRef: string,
  masterKey: Buffer,
): Promise<string> {
  const dekId = compactDekId();
  const wrappedDekHex = wrapDek(crypto.randomBytes(32), masterKey).toString('hex');

  await prisma.$executeRawUnsafe(
    `INSERT INTO encryption.org_data_encryption_keys
      ("dekId", "orgId", "workspaceId", "wrappedDek", "wrappingProvider", "wrappingKeyRef", "status", "activatedAt", "createdAt")
     VALUES
      ($1, $2, $3, decode($4, 'hex'), $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    dekId,
    orgId,
    workspaceId,
    wrappedDekHex,
    provider,
    keyRef,
    ACTIVE_STATUS,
  );

  return dekId;
}

async function main(): Promise<void> {
  const encryptionEnv = loadEncryptionLocalEnv();
  const provider = getEnvValue(encryptionEnv, 'KMS_ENC_PROVIDER') || 'env';

  if (provider !== 'env') {
    throw new Error(`Local org encryption seed currently supports KMS_ENC_PROVIDER=env, got ${provider}`);
  }

  const keyRef = ENV_KEY_REF;
  const masterKey = getEnvMasterKey(encryptionEnv);
  const orgs = await getDefaultOrgs();

  if (orgs.length === 0) {
    console.log('  No default organizations found for encryption seed');
    return;
  }

  let insertedKeys = 0;
  let reusedKeys = 0;
  let updatedConfigs = 0;
  let workspaceCount = 0;

  for (const org of orgs) {
    const orgConfig = await getOrgEncryptionConfig(org.orgId);
    const hasValidConfig = isValidOrgEncryptionConfig(orgConfig, provider, keyRef);

    if (!hasValidConfig) {
      await upsertOrgEncryptionConfig(org.orgId, provider, keyRef);
      updatedConfigs += 1;
    }

    const workspaces = await getDefaultWorkspaces(org.orgId);
    workspaceCount += workspaces.length;

    for (const workspace of workspaces) {
      const activeDek = await getActiveDek(workspace.workspaceId);
      const hasValidActiveDek = Boolean(
        activeDek
          && activeDek.orgId === workspace.orgId
          && activeDek.workspaceId === workspace.workspaceId
          && isValidActiveDek(activeDek, masterKey, provider, keyRef),
      );

      if (hasValidActiveDek) {
        reusedKeys += 1;
        continue;
      }

      if (activeDek) {
        await deactivateActiveDeks(workspace.workspaceId);
      }

      await insertActiveDek(workspace.orgId, workspace.workspaceId, provider, keyRef, masterKey);
      insertedKeys += 1;
    }
  }

  console.log(`  Seeded encryption config for ${orgs.length} default organization(s)`);
  console.log(`  Config rows ready: ${orgs.length - updatedConfigs} unchanged, ${updatedConfigs} updated`);
  console.log(`  Workspace-scoped active DEKs ready across ${workspaceCount} workspace(s): ${reusedKeys} reused, ${insertedKeys} inserted`);
}

main()
  .catch((error) => {
    console.error('Failed to seed default organization encryption:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
