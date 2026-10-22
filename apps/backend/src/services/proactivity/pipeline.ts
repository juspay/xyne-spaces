import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import { ChannelScopeType, ChannelType, MessageType, UserType } from '@xyne/shared';
import { db } from '@/database/client';
import { runWithContext } from '@/database/tenant/context';
import { logger } from '@/utils/logger';
import { extractPlainTextFromHtml } from '@/utils/contentUtils';
import { acquireLock, releaseLock } from '@/utils/distributedLock';
import { redisService } from '@/services/redisService';
import { askDecision } from '@/services/decision/ask';
import {
  classifierTarget,
  configuredEngine,
  isPrivateDecisionEngineConfigured,
} from '@/services/decision/targets';
import { typingService } from '@/services/typingService';
import { channelsDeskChannelSourceName } from '@/channelsDesk/desk';
import { getProactivityDecisionsTotal, getProactivityStepDuration } from '@/services/otel';
import { proactiveEpisodeQueue } from '@/queues/proactiveEpisodeQueue';
import { loadProactivityConfig, type ProactivityConfig } from './config';
import { ProactivityPolicy } from './policy';
import { addToEpisode, finishRunning, takeIfDue } from './episodes';
import { buildSnapshot, threadMessages } from './snapshot';
import {
  agentBySlug,
  agentByUserId,
  agentUserIds,
  includesAgent,
  proactiveAgentsIn,
  routingTextOf,
} from './agents';
import { requestDraft, type DraftRequest, type DraftResult } from './dispatch';
import { postAnswer, reactAgreement } from './delivery';
import { saveXorCalls, XorRecorder, type XorCall, type XorStep } from './trace';
import {
  isProactivityMode,
  type AgentCard,
  type DraftContent,
  type DraftContext,
  type Episode,
  type Exchange,
  type NewMessage,
  type ProactivityMode,
  type Room,
  type Snapshot,
} from './types';

/**
 * Carries out what the policy decides: from a new message to an answer in the thread,
 * a 👍, or nothing. A question the gate finds open lands in agent_proactivity_decisions as ids,
 * the outcome, the reason and the probability behind it, never message or draft text.
 * A draft's own state travels with it through claw-auth; the thread is what agents
 * drafting for the same question coordinate on. Nothing here decides; that is all in
 * ProactivityPolicy.
 */

/** Better results win when several agents draft: one that posts beats a 👍 beats a hold. */
const RANK: Record<string, number> = { held: 1, shadow: 2, reacted: 3, posted: 4 };

function count(step: string, outcome: string): void {
  try {
    getProactivityDecisionsTotal().add(1, { step, outcome });
  } catch {
    // Metrics never fail a decision.
  }
}

async function timed<T>(step: string, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    return await fn();
  } finally {
    const ms = Date.now() - started;
    try {
      getProactivityStepDuration().record(ms, { step, outcome: 'done' });
    } catch {
      // Metrics never fail a decision.
    }
  }
}

/**
 * Only our XOR sees channel messages: DECISION_ENGINE must be xor, pointed at a
 * /v1/decisions endpoint (XOR_URL, or JEV_URL where XOR still lives), which only our
 * LiteLLM grid serves.
 */
function xorIsOurs(): boolean {
  if (configuredEngine() !== 'xor' || !isPrivateDecisionEngineConfigured()) return false;
  try {
    return new URL(classifierTarget('xor').url).pathname
      .replace(/\/$/, '')
      .endsWith('/v1/decisions');
  } catch {
    return false;
  }
}

/** With a recorder, every XOR request it makes is kept for tracing. */
const policyFor = (config: ProactivityConfig, recorder?: XorRecorder) =>
  new ProactivityPolicy(
    config,
    recorder?.client ??
      ((state, questions, timeoutMs) =>
        askDecision('agent_proactivity', state, questions, timeoutMs))
  );

/** An overall XOR budget per workspace, so a flood ends in quiet rather than a backlog. */
async function withinBudget(workspaceId: string, config: ProactivityConfig): Promise<boolean> {
  const key = `proactivity:budget:${workspaceId}:${Math.floor(Date.now() / 60_000)}`;
  try {
    const [[, used]] = (await redisService
      .getClient()
      .multi()
      .incr(key)
      .expire(key, 120)
      .exec()) as [[unknown, number], unknown];
    return used <= config.limits.episodesPerMinute;
  } catch {
    return true;
  }
}

/**
 * Drafts an agent has out at once, as a sorted set of draft ids by start time; the next
 * one isn't asked while it is full. Ids older than the draft timeout are dropped before
 * counting, so a draft whose callback and timeout were both lost frees its slot anyway.
 */
