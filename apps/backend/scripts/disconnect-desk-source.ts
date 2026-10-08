#!/usr/bin/env npx tsx

/**
 * Local testing only: disconnects a desk's connected account the same way the system does when
 * the provider rejects its token, so the "Account disconnected" notification can be checked.
 * Credentials are kept, so --restore brings the account back.
 *
 * Usage (from apps/backend):
 *   dotenv -e .env.local -- npx tsx scripts/disconnect-desk-source.ts <channelId>
 *   dotenv -e .env.local -- npx tsx scripts/disconnect-desk-source.ts <channelId> <sourceId>
 *   dotenv -e .env.local -- npx tsx scripts/disconnect-desk-source.ts <channelId> <sourceId> --restore
 */

// Registers the Automations bot, as the API and worker do at startup; the channel alert posts as it.
import '../src/bots/implementations/automations-bot/automations-bot';
import { db } from '../src/database/client';
import { disconnectDeskSourceBySystem } from '../src/integrations/core/deskSourceDisconnect';
import { redisService } from '../src/services/redisService';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const restore = args.includes('--restore');
  const [channelId, sourceId] = args.filter((arg) => !arg.startsWith('--'));

  if (!channelId) {
    console.error('Usage: npx tsx scripts/disconnect-desk-source.ts <channelId> [sourceId] [--restore]');
    process.exit(1);
  }

  const sources = await db.externalSource.findMany({
    where: {
      channelId,
      NOT: {
        OR: [
          { name: { startsWith: 'google-dl-sync--' } },
          { name: { startsWith: 'microsoft-dl-sync--' } },
        ],
      },
    },
    select: { id: true, sourceType: true, displayName: true, isActive: true },
    orderBy: { createdAt: 'asc' },
  });

  if (sources.length === 0) {
    console.error(`No connected accounts found for channel ${channelId}`);
    process.exit(1);
  }

  console.log(`Accounts on channel ${channelId}:`);
  console.table(sources);

  if (restore) {
    if (!sourceId) {
      console.error('Pass the sourceId to restore.');
      process.exit(1);
    }
    const { count } = await db.externalSource.updateMany({
      where: { id: sourceId, channelId },
      data: { isActive: true },
    });
    console.log(count ? `Restored ${sourceId} (isActive = true).` : `No source ${sourceId} on this channel.`);
    return;
  }

  const active = sources.filter((source) => source.isActive);
  const target = sourceId ? sources.find((source) => source.id === sourceId) : active[0];

  if (!target) {
    console.error(sourceId ? `No source ${sourceId} on this channel.` : 'No active account to disconnect.');
    process.exit(1);
  }
  if (!sourceId && active.length > 1) {
    console.error('More than one active account. Pass the sourceId of the one to disconnect.');
    process.exit(1);
  }

  await redisService.connect();
  const disconnected = await disconnectDeskSourceBySystem(target.id, { clearCredentials: false });

  console.log(
    disconnected
      ? `Disconnected ${target.displayName} (${target.sourceType}, ${target.id}) and notified the desk managers.`
      : `${target.id} was already disconnected, so no notification was sent.`,
  );
  console.log(`To undo: npx tsx scripts/disconnect-desk-source.ts ${channelId} ${target.id} --restore`);
}

main()
  .catch((error) => {
    console.error('Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
    process.exit();
  });
