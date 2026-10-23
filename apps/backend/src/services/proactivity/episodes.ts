import { randomUUID } from 'crypto';
import { redisService } from '@/services/redisService';
import { acquireLock, releaseLock } from '@/utils/distributedLock';
import { proactiveEpisodeQueue } from '@/queues/proactiveEpisodeQueue';
import { getProactivityDecisionsTotal } from '@/services/otel/proactivityMetrics';
import { logger } from '@/utils/logger';
import type { ProactivityPolicy } from './policy';
import type { Episode, NewMessage } from './types';

/**
 * The episode a person is in the middle of, one per channel and sender: in Spaces every
 * top-level message is its own thread, so a burst of three lines is three threads that
 * still belong together. A reply in a conversation is the exception, one per thread:
 * it waits on that thread alone. Episodes live in Redis only while they wait; once the
 * wait is over they are taken out and the decisions go to agent_proactivity_decisions.
 */
const key = (channelId: string, scope: string) => `proactivity:episode:${channelId}:${scope}`;
/** An episode taken out to run, until its decision is recorded: a retried job finds it here. */
const runningKey = (episodeId: string) => `proactivity:episode-running:${episodeId}`;
const lockKey = (channelId: string, scope: string) =>
  `proactivity:episode-lock:${channelId}:${scope}`;

export const episodeScope = (message: NewMessage, inConversation: boolean): string =>
  inConversation ? `${message.senderId}:${message.conversationId}` : message.senderId;

/** Outlives any wait the config allows, so an episode whose job was lost still expires. */
const TTL_SECONDS = 60 * 60;

/**
 * Only quick Redis reads and writes run under the lock, never an XOR call, so it is
 * held for milliseconds and 15s is far beyond any holder.
 */
async function withLock<T>(
  channelId: string,
  scope: string,
  fn: () => Promise<T>
): Promise<T | null> {
  const lock = await acquireLock(lockKey(channelId, scope), {
    ttlSeconds: 15,
    waitTimeoutMs: 5000,
  });
  if (!lock) {
    logger.warn('[Proactivity] episode lock timed out', { channelId, scope });
    countLock('timeout');
    return null;
  }
  try {
    return await fn();
  } finally {
    await releaseLock(lock);
  }
}

/** A message that could not join its burst: logged and counted, never silent. */
function dropped(messageId: string): void {
  logger.warn('[Proactivity] message dropped from its burst', { messageId });
  countLock('dropped');
}

function countLock(outcome: string): void {
  try {
    getProactivityDecisionsTotal().add(1, { step: 'episode_lock', outcome });
  } catch {
    // Metrics never fail a decision.
  }
}

async function read(channelId: string, scope: string): Promise<Episode | null> {
  const raw = await redisService.get(key(channelId, scope));
  return raw ? (JSON.parse(raw) as Episode) : null;
}

const write = (episode: Episode) =>
  redisService.set(key(episode.channelId, episode.scope), JSON.stringify(episode), TTL_SECONDS);

/**
 * The episode with this message added, or a new one, with its deadline as the policy
 * sets it. Pure, so replay builds episodes exactly as the live store does.
 */
export function extendEpisode(
  current: Episode | null,
  message: NewMessage,
  policy: ProactivityPolicy,
  inConversation = false
): Episode {
  const episode: Episode = current
    ? {
        ...current,
        messageIds: [...current.messageIds, message.messageId],
        lastAt: message.createdAt,
        resets: current.resets + 1,
        mentionsPeople: current.mentionsPeople || message.mentionsPeople,
      }
    : {
        id: randomUUID(),
        workspaceId: message.workspaceId,
        channelId: message.channelId,
        senderId: message.senderId,
        messageIds: [message.messageId],
        firstAt: message.createdAt,
        lastAt: message.createdAt,
        resets: 0,
        deadline: 0,
        graceUsed: false,
        inConversation,
        scope: episodeScope(message, inConversation),
        mentionsPeople: message.mentionsPeople,
      };
  return { ...episode, deadline: policy.timer(episode).at };
}

