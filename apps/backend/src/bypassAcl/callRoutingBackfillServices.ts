import { db } from '@/database/client';
import { WORKSPACE_LEVEL } from '@/integrations/core/sourceScope';
import { callConnectionService } from '@/services/telephony/callConnectionService';
import { CALL_PROVIDER_IDS } from '@/services/telephony/callProviderIds';
import { logger } from '@/utils/logger';
import { asService, asSystem } from './base';

const TAG = '[call-routing-backfill]';

/**
 * Moves routing saved on call connections before per-desk settings existed onto the desks, in every
 * workspace. `pending` is the connections still holding it; a dry run only lists them. Safe to repeat.
 */
export async function backfillLegacyCallRouting(dryRun: boolean): Promise<{
  dryRun: boolean;
  pending: number;
  moved: number;
  failed: number;
  connections: { connectionId: string; workspaceId: string; status: 'pending' | 'moved' | 'failed' }[];
}> {
  const sources = await asSystem(
    ['ExternalSource'],
    'call-routing backfill lists call connections across every workspace',
    () =>
      db.externalSource.findMany({
        where: { ...WORKSPACE_LEVEL, isActive: true, sourceType: { in: [...CALL_PROVIDER_IDS] } },
        orderBy: { createdAt: 'asc' },
      }),
  );
  const legacy = sources.filter(source => callConnectionService.hasLegacyRouting(source));

  const connections: { connectionId: string; workspaceId: string; status: 'pending' | 'moved' | 'failed' }[] = [];
  for (const source of legacy) {
    if (dryRun) {
      connections.push({ connectionId: source.id, workspaceId: source.workspaceId, status: 'pending' });
      continue;
    }
    try {
      await asService(
        ['ExternalSource', 'EmailChannelPreference', 'Channel'],
        "call-routing backfill moves one connection's routing onto its workspace's desks",
        'call-routing-backfill',
        source.workspaceId,
        async () => {
          // Re-read so an edit made since the listing isn't overwritten.
          const fresh = await db.externalSource.findUnique({ where: { id: source.id } });
          if (fresh) await callConnectionService.migrateLegacyRouting(fresh);
        },
      );
      connections.push({ connectionId: source.id, workspaceId: source.workspaceId, status: 'moved' });
    } catch (error) {
      connections.push({ connectionId: source.id, workspaceId: source.workspaceId, status: 'failed' });
      logger.error(`${TAG} failed`, {
        connectionId: source.id,
        workspaceId: source.workspaceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const moved = connections.filter(connection => connection.status === 'moved').length;
  const failed = connections.filter(connection => connection.status === 'failed').length;
  return { dryRun, pending: legacy.length - moved, moved, failed, connections };
}