const slotsKey = (workspaceId: string, agentSlug: string) =>
  `proactivity:inflight:${workspaceId}:${agentSlug}`;

async function takeDraftSlot(
  workspaceId: string,
  agentSlug: string,
  draftId: string,
  config: ProactivityConfig
): Promise<boolean> {
  const key = slotsKey(workspaceId, agentSlug);
  const now = Date.now();
  try {
    const client = redisService.getClient();
    const [, , [, inFlight]] = (await client
      .multi()
      .zremrangebyscore(key, '-inf', now - config.limits.draftTimeoutSeconds * 1000)
      .zadd(key, now, draftId)
      .zcard(key)
      .expire(key, config.limits.draftTimeoutSeconds * 2)
      .exec()) as [unknown, unknown, [unknown, number], unknown];
    if (inFlight > config.limits.draftsInFlightPerAgent) {
      await client.zrem(key, draftId);
      return false;
    }
    return true;
  } catch {
    return true;
  }
}

async function releaseDraftSlot(
  workspaceId: string,
  agentSlug: string,
  draftId: string
): Promise<void> {
  try {
    await redisService.getClient().zrem(slotsKey(workspaceId, agentSlug), draftId);
  } catch {
    // Ages out on its own.
  }
}

const draftIdOf = (episodeId: string, attempt: number) => `${episodeId}:${attempt}`;

async function isCustomerFacing(channelId: string, type: string): Promise<boolean> {
  if (type !== ChannelType.DEFAULT) return true;
  const [source, shared] = await Promise.all([
    db.externalSource.findFirst({
      where: {
        isActive: true,
        OR: [{ channelId }, { name: channelsDeskChannelSourceName(channelId) }],
      },
      select: { id: true },
    }),
    db.connectGroup.findFirst({
      where: {
        entityType: 'channel',
        entityId: channelId,
        invitedWorkspaceId: { not: null },
        status: 'ACTIVE',
      },
      select: { id: true },
    }),
  ]);
  return Boolean(source || shared);
}

const mentionedUserIds = (html: string): string[] =>
  [...html.matchAll(/<span\b[^>]*\bdata-user-id=["']([^"']+)["']/g)].map((m) => m[1]);

/** The agent's unprompted answer this thread holds, if any. */
async function exchangeIn(conversationId: string): Promise<Exchange | null> {
  const episode = await db.agentProactivityDecision.findFirst({
    where: { conversationId, outcome: 'posted', agentSlug: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, kind: true, parentEpisodeId: true, agentSlug: true },
  });
  if (!episode?.agentSlug) return null;
  // Follow-ups count against the question the agent first answered.
  const root =
    episode.kind === 'FOLLOW_UP' && episode.parentEpisodeId ? episode.parentEpisodeId : episode.id;
  const [agent, followUps] = await Promise.all([
    agentBySlug(episode.agentSlug),
    db.agentProactivityDecision.count({
      where: { parentEpisodeId: root, kind: 'FOLLOW_UP', outcome: 'posted' },
    }),
  ]);
  if (!agent?.spacesAppUserId) return null;
  return {
    episodeId: root,
    agentSlug: episode.agentSlug,
    agentUserId: agent.spacesAppUserId,
    followUps,
  };
}

/**
 * The message hook. Fire-and-forget from the message side effect; never throws, so it
 * can't slow down or fail sending.
 */