/**
 * Start the sender's episode with this message, or add it to the one already waiting,
 * which restarts the timer. When `belongs` says the message is about something else,
 * the waiting one is set aside to run on its own and this message starts a new one.
 * Returns the episode as it now stands.
 *
 * `belongs` asks XOR, which takes seconds, so it runs outside the lock on the episode as
 * read; the write then happens only if that episode is still the one there, unchanged.
 * Otherwise a message landed meanwhile, and this one is tried again on the new state.
 */
export async function addToEpisode(
  message: NewMessage,
  policy: ProactivityPolicy,
  inConversation: boolean,
  belongs?: (current: Episode) => Promise<boolean>
): Promise<Episode | null> {
  const scope = episodeScope(message, inConversation);
  const unchanged = (a: Episode | null, b: Episode | null) =>
    a?.id === b?.id && a?.messageIds.length === b?.messageIds.length;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const seen = await read(message.channelId, scope);
    const fits = !seen || !belongs || (await belongs(seen));
    const result = await withLock(message.channelId, scope, async () => {
      let current = await read(message.channelId, scope);
      if (!unchanged(current, seen)) return 'changed' as const;
      if (current && !fits) {
        await setAside(current);
        current = null;
      }
      const episode = extendEpisode(current, message, policy, inConversation);
      await write(episode);
      // One job per episode: when it fires early it re-arms for the deadline as it then
      // stands, so a message that pushes the deadline back needs no job of its own.
      if (current) return episode;
      await proactiveEpisodeQueue.schedule(
        {
          type: 'deadline',
          channelId: episode.channelId,
          senderId: episode.senderId,
          scope,
          episodeId: episode.id,
        },
        episode.deadline
      );
      return episode;
    });
    if (result === 'changed') continue;
    if (!result) dropped(message.messageId);
    return result;
  }
  dropped(message.messageId);
  return null;
}

/**
 * Moves a waiting episode to a key of its own, with its own deadline job, so it runs as
 * it is while the sender's next message starts a new one. The job for its old key finds
 * a different episode there and stops.
 */
async function setAside(episode: Episode): Promise<void> {
  const moved = { ...episode, scope: `${episode.scope}:${episode.id}` };
  await write(moved);
  await proactiveEpisodeQueue.schedule(
    {
      type: 'deadline',
      channelId: moved.channelId,
      senderId: moved.senderId,
      scope: moved.scope,
      episodeId: moved.id,
    },
    moved.deadline
  );
}

/**
 * Called when a deadline job fires. Takes the episode out when its wait is really
 * over, so the sender's next message starts a new one; otherwise re-arms for the
 * deadline as it now stands. Null when there is nothing to run yet. A taken episode is
 * kept aside until finishRunning, so a retry of a failed run gets it again.
 */
export function takeIfDue(
  channelId: string,
  senderId: string,
  scope: string,
  episodeId: string,
  policy: ProactivityPolicy,
  othersTyping: (episode: Episode) => Promise<boolean>
): Promise<Episode | null> {
  return withLock(channelId, scope, async () => {
    const episode = await read(channelId, scope);
    if (!episode || episode.id !== episodeId) {
      // Taken already: still running only when an earlier try of this job failed.
      const running = await redisService.get(runningKey(episodeId));
      return running ? (JSON.parse(running) as Episode) : null;
    }

    let deadline = policy.timer(episode);
    if (deadline.at <= Date.now()) deadline = policy.timer(episode, await othersTyping(episode));
    if (deadline.at > Date.now()) {
      const next = {
        ...episode,
        deadline: deadline.at,
        graceUsed: episode.graceUsed || deadline.grace,
      };
      await write(next);
      await proactiveEpisodeQueue.schedule(
        { type: 'deadline', channelId, senderId, scope, episodeId },
        deadline.at
      );
      return null;
    }
    await redisService.set(runningKey(episodeId), JSON.stringify(episode), TTL_SECONDS);
    await redisService.del(key(channelId, scope));
    return episode;
  });
}

/** The episode's decision is recorded, or given up on: retries have nothing left to run. */
export const finishRunning = (episodeId: string) => redisService.del(runningKey(episodeId));
