/**
 * Backfill SDLC Hub search: syncs every SDLC hub (or the ones named) into Vespa, the same
 * sync a hub change triggers (src/sdlc/search/sdlcHubSync.ts). It queues Vespa jobs; the
 * Vespa workers of a running backend process them.
 *
 * Needs the SDLC schemas (vespa-core: sdlc_container, sdlc_repository and the sdlc fields on
 * file, ticket and chat_message) deployed first.
 *
 *   pnpm exec dotenv -e .env.local -- tsx scripts/sdlc-search-backfill.ts            # every hub
 *   pnpm exec dotenv -e .env.local -- tsx scripts/sdlc-search-backfill.ts <hubId>...  # some hubs
 *   ... --dry-run   lists the hubs and what each would index, without queueing anything
 */
import { ChannelType } from '@xyne/shared';
import { db } from '../src/database/client';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const named = args.filter(a => !a.startsWith('--'));

  const hubs = await db.channel.findMany({
    where: { type: ChannelType.SDLC, ...(named.length ? { id: { in: named } } : {}) },
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`${hubs.length} SDLC hub(s)${dryRun ? ' (dry run)' : ''}`);

  if (dryRun) {
    const { loadSdlcHubIndex } = await import('../src/sdlc/search/sdlcSearchIndex');
    for (const hub of hubs) {
      const index = await loadSdlcHubIndex(hub.id);
      console.log(`  ${hub.name} (${hub.id}):`, index
        ? `${index.containers.size} containers, ${index.repoIds.length} repositories, ${index.canvases.size} documents, ` +
          `${index.attachments.size} uploads, ${index.tickets.size} tickets, ${index.conversations.size} conversations`
        : 'not indexable');
    }
    return;
  }

  const { vespaQueue } = await import('../src/queues/vespaQueue');
  const { syncSdlcHub } = await import('../src/sdlc/search/sdlcHubSync');
  await vespaQueue.initialize();
  try {
    for (const hub of hubs) {
      const result = await syncSdlcHub(hub.id);
      console.log(`  ${hub.name} (${hub.id}):`, result ?? 'not indexable');
    }
  } finally {
    await vespaQueue.close();
  }
  console.log('Queued. The backend\'s Vespa workers index them in the next few seconds.');
}

main()
  .catch(error => {
    console.error('SDLC search backfill failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
    process.exit(process.exitCode ?? 0);
  });
