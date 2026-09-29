/**
 * DEV ONLY — seed the Slack migration store (Redis) from a history export
 * (slack-migration-history-*.json) so the dashboard metrics show real numbers locally.
 *
 *   bun apps/backend/src/migration/self-serve/scripts/seedHistory.ts <path-to-export.json>
 *
 * The export is the public VIEW projection; this maps just the fields the metrics read
 * (status, type, stats, timestamps) plus names/channelInput for context. Never run against prod.
 */
import { readFileSync } from 'node:fs';
import { MigrationStore } from '../store';
import { MigrationStatus, MigrationType, QueueName, type MigrationJob } from '../types';

const DEV_WS = 'dev-workspace';

interface ViewJob {
  id: string;
  type: 'DM' | 'CHANNEL';
  status: string;
  submittedByUserId?: string;
  submittedByName?: string;
  stats?: { conversations: number; messages: number };
  channel?: { slackId?: string; xyneId?: string; slackName?: string; xyneName?: string; startDate?: string; announceInSlack?: boolean };
  createdAt?: number;
  updatedAt?: number;
  completedAt?: number;
  ingestStartedAt?: number;
  collectedAt?: number;
  issues?: MigrationJob['issues'];
}

function toJob(v: ViewJob): MigrationJob {
  const now = Date.now();
  const isChannel = v.type === 'CHANNEL';
  return {
    id: v.id,
    type: v.type as MigrationType,
    status: v.status as MigrationStatus,
    currentQueue: isChannel ? QueueName.INGESTION : QueueName.COLLECTION,
    workspaceId: DEV_WS,
    submittedByUserId: v.submittedByUserId ?? v.id,
    submittedByName: v.submittedByName,
    teamId: '',
    gcsPrefix: `slack-migration/${v.id}`,
    channelInput: isChannel && v.channel
      ? { slackChannelId: v.channel.slackId ?? v.id, xyneChannelId: v.channel.xyneId ?? '', startDate: v.channel.startDate, announceInSlack: v.channel.announceInSlack }
      : undefined,
    slackChannelName: v.channel?.slackName,
    xyneChannelName: v.channel?.xyneName,
    checkpoint: { totalConversations: v.stats?.conversations ?? 0, collectedConversationIds: [], ingestedConversationIds: [] },
    stats: { conversations: v.stats?.conversations ?? 0, messages: v.stats?.messages ?? 0 },
    stopRequested: false,
    heartbeatAt: v.updatedAt ?? now,
    createdAt: v.createdAt ?? now,
    updatedAt: v.updatedAt ?? now,
    completedAt: v.completedAt,
    ingestStartedAt: v.ingestStartedAt,
    collectedAt: v.collectedAt,
    refreshRequested: false,
    issues: v.issues,
  };
}

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: bun apps/backend/src/migration/self-serve/scripts/seedHistory.ts <export.json>');
    process.exit(1);
  }
  const view = JSON.parse(readFileSync(path, 'utf8')) as ViewJob[];
  const store = new MigrationStore();
  let ok = 0;
  for (const v of view) {
    try {
      await store.create(toJob(v));
      ok++;
    } catch (e) {
      console.warn('skip', v.id, e instanceof Error ? e.message : String(e));
    }
  }
  console.log(`seeded ${ok}/${view.length} jobs into the migration store (workspaceId=${DEV_WS})`);
  process.exit(0);
}

void main();