export async function onMessage(messageId: string): Promise<void> {
  try {
    const message = await db.message.findUnique({
      where: { messageId },
      select: {
        messageId: true,
        conversationId: true,
        senderId: true,
        content: true,
        msgType: true,
        createdAt: true,
        isDeleted: true,
        visibleTo: true,
        workspaceId: true,
        sender: { select: { userType: true } },
        conversation: { select: { channelId: true, initialMessageId: true, createdBy: true } },
      },
    });
    if (!message || message.isDeleted || message.visibleTo || !message.conversation) return;
    const { channelId } = message.conversation;
    const isReply = message.conversation.initialMessageId !== message.messageId;
    const fromPerson =
      message.msgType === MessageType.USER &&
      message.sender?.userType !== UserType.APP &&
      message.sender?.userType !== UserType.AGENT &&
      message.sender?.userType !== UserType.BOT;

    await runWithContext(
      { userId: message.senderId, workspaceId: message.workspaceId },
      async () => {
        const config = await loadProactivityConfig(message.workspaceId);
        const policy = policyFor(config);
        const channel = await db.channel.findUnique({
          where: { id: channelId },
          select: { scopeType: true, type: true, agentProactivityMode: true },
        });
        if (!channel) return;

        const newMessage: NewMessage = {
          messageId: message.messageId,
          conversationId: message.conversationId,
          channelId,
          workspaceId: message.workspaceId,
          senderId: message.senderId,
          fromPerson,
          isReply,
          tagsAgent: false,
          mentionsPeople: false,
          text: extractPlainTextFromHtml(message.content),
          createdAt: message.createdAt.getTime(),
        };
        const room: Room = {
          channelId,
          mode: isProactivityMode(channel.agentProactivityMode)
            ? channel.agentProactivityMode
            : 'OFF',
          isDirect: channel.scopeType !== ChannelScopeType.DEFAULT,
          customerFacing: false,
          exchange: null,
          ownQuietThread: true,
        };

        // First with what the row already says, and the most permissive guess for the rest,
        // which can only narrow it (to an ignore, or an episode into a follow-up). So an
        // ignore here is final, and most messages stop without more queries.
        let watch = policy.watch(newMessage, room);
        if (watch.kind !== 'ignore') {
          const mentioned = mentionedUserIds(message.content);
          const [customerFacing, tagsAgent, exchange, ownQuietThread, mentionsPeople] =
            await Promise.all([
              isCustomerFacing(channelId, channel.type),
              includesAgent(mentioned),
              isReply ? exchangeIn(message.conversationId) : Promise.resolve(null),
              isReply && message.conversation.createdBy === message.senderId
                ? db.message
                    .count({
                      where: {
                        conversationId: message.conversationId,
                        senderId: { not: message.senderId },
                        isDeleted: false,
                        msgType: { not: MessageType.SYSTEM },
                      },
                    })
                    .then((others) => others === 0)
                : Promise.resolve(!isReply),
              mentioned.length > 0
                ? db.user
                    .count({ where: { id: { in: mentioned }, userType: UserType.USER } })
                    .then((people) => people > 0)
                : Promise.resolve(false),
            ]);
          newMessage.tagsAgent = tagsAgent;
          newMessage.mentionsPeople = mentionsPeople;
          Object.assign(room, {
            customerFacing,
            exchange,
            ownQuietThread,
          });
          watch = policy.watch(newMessage, room);
        }
        count('watch', watch.reason);
        if (watch.kind === 'episode') {
          const inConversation = isReply && !room.ownQuietThread;
          // Top-level messages group by sender, so a different question must not join.
          // Replies already wait per thread.
          await addToEpisode(
            newMessage,
            policy,
            inConversation,
            inConversation
              ? undefined
              : async (current) =>
                  policy.sameTopic(await textsOf(current.messageIds), newMessage.text)
          );
        }
        if (watch.kind === 'followUp' && room.exchange) {
          await runFollowUp(newMessage, room.exchange, room.mode, config, policy);
        }
      }
    );
  } catch (error) {
    logger.error('[Proactivity] message hook failed', { messageId, error });
  }
}

