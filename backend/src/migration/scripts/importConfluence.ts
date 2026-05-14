import fs from 'fs/promises';
import process from 'process';
import { ConfluenceImportService, type ConfluenceImportConfig } from '@/services/confluence/confluenceImportService';
import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';

interface CliConfig extends Omit<ConfluenceImportConfig, 'actorUserId'> {
  actorUserId?: string;
}

async function main(): Promise<void> {
  const configPath = getArgValue('--config') || process.argv[2];
  if (!configPath) {
    throw new Error('Usage: npm run confluence:import -- --config ./confluence-import.json');
  }

  const rawConfig = JSON.parse(await fs.readFile(configPath, 'utf8')) as CliConfig;
  const actorUserId = rawConfig.actorUserId || process.env.CONFLUENCE_IMPORT_ACTOR_USER_ID;
  if (!actorUserId) {
    throw new Error('actorUserId is required in config or CONFLUENCE_IMPORT_ACTOR_USER_ID');
  }

  await DatabaseClient.connect();

  const service = new ConfluenceImportService();
  const summary = await service.importSpace({
    ...rawConfig,
    actorUserId,
  });

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

function getArgValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

main()
  .catch(error => {
    logger.error('[ConfluenceImportScript] Import failed', error);
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await DatabaseClient.disconnect();
  });
