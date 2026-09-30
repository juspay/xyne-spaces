
import type { Redis } from 'ioredis';
import { createRedisClient } from '@/services/redisFactory';
import { logger } from '@/utils/logger';

const CHANNEL_PREFIX = 'workflows:runs:workspace:';

const channelFor = (workspaceId: string): string => `${CHANNEL_PREFIX}${workspaceId}`;

/** One run change, carrying enough to render or patch a row without a refetch. */
export interface WorkspaceRunEvent {
  executionId: string;
  workflowId: string;
  status: string;
  /** Present on creation (a new row); omitted on a status-only update. */
  workflowName?: string;
  /** Epoch ms; present on creation. */
  createdAt?: number;
}

export type RunListener = (event: WorkspaceRunEvent) => void;

let publisher: Redis | undefined;
let subscriber: Redis | undefined;
const listeners = new Map<string, Set<RunListener>>();

const getPublisher = (): Redis => {
  publisher ??= createRedisClient('workflows-runs-pub');
  return publisher;
};

const getSubscriber = (): Redis => {
  if (!subscriber) {
    subscriber = createRedisClient('workflows-runs-sub');
    subscriber.on('message', (channel: string, payload: string) => {
      if (!channel.startsWith(CHANNEL_PREFIX)) return;
      const set = listeners.get(channel);
      if (!set || set.size === 0) return;
      let event: WorkspaceRunEvent;
      try {
        event = JSON.parse(payload) as WorkspaceRunEvent;
      } catch {
        return;
      }
      for (const listener of [...set]) listener(event);
    });
  }
  return subscriber;
};

/** Publish a run change to its workspace channel. Fire-and-forget; never throws into a run. */
export function publishRun(workspaceId: string, event: WorkspaceRunEvent): void {
  void getPublisher()
    .publish(channelFor(workspaceId), JSON.stringify(event))
    .catch((err: unknown) => {
      logger.warn(`[workflows] workspace run publish failed for ${workspaceId}`, {
        message: err instanceof Error ? err.message : String(err),
      });
    });
}

/** Subscribe to a workspace's run changes. Returns an unsubscribe that cleans up the Redis channel when the last listener leaves. */
export async function subscribeRuns(workspaceId: string, listener: RunListener): Promise<() => void> {
  const channel = channelFor(workspaceId);
  let set = listeners.get(channel);
  if (!set) {
    set = new Set();
    listeners.set(channel, set);
    await getSubscriber().subscribe(channel);
  }
  const own = set;
  own.add(listener);

  return () => {
    if (listeners.get(channel) !== own) return;
    own.delete(listener);
    if (own.size > 0) return;
    listeners.delete(channel);
    void getSubscriber().unsubscribe(channel).catch((err: unknown) => {
      logger.warn(`[workflows] workspace run unsubscribe failed for ${workspaceId}`, {
        message: err instanceof Error ? err.message : String(err),
      });
    });
  };
}