/** A waiting burst's messages as text, in order, for the same-topic check. */
async function textsOf(messageIds: string[]): Promise<string[]> {
  const rows = await db.message.findMany({
    where: { messageId: { in: messageIds }, isDeleted: false },
    select: { content: true },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((row) => extractPlainTextFromHtml(row.content)).filter(Boolean);
}

async function channelInfo(
  channelId: string
): Promise<{ name: string; mode: ProactivityMode } | null> {
  const channel = await db.channel.findUnique({
    where: { id: channelId },
    select: { name: true, agentProactivityMode: true },
  });
  if (!channel) return null;
  return {
    name: channel.name,
    mode: isProactivityMode(channel.agentProactivityMode) ? channel.agentProactivityMode : 'OFF',
  };
}

const othersTypingIn = async (episode: Episode): Promise<boolean> => {
  const rows = await db.message.findMany({
    where: { messageId: { in: episode.messageIds } },
    select: { conversationId: true },
  });
  const typing = await Promise.all(
    [...new Set(rows.map((r) => r.conversationId))].map((id) =>
      typingService.getTypingUsersInConversation(id)
    )
  );
  return typing.flat().some((user) => user.userId !== episode.senderId);
};

/** The episode worker's entry: a deadline job fired. */
export async function onDeadline(
  job: {
    channelId: string;
    senderId: string;
    scope?: string;
    episodeId: string;
  },
  /** No retry follows: a failure is recorded rather than thrown. */
  lastTry = true
): Promise<void> {
  const workspace = await db.channel.findUnique({
    where: { id: job.channelId },
    select: { workspaceId: true },
  });
  if (!workspace) return;
  const config = await loadProactivityConfig(workspace.workspaceId);
  const policy = policyFor(config);
  await runWithContext({ userId: job.senderId, workspaceId: workspace.workspaceId }, async () => {
    const episode = await takeIfDue(
      job.channelId,
      job.senderId,
      // Jobs queued before reply episodes existed carry no scope.
      job.scope ?? job.senderId,
      job.episodeId,
      policy,
      othersTypingIn
    );
    if (!episode) return;
    try {
      await runEpisode(episode, config, policy);
    } catch (error) {
      if (!lastTry) throw error;
      logger.error('[Proactivity] episode failed', { episodeId: episode.id, error });
      count('episode', 'failed');
      await recordFailed(episode);
    }
    await finishRunning(episode.id);
  });
}

/** A run that failed on its last try still gets a row, so it can be looked up. */
async function recordFailed(episode: Episode): Promise<void> {
  const channel = await channelInfo(episode.channelId);
  await db.agentProactivityDecision
    .upsert({
      where: { id: episode.id },
      create: {
        id: episode.id,
        workspaceId: episode.workspaceId,
        channelId: episode.channelId,
        senderId: episode.senderId,
        kind: episode.inConversation ? 'REPLY' : 'EPISODE',
        mode: channel?.mode ?? 'OFF',
        gate: 'quiet',
        messageIds: episode.messageIds,
        outcome: 'held',
        reason: 'failed',
      },
      update: {},
    })
    .catch((error: unknown) =>
      logger.error('[Proactivity] could not record a failed episode', { error })
    );
}

async function runEpisode(
  episode: Episode,
  config: ProactivityConfig,
  policy: ProactivityPolicy
): Promise<void> {
  const channel = await channelInfo(episode.channelId);
  if (!channel) return;
  // A retry after the decision was recorded: it got far enough, and must not ask twice.
  const recorded = await db.agentProactivityDecision.findUnique({
    where: { id: episode.id },
    select: { id: true },
  });
  if (recorded) return;
  // XOR requests are kept for tracing once the decision's row exists.
  const recorder = new XorRecorder();
  const xor = policyFor(config, recorder);
  const decision = {
    id: episode.id,
    workspaceId: episode.workspaceId,
    channelId: episode.channelId,
  };
  const traced: Array<[XorStep, XorCall[]]> = [];
  const record = async (data: {
    gate: 'open' | 'quiet' | 'bump';
    messageIds: string[];
    conversationId?: string;
    parentEpisodeId?: string;
    outcome?: string;
    reason?: string;
    score?: number;
  }) => {
    const row = await db.agentProactivityDecision.create({
      data: {
        id: episode.id,
        workspaceId: episode.workspaceId,
        channelId: episode.channelId,
        senderId: episode.senderId,
        // REPLY: a reply in a conversation, judged with the thread before it.
        kind: episode.inConversation ? 'REPLY' : 'EPISODE',
        mode: channel.mode,
        ...data,
      },
    });
    for (const [step, calls] of traced) await saveXorCalls(decision, step, calls);
    return row;
  };
  /** Kept quiet: recorded with why, so any message can be looked up. */
  const quiet = async (
    gate: 'quiet' | 'bump',
    reason: string,
    judged: { messageId: string; conversationId?: string }[],
    extra: { score?: number; parentEpisodeId?: string } = {}
  ) => {
    count('episode_quiet', reason);
    await record({
      gate,
      outcome: 'quiet',
      reason,
      messageIds: judged.map((m) => m.messageId),
      conversationId: judged[judged.length - 1]?.conversationId,
      ...extra,
    });
  };
  // Stopped before XOR for reasons that say nothing about the message: only counted.
  const skip = (reason: string) => count('episode_quiet', reason);

  if (!policy.runs(channel.mode)) return skip('disabled');
  if (!xorIsOurs()) return skip('xor_not_ours');
  if (!(await withinBudget(episode.workspaceId, config))) {
    // A real question may have been dropped here, so this one is recorded.
    return quiet(
      'quiet',
      'xor_budget',
      episode.messageIds.map((messageId) => ({ messageId }))
    );
  }

  let snapshot = await buildSnapshot({
    channelId: episode.channelId,
    channelName: channel.name,
    mode: channel.mode,
    askerId: episode.senderId,
    messageIds: episode.messageIds,
    context: config.context,
    inConversation: episode.inConversation,
  });
  if (snapshot.asked.length === 0) return skip('messages_gone');

  let gate = await timed('gate', () => xor.gate(snapshot));
  count('gate', gate.reason);
  traced.push(['gate', recorder.take()]);

  let bumped: { id: string; messageIds: string[] } | null = null;
  if (gate.outcome === 'bump') {
    // "anyone?": answer the question it repeats instead, if it is still open.
    bumped = await earlierUnansweredEpisode(episode, config);
    if (!bumped)
      return quiet('bump', 'bump_nothing_earlier', snapshot.asked, { score: gate.score });
    snapshot = await buildSnapshot({
      channelId: episode.channelId,
      channelName: channel.name,
      mode: channel.mode,
      askerId: episode.senderId,
      messageIds: bumped.messageIds,
      context: config.context,
    });
    gate = await timed('gate', () => xor.gate(snapshot));
    count('gate', `bump_${gate.reason}`);
    traced.push(['bump_gate', recorder.take()]);
  }
  if (gate.outcome !== 'open') {
    return quiet('quiet', gate.reason, snapshot.asked, {
      score: gate.score,
      parentEpisodeId: bumped?.id,
    });
  }

  const passed = snapshot.asked.filter((m) => gate.passed.includes(m.label));
  const conversationId = passed[passed.length - 1].conversationId;
  const row = await record({
    gate: 'open',
    // For a bump, the question it repeats: that is what was judged.
    messageIds: snapshot.asked.map((m) => m.messageId),
    conversationId,
    parentEpisodeId: bumped?.id,
  });
  const finish = (
    outcome: string,
    reason: string,
    data: Prisma.AgentProactivityDecisionUpdateInput = {}
  ) => {
    count('episode', outcome);
    return db.agentProactivityDecision.update({
      where: { id: row.id },
      data: { outcome, reason, ...data },
    });
  };

  const agents = await proactiveAgentsIn(episode.channelId);
  const route = await timed('route', () => xor.route(snapshot, agents));
  await saveXorCalls(decision, 'route', recorder.take());
  count('route', route.kind === 'none' ? route.reason : route.kind);

  if (route.kind === 'none')
    return void (await finish('quiet', route.reason, { score: route.score }));

  const peers = route.agents.map((a) => a.userId);
  let started = 0;
  for (const agent of route.agents) {
    const draft = await startDraft(row.id, episode.workspaceId, episode.channelId, conversationId, {
      agent,
      snapshot,
      answer: gate.passed,
      why: gate.reason,
      context: {
        answers: passed.map((m) => m.messageId),
        startedAt: Date.now(),
        redrafts: 0,
        waitedForTyping: false,
        peers,
      },
    });
    if (draft === 'busy') count('draft', 'agent_busy');
    if (draft === 'started') started += 1;
  }
  if (started === 0) return void (await finish('quiet', 'no_draft_started'));
}

/**
 * Ask an agent for a draft if it has a slot free, and arm its timeout. 'busy' when its
 * slots are full, 'refused' when claw-auth wouldn't start it.
 */
async function startDraft(
  episodeId: string,
  workspaceId: string,
  channelId: string,
  conversationId: string,
  request: Pick<
    DraftRequest,
    'agent' | 'snapshot' | 'answer' | 'why' | 'context' | 'onlyAdd' | 'shorter'
  >
): Promise<'started' | 'busy' | 'refused'> {
  const config = await loadProactivityConfig(workspaceId);
  const draftId = draftIdOf(episodeId, request.context.redrafts);
  if (!(await takeDraftSlot(workspaceId, request.agent.slug, draftId, config))) return 'busy';
  await redisService.set(
    askedKey(episodeId, request.agent.slug, request.context.redrafts),
    '1',
    2 * 3600
  );
  const started = await requestDraft({
    episodeId,
    workspaceId,
    channelId,
    conversationId,
    ...request,
  });
  count('draft', started ? 'requested' : 'refused');
  if (!started) {
    await releaseDraftSlot(workspaceId, request.agent.slug, draftId);
    return 'refused';
  }
  await proactiveEpisodeQueue.schedule(
    {
      type: 'draftTimeout',
      episodeId,
      agentSlug: request.agent.slug,
      attempt: request.context.redrafts,
    },
    Date.now() + config.limits.draftTimeoutSeconds * 1000
  );
  return 'started';
}

/** The asker's last episode in the channel in the lookback that asked something and got nothing. */
async function earlierUnansweredEpisode(episode: Episode, config: ProactivityConfig) {
  const since = new Date(Date.now() - config.bumpLookbackHours * 3600_000);
  const candidates = await db.agentProactivityDecision.findMany({
    where: {
      channelId: episode.channelId,
      senderId: episode.senderId,
      kind: 'EPISODE',
      createdAt: { gte: since },
      id: { not: episode.id },
      // The gate found it open, and it never got an answer.
      gate: 'open',
      outcome: { notIn: ['posted', 'reacted'] },
    },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { id: true, messageIds: true },
  });
  return candidates[0] ?? null;
}

/**
 * A draft is settled once: by its callback or by its timeout, whichever comes first.
 * Also drops a duplicate delivery of the same callback.
 */
const handledKey = (episodeId: string, agentSlug: string, attempt: number) =>
  `proactivity:handled:${episodeId}:${agentSlug}:${attempt}`;

const claimDraft = (episodeId: string, agentSlug: string, attempt: number) =>
  redisService.set(handledKey(episodeId, agentSlug, attempt), '1', 2 * 3600, true);

/** Which agent was asked to draft for which episode: a callback for any other is refused. */
const askedKey = (episodeId: string, agentSlug: string, attempt: number) =>
  `proactivity:asked:${episodeId}:${agentSlug}:${attempt}`;

const episodeOf = (episodeId: string) =>
  db.agentProactivityDecision.findUnique({
    where: { id: episodeId },
    select: {
      id: true,
      workspaceId: true,
      channelId: true,
      senderId: true,
      kind: true,
      conversationId: true,
      outcome: true,
    },
  });

type EpisodeRow = NonNullable<Awaited<ReturnType<typeof episodeOf>>>;

/** Record one draft's result, unless another agent's draft already did better. Under the episode lock. */
async function settle(
  episodeId: string,
  result: {
    outcome: keyof typeof RANK;
    reason: string;
    score?: number;
    agentSlug?: string;
    conversationId?: string;
  }
): Promise<void> {
  const current = await db.agentProactivityDecision.findUnique({
    where: { id: episodeId },
    select: { outcome: true },
  });
  if (current?.outcome && (RANK[current.outcome] ?? 0) >= RANK[result.outcome]) return;
  count('episode', result.outcome);
  await db.agentProactivityDecision.update({
    where: { id: episodeId },
    data: {
      outcome: result.outcome,
      reason: result.reason,
      score: result.score ?? null,
      ...(result.agentSlug ? { agentSlug: result.agentSlug } : {}),
      ...(result.conversationId ? { conversationId: result.conversationId } : {}),
    },
  });
}

async function withEpisodeLock<T>(episodeId: string, fn: () => Promise<T>): Promise<T | null> {
  const lock = await acquireLock(`proactivity:episode-run:${episodeId}`, {
    ttlSeconds: 120,
    waitTimeoutMs: 30_000,
  });
  if (!lock) return null;
  try {
    return await fn();
  } finally {
    await releaseLock(lock);
  }
}

/** Run `fn` as the asker, under the episode lock. */
async function onEpisode(
  episodeId: string,
  fn: (episode: EpisodeRow) => Promise<void>
): Promise<void> {
  const episode = await episodeOf(episodeId);
  if (!episode) return;
  await runWithContext({ userId: episode.senderId, workspaceId: episode.workspaceId }, () =>
    withEpisodeLock(episodeId, () => fn(episode))
  );
}

/** The draft callback from claw-auth. */
export async function onDraft(
  episodeId: string,
  agentSlug: string,
  result: DraftResult,
  context: DraftContext | null
): Promise<void> {
  if (!context) {
    logger.warn('[Proactivity] draft without its context', { episodeId, agentSlug });
    return;
  }
  if (!(await redisService.exists(askedKey(episodeId, agentSlug, context.redrafts)))) {
    logger.warn('[Proactivity] draft from an agent not asked for one', { episodeId, agentSlug });
    count('draft', 'not_asked');
    return;
  }
  // Late (timed out) or a duplicate delivery.
  if (!(await claimDraft(episodeId, agentSlug, context.redrafts))) return;
  try {
    await onEpisode(episodeId, async (episode) => {
      if (result.status === 'failed') {
        count('draft', 'failed');
        return settle(episodeId, { outcome: 'held', reason: 'draft_failed' });
      }
      count('draft', 'returned');
      await check(
        episode,
        agentSlug,
        {
          text: (result.result ?? '').trim(),
          toolsUsed: result.toolsUsed ?? [],
        },
        context
      );
    });
  } catch (error) {
    // Handed back, so the job's retry checks this draft again instead of skipping it.
    await redisService.del(handledKey(episodeId, agentSlug, context.redrafts));
    throw error;
  }
  const episode = await episodeOf(episodeId);
  if (episode) {
    await releaseDraftSlot(episode.workspaceId, agentSlug, draftIdOf(episodeId, context.redrafts));
  }
}

/** A draft waiting for someone to finish typing: check it again. */
export function onRecheck(
  episodeId: string,
  agentSlug: string,
  content: DraftContent,
  context: DraftContext
): Promise<void> {
  return onEpisode(episodeId, (episode) => check(episode, agentSlug, content, context));
}

/** An agent's draft still out after the limit is dropped. */
export async function onDraftTimeout(
  episodeId: string,
  agentSlug: string,
  attempt: number
): Promise<void> {
  const episode = await episodeOf(episodeId);
  if (episode)
    await releaseDraftSlot(episode.workspaceId, agentSlug, draftIdOf(episodeId, attempt));
  // Already handled: unless that run died before settling, the episode has an outcome
  // and settle leaves it be.
  const reason = (await claimDraft(episodeId, agentSlug, attempt)) ? 'draft_timeout' : 'draft_lost';
  count('draft', reason);
  await onEpisode(episodeId, () => settle(episodeId, { outcome: 'held', reason }));
}

/** The check before posting for one draft, and carrying out what it decides. Under the episode lock. */
async function check(
  episode: EpisodeRow,
  agentSlug: string,
  content: DraftContent,
  context: DraftContext
): Promise<void> {
  if (!episode.conversationId) return;
  const config = await loadProactivityConfig(episode.workspaceId);
  const recorder = new XorRecorder();
  const policy = policyFor(config, recorder);
  const channel = await channelInfo(episode.channelId);

  // The kill switch, checked again right before anything posts.
  if (!channel || !policy.runs(channel.mode)) {
    return settle(episode.id, { outcome: 'held', reason: 'turned_off', agentSlug });
  }
  // Who posts is the agent's own bot, never anything the draft carried back.
  const agentRow = await agentBySlug(agentSlug);
  const agentUserId = agentRow?.spacesAppUserId;
  if (!agentRow || !agentUserId) {
    return settle(episode.id, { outcome: 'held', reason: 'unknown_agent', agentSlug });
  }

  // A newer message from the asker in the same threads adds to the question: "for staging
  // I mean". A new top-level one is a new question, with its own episode.
  const threads = await db.message.findMany({
    where: { messageId: { in: context.answers } },
    select: { conversationId: true },
  });
  const newer = await db.message.findMany({
    where: {
      senderId: episode.senderId,
      conversationId: { in: [...new Set(threads.map((t) => t.conversationId))] },
      createdAt: { gt: new Date(context.startedAt) },
      isDeleted: false,
      visibleTo: null,
      msgType: MessageType.USER,
    },
    select: { messageId: true },
    orderBy: { createdAt: 'asc' },
    take: 5,
  });
  const askedIds = [...new Set([...context.answers, ...newer.map((m) => m.messageId)])];
  const latest = await buildSnapshot({
    channelId: episode.channelId,
    channelName: channel.name,
    mode: channel.mode,
    askerId: episode.senderId,
    messageIds: askedIds,
    context: config.context,
    draftingAgentUserIds: context.peers,
    inConversation: episode.kind === 'REPLY',
  });

  const send = await timed('before_posting', () =>
    policy.beforePosting(
      {
        agentSlug,
        ...content,
        answers: context.answers,
        redrafts: context.redrafts,
        waitedForTyping: context.waitedForTyping,
        followUp: episode.kind === 'FOLLOW_UP',
      },
      latest
    )
  );
  count('before_posting', send.reason);
  await saveXorCalls(episode, 'before_posting', recorder.take(), agentSlug);
  const decided = { reason: send.reason, score: send.score, agentSlug };
  const shows = policy.shows(channel.mode);

  switch (send.action) {
    case 'wait':
      await proactiveEpisodeQueue.schedule(
        {
          type: 'recheck',
          episodeId: episode.id,
          agentSlug,
          content,
          context: { ...context, waitedForTyping: true },
        },
        send.until
      );
      return;
    case 'redraft': {
      const agent: AgentCard = {
        slug: agentSlug,
        userId: agentUserId,
        name: agentRow.name,
        description: routingTextOf(agentRow) || agentRow.description,
      };
      const ok =
        (await startDraft(
          episode.id,
          episode.workspaceId,
          episode.channelId,
          latest.asked[latest.asked.length - 1]?.conversationId ?? episode.conversationId,
          {
            agent,
            snapshot: latest,
            answer: latest.asked.map((m) => m.label),
            why: send.reason,
            onlyAdd: send.reason === 'adds_to_answer',
            shorter: send.reason === 'too_long',
            context: {
              ...context,
              answers: latest.asked.map((m) => m.messageId),
              startedAt: Date.now(),
              redrafts: context.redrafts + 1,
            },
          }
        )) === 'started';
      if (!ok) return settle(episode.id, { outcome: 'held', reason: 'redraft_failed', agentSlug });
      return;
    }
    case 'hold':
      return settle(episode.id, { outcome: 'held', ...decided });
    case 'react': {
      if (!shows) return settle(episode.id, { outcome: 'shadow', ...decided });
      if (!(await claimDelivery(episode.id, agentSlug))) return;
      // Written as the agent's bot: the reaction and the message are its own.
      await runWithContext({ userId: agentUserId, workspaceId: episode.workspaceId }, () =>
        reactAgreement(agentUserId, send.messageId)
      );
      return settle(episode.id, { outcome: 'reacted', ...decided });
    }
    case 'post': {
      if (!shows) return settle(episode.id, { outcome: 'shadow', ...decided });
      if (!(await claimDelivery(episode.id, agentSlug))) return;
      const asked = latest.asked;
      const conversationId = asked[asked.length - 1]?.conversationId ?? episode.conversationId;
      const agents = await agentUserIds();
      // Written as the agent's bot: the message is its own.
      await runWithContext({ userId: agentUserId, workspaceId: episode.workspaceId }, () =>
        postAnswer({
          channelId: episode.channelId,
          conversationId,
          agentUserId,
          text: content.text,
          agentUserIds: agents,
        })
      );
      return settle(episode.id, { outcome: 'posted', ...decided, conversationId });
    }
  }
}

/** At most one post per agent per episode, across retries and pods; outlives any draft. */
const claimDelivery = (episodeId: string, agentSlug: string) =>
  redisService.set(`proactivity:delivered:${episodeId}:${agentSlug}`, '1', 2 * 3600, true);

/** A reply in a thread an agent answered: judged straight away, no wait. */
async function runFollowUp(
  message: NewMessage,
  exchange: Exchange,
  mode: ProactivityMode,
  config: ProactivityConfig,
  policy: ProactivityPolicy
): Promise<void> {
  // Stopped before XOR for reasons that say nothing about the reply: only counted.
  const skip = (reason: string) => count('follow_up', reason);
  if (!xorIsOurs()) return skip('xor_not_ours');
  if (!policy.runs(mode)) return skip('not_answering_here');

  const thread = await threadMessages(message.conversationId);
  const reply = thread.find((m) => m.messageId === message.messageId);
  if (!reply) return skip('messages_gone');
  const recorder = new XorRecorder();
  const decision = await timed('follow_up', () =>
    policyFor(config, recorder).followUp(reply, thread, exchange)
  );

  const row = await db.agentProactivityDecision.create({
    data: {
      id: randomUUID(),
      workspaceId: message.workspaceId,
      channelId: message.channelId,
      senderId: message.senderId,
      kind: 'FOLLOW_UP',
      mode,
      gate: decision.answer ? 'open' : 'quiet',
      messageIds: [message.messageId],
      conversationId: message.conversationId,
      parentEpisodeId: exchange.episodeId,
      ...(decision.answer
        ? {}
        : { outcome: 'quiet', reason: decision.reason, score: decision.score }),
    },
  });
  await saveXorCalls(row, 'follow_up', recorder.take());
  if (!decision.answer) return skip(decision.reason);
  const finish = (outcome: string, reason: string) => {
    count('follow_up', reason);
    return db.agentProactivityDecision.update({ where: { id: row.id }, data: { outcome, reason } });
  };

  const agent = await agentByUserId(exchange.agentUserId);
  const channel = await channelInfo(message.channelId);
  if (!agent || !channel) return void (await finish('quiet', 'agent_gone'));
  const card: AgentCard = {
    slug: agent.slug,
    userId: exchange.agentUserId,
    name: agent.name,
    description: routingTextOf(agent) || agent.description,
  };
  const snapshot: Snapshot = {
    channelName: channel.name,
    mode,
    askerId: message.senderId,
    askerName: reply.senderName,
    asked: [{ ...reply, label: 'm1' }],
    // The follow-up is judged on its own; the thread rides in `after` for the draft.
    before: [],
    after: thread.filter((m) => m.messageId !== reply.messageId),
    othersTyping: false,
    // The follow-up is to this agent's own answer.
    agentEngaged: false,
    now: Date.now(),
  };
  const draft = await startDraft(
    row.id,
    message.workspaceId,
    message.channelId,
    message.conversationId,
    {
      agent: card,
      snapshot,
      answer: ['m1'],
      why: decision.reason,
      context: {
        answers: [message.messageId],
        startedAt: Date.now(),
        // A follow-up is answered as asked; it doesn't wait for more.
        redrafts: 1,
        waitedForTyping: false,
        peers: [card.userId],
      },
    }
  );
  if (draft === 'busy') return void (await finish('quiet', 'agent_busy'));
  if (draft !== 'started') return void (await finish('quiet', 'no_draft_started'));
}
