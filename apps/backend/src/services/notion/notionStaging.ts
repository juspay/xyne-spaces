/**
 * Collected Notion pages waiting for review live in the migration bucket (encrypted, like Slack
 * migration's staging), not on one pod's disk, so Approve works from any pod and after a restart.
 * Collect and ingest still work on a local folder; this copies it up and back down.
 */
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { getStorageService } from '@/services/storage';
import { decryptBuffer, encryptBuffer, isMigrationEncryptionConfigured } from '@/migration/self-serve/migrationCrypto';

const storage = () => getStorageService(config.gcs.migrationBucketName);

/** Needs the migration bucket and its encryption key; without them staging stays on local disk. */
export const remoteStagingEnabled = (): boolean => Boolean(config.gcs.migrationBucketName) && isMigrationEncryptionConfigured();

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter(e => e.isFile()).map(e => path.join(e.parentPath, e.name));
}

/** Upload a staged folder; returns its prefix. */
export async function uploadStaging(localDir: string, jobId: string): Promise<string> {
  const prefix = `notion-migration/${jobId}/`;
  for (const file of await filesUnder(localDir)) {
    const rel = path.relative(localDir, file).split(path.sep).join('/');
    await storage().uploadFileV2(encryptBuffer(await fs.readFile(file)), { path: prefix + rel, contentType: 'application/octet-stream' });
  }
  return prefix;
}

/** Download a staged prefix into a fresh local folder. */
export async function downloadStaging(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'notion-api-'));
  for (const { name } of await storage().listFiles(prefix)) {
    const target = path.join(dir, ...name.slice(prefix.length).split('/'));
    if (!target.startsWith(dir + path.sep)) continue; // never write outside the folder
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, decryptBuffer(await storage().getFileBuffer(name)));
  }
  return dir;
}

export async function deleteStaging(prefix: string): Promise<void> {
  // The storage service has no prefix delete; remove each object.
  for (const { name } of await storage().listFiles(prefix)) {
    await storage().deleteFile(name).catch((err: unknown) =>
      logger.warn('[NotionMigration] Could not delete staged object', { name, err: String(err) }));
  }
}
