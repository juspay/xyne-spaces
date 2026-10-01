import type { Redis } from 'ioredis';
import { createRedisClient } from '@/services/redisFactory';
import { logger } from '@/utils/logger';

// Publish run changes onto the SDK event bus's own Redis channel, so the SDK's
// `GET /events?root=1` route — which subscribes via `rootTopic(id)` on the shared
// `RedisEventBus` — receives them. The bus names channels `workflows:events:<topic>`;
// for the root topic that is `workflows:events:root:<id>`, which this prefix must
// match exactly. The SDK's "root scope" is this host's workspace, so the id passed
// here is the workspaceId.
//
// Why publish here rather than through the exported `eventBus`: the Prisma
// persistence adapter is imported BY `runtime.ts` (which constructs `eventBus`),
// so importing `eventBus` back into the adapter would be a cycle. A standalone
// publisher writing the same channel + payload shape keeps the write path acyclic
// while still landing on the bus the route listens to. Cross-process by design:
// the worker writes status in one process, Redis carries it to the API process
// serving the SSE stream.
const CHANNEL_PREFIX = 'workflows:events:root:';

const channelFor = (workspaceId: string): string => `${CHANNEL_PREFIX}${workspaceId}`;

/** One run change, carrying enough for an unscoped list to render or patch a row without a refetch. */
export interface WorkspaceRunChange {
  executionId: string;
  workflowId: string;
  status: string;
  /** Present on creation (a new row); omitted on a status-only update. */
  workflowName?: string;
  /** Epoch ms; present on creation. */
  createdAt?: number;
}

let publisher: Redis | undefined;

const getPublisher = (): Redis => {
  publisher ??= createRedisClient('workflows-runs-pub');
  return publisher;
};

/**
 * Publish a run change to its workspace's bus channel, in the SDK `RunChangeEvent`
 * envelope. Fire-and-forget; a bus hiccup degrades live updates but never throws
 * into the run that was merely reporting on itself.
 */
export function publishRun(workspaceId: string, change: WorkspaceRunChange): void {
  const event = {
    event: 'run_changed' as const,
    data: {
      workflowId: change.workflowId,
      executionId: change.executionId,
      status: change.status,
      at: new Date().toISOString(),
      ...(change.workflowName !== undefined ? { workflowName: change.workflowName } : {}),
      ...(change.createdAt !== undefined ? { createdAt: change.createdAt } : {}),
    },
  };
  void getPublisher()
    .publish(channelFor(workspaceId), JSON.stringify(event))
    .catch((err: unknown) => {
      logger.warn(`[workflows] workspace run publish failed for ${workspaceId}`, {
        message: err instanceof Error ? err.message : String(err),
      });
    });
}
