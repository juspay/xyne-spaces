import { transaction } from '../base';
import { db } from '@/database/client';
import { rebuildSurfaceNudgeAudienceCounts } from '@/nudges/services/surfaceNudgeAudienceCountService';


export function rebuildSurfaceNudgeAudienceCountsWithDbTx(sourceId: string, sourceType: string) {
  return transaction(['Call', 'Canvas', 'Channel', 'Conversation', 'Message', 'SurfaceNudge', 'SurfaceNudgeCount', 'Ticket'], 'rebuildSurfaceNudgeAudienceCountsWithDb: surface-nudge audience count rebuild across source, nudge, and count rows must commit atomically; tx is not ACL-wrapped', db, async tx => {
    await rebuildSurfaceNudgeAudienceCounts({
      tx,
      sourceId,
      sourceType,
    });
  });
}
