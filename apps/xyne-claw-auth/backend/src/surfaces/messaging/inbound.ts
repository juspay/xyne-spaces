/**
 * The inbound pipeline, identical for every channel:
 *   own echo? → drop · dedupe · rate-limit · policy (unlinked/ignore/dispatch)
 *   · agent routing (/slug, /agents) · identity → run owner · dispatch.
 * Plugins call this with a normalised InboundMessage; everything user-visible
 * that comes back goes through the outbox so only the owning pod sends.
 */
import { isAgentInvocableBy } from "xyne-claw-shared";
import { redisService } from "../../redis.js";
import { createLogger } from "../../logger.js";
import { errMsg } from "../../lib/errors.js";
import { redeemApproval } from "./approvals.js";
import { consumeOption, parseMenuChoice, tokenForMenuChoice } from "./cards.js";
import { DEDUP_TTL_S, NOT_LINKED_TEXT, REDIS_PREFIX, UNLINKED_NOTICE_TTL_S } from "./const.js";
import { enqueueOutbound } from "./delivery.js";
import { agentActionGatesOf } from "./agent-tools.js";
import { channelConversationId, dispatchChannelRun } from "./dispatch.js";
import { drainGroupContext, rememberGroupMessage, renderGroupContext } from "./group-context.js";
import { resolveIdentity } from "./identity.js";
import type { AnyChannelPlugin, ChannelAccount, ChannelDeliveryTarget, InboundMessage } from "./plugin.js";
import { evaluatePolicy } from "./policy.js";
import { formatAgentList, namesAnAgent, parseAgentRoute } from "./routing.js";
import { policyOf } from "./schema.js";
import { findDefaultAgent, findOrgAgentBySlug, listOrgAgents, type BoundAgent } from "./store.js";

const log = createLogger("channel-inbound");

export interface InboundContext {
  account: ChannelAccount;
  plugin: AnyChannelPlugin;
}

/** Best-effort: Redis down ⇒ treat as new (a duplicate run beats a lost one). */
async function isDuplicate(accountId: string, messageId: string): Promise<boolean> {
  try {
    const set = await redisService
      .getConnection()
      .set(`${REDIS_PREFIX}:seen:${accountId}:${messageId}`, "1", "EX", DEDUP_TTL_S, "NX");
    return set !== "OK";
  } catch {
    return false;
  }
}

/** A bare number against the newest numbered menu in this chat. */
async function menuToken(accountId: string, chatId: string, text: string): Promise<string | null> {
  const choice = parseMenuChoice(text);
  return choice === null ? null : tokenForMenuChoice(accountId, chatId, choice);
}

/** Tell one sender where to register at most once an hour, so a chatty
 *  stranger cannot make the number repeat itself. Redis down ⇒ tell them. */
async function shouldTellUnlinked(accountId: string, senderId: string): Promise<boolean> {
  try {
    const set = await redisService
      .getConnection()
      .set(`${REDIS_PREFIX}:unlinked-told:${accountId}:${senderId}`, "1", "EX", UNLINKED_NOTICE_TTL_S, "NX");
    return set === "OK";
  } catch {
    return true;
  }
}

/** Fixed 60s window per (account, sender). Redis down ⇒ allow. */
async function overRateLimit(accountId: string, senderId: string, limit: number): Promise<boolean> {
  try {
    const key = `${REDIS_PREFIX}:rl:${accountId}:${senderId}`;
    const redis = redisService.getConnection();
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 60);
    return count > limit;
  } catch {
    return false;
  }
}

export async function handleInbound(ctx: InboundContext, msg: InboundMessage): Promise<void> {
  const { account, plugin } = ctx;
  let text = msg.text.trim();
  // A tap can carry an empty title; the option id is the content.
  // A photo sent with no caption is not an empty message — it is the whole
  // message. Only genuinely contentless ones are dropped.
  if (msg.fromSelf || (!text && !msg.cardReplyId && !msg.attachments?.length)) return;
  if (await isDuplicate(account.id, msg.messageId)) return;

  const policy = policyOf(account.config);
  if (await overRateLimit(account.id, msg.senderId, policy.rateLimitPerMinute)) {
    log.warn(`[inbound] rate-limited sender=${msg.senderId} account=${account.id}`);
    return;
  }

  // Tapping a card we sent is an ANSWER, not a new request, so it resolves
  // before policy and routing: the token is single-use and bound to this chat
  // and this sender, which is a narrower gate than policy would apply. On a
  // channel with no native cards the same options were offered as a numbered
  // menu, so a bare "2" resolves the same way — but only there, so that a
  // stray "2" on WhatsApp can never stand in for a button that exists.
  const tappedToken =
    msg.cardReplyId ??
    (plugin.capabilities.interactive ? null : await menuToken(account.id, msg.chatId, text));
  if (tappedToken) {
    const option = await consumeOption(account.id, tappedToken);
    if (!option) {
      await enqueueOutbound(account.id, {
        kind: "text",
        chatId: msg.chatId,
        text: "That option has already been used or has expired — ask me again and I'll re-send it.",
      });
      return;
    }
    if (option.chatId !== msg.chatId || option.senderId !== msg.senderId) {
      log.error(
        `[inbound] card token replayed from the wrong place account=${account.id} sender=${msg.senderId} expected=${option.senderId}`,
      );
      return;
    }
    if (option.action.kind === "approve-write" || option.action.kind === "decline-write") {
      await redeemApproval({ account, option, senderId: msg.senderId, chatId: msg.chatId });
      return;
    }
    // Picker options carry no side effect of their own: they stand in for
    // something the person could have typed, so hand them to normal routing.
    text = option.action.kind === "agent" ? `/${option.action.slug}` : option.action.text;
  }

  const linkedUserId = await resolveIdentity({
    surfaceId: account.surfaceId,
    accountKey: account.accountKey,
    senderId: msg.senderId,
    orgId: account.orgId,
  });

  // Did they actually address the agent? A native @mention, a reply to one of
  // its messages, or opening with "/slug" — the last being the only one a
  // one-to-one chat offers.
  const namedInText = namesAnAgent(text);

  const decision = evaluatePolicy(policy, {
    isGroup: msg.isGroup && plugin.capabilities.groups,
    senderId: msg.senderId,
    chatId: msg.chatId,
    hasIdentity: linkedUserId !== null,
    mentionedSelf: msg.mentionedSelf,
    replyToSelf: msg.replyToSelf,
    namedInText,
    selfChat: msg.selfChat === true,
  });
  if (decision.action === "ignore") {
    // Nobody addressed us, but this is still a room we belong in — keep the
    // line so the next reply knows what was being discussed.
    if (decision.remember && text) {
      await rememberGroupMessage({
        accountId: account.id,
        chatId: msg.chatId,
        senderId: msg.senderId,
        ...(msg.senderName ? { senderName: msg.senderName } : {}),
        text,
        limit: policy.groupHistoryLimit,
      });
    }
    log.info(`[inbound] ignored account=${account.id} chat=${msg.chatId}: ${decision.reason}`);
    return;
  }
  if (decision.action === "unlinked") {
    // A shared business number exists to be messaged by people it does not know
    // yet, so telling them where to register is the whole job. A personal
    // number is the opposite: it is somebody's own WhatsApp, and auto-answering
    // every stranger would send messages from them that they did not write —
    // to salespeople, to delivery drivers, and to any other Claw account that
    // happens to reply to them, which two such numbers turn into a loop that
    // nothing else stops. So a user-scoped account stays silent.
    // Answering strangers is what the "direct messages from other people"
    // setting decides: reaching here at all means it is switched on. Say it
    // once an hour per sender rather than on every message.
    if (await shouldTellUnlinked(account.id, msg.senderId)) {
      await enqueueOutbound(account.id, { kind: "text", chatId: msg.chatId, text: NOT_LINKED_TEXT, quoted: msg.ref });
    }
    return;
  }

  // A run belongs to whoever sent the message — there is no account-wide
  // fallback user, so nobody ever executes with someone else's access.
  //
  // Self-chat is the one case with no identity row and it is not an
  // exception to that: a message marked fromMe on a user-scoped account can
  // only have come from a device its owner linked by scanning with their own
  // phone, which identifies them at least as well as a typed number does.
  const userId = linkedUserId ?? (msg.fromOwner ? (account.config.ownerUserId ?? null) : null);
  const reply = (body: string) => enqueueOutbound(account.id, { kind: "text", chatId: msg.chatId, text: body, quoted: msg.ref });
  if (!userId) {
    // Anyone may use the agent; they just have to say who they are first.
    // Told once an hour per sender, so a group does not fill up with it.
    if (!(await shouldTellUnlinked(account.id, msg.senderId))) return;
    await reply(NOT_LINKED_TEXT);
    return;
  }

  const route = parseAgentRoute(text);
  const bound = await findDefaultAgent(account, account.surfaceId);

  if (route.listAgents) {
    const agents = (await listOrgAgents(account.orgId))
      .filter((agent) => isAgentInvocableBy(agent.config as Record<string, unknown> | null, userId))
      .map((agent) => ({ slug: agent.slug, name: agent.name, isDefault: agent.id === bound?.agent.id }));
    await reply(formatAgentList(agents));
    return;
  }

  let agent: BoundAgent | null;
  if (route.slug) {
    agent = await findOrgAgentBySlug(route.slug, account.orgId);
    if (!agent || !agent.enabled || !isAgentInvocableBy(agent.config as Record<string, unknown> | null, userId)) {
      await reply(`I don't know an agent called /${route.slug}. Send /agents to see who you can talk to.`);
      return;
    }
  } else {
    agent = bound?.agent ?? null;
    if (!agent) {
      log.error(`[inbound] account=${account.id} has no default agent bound`);
      await reply("This number has no agent assigned yet — ask your admin to bind one.");
      return;
    }
  }

  // Give a captionless attachment something to be a request about, so it does
  // not fall through the "what would you like me to do?" branch below.
  const task =
    route.task ||
    (msg.attachments?.length
      ? `(sent ${msg.attachments.map((file) => file.fileName).join(", ")})`
      : route.task);
  if (!task) {
    await reply(`What would you like /${agent.slug} to do?`);
    return;
  }

  const target: ChannelDeliveryTarget = {
    channel: account.channel,
    connectedSurfaceId: account.id,
    accountKey: account.accountKey,
    chatId: msg.chatId,
    senderId: msg.senderId,
    isGroup: msg.isGroup,
    quoted: msg.ref,
  };

  if (plugin.capabilities.typing) {
    await enqueueOutbound(account.id, {
      kind: "typing",
      chatId: msg.chatId,
      on: true,
      messageId: msg.ref.messageId,
    });
  }
  // "React to messages: off" has to mean this number never reacts. The ack is
  // not the agent asking, but it is still an emoji arriving from them, and two
  // settings that both say "reactions" must not disagree.
  if (policy.ackReaction && plugin.capabilities.reactions && agentActionGatesOf(account.config.channel).reactions) {
    await enqueueOutbound(account.id, { kind: "react", ref: msg.ref, emoji: policy.ackReaction });
  }

  // Everything said in this room since we last spoke, quoted for the model and
  // drained so it is never used twice. The run still belongs to this sender.
  const overheard = msg.isGroup && policy.groupHistoryLimit > 0 ? await drainGroupContext(account.id, msg.chatId) : [];
  const contextBlock = renderGroupContext(overheard);

  try {
    const sessionId = await dispatchChannelRun({
      agent,
      userId,
      task: contextBlock ? `${contextBlock}${task}` : task,
      conversationId: channelConversationId(account.channel, account.accountKey, agent.slug, msg.chatId),
      eventType: msg.isGroup ? "APP_MENTIONED" : "DIRECT_MESSAGE",
      idempotencyKey: `${account.channel}:${account.id}:${msg.messageId}`,
      ...(msg.senderName ? { senderName: msg.senderName } : {}),
      ...(msg.attachments?.length
        ? {
            attachments: msg.attachments.map((file) => ({
              fileName: file.fileName,
              mimeType: file.mimeType,
              data: file.data.toString("base64"),
              sizeBytes: file.data.length,
            })),
          }
        : {}),
      target,
    });
    log.info(`[inbound] dispatched session=${sessionId} agent=${agent.slug} account=${account.id} chat=${msg.chatId}`);
  } catch (err) {
    const message = errMsg(err);
    log.error(`[inbound] dispatch failed account=${account.id} chat=${msg.chatId}: ${message}`);
    if (plugin.capabilities.typing) await enqueueOutbound(account.id, { kind: "typing", chatId: msg.chatId, on: false });
    await reply(
      message.includes("restricted")
        ? `You don't have access to /${agent.slug}. Send /agents to see who you can talk to.`
        : "Something went wrong handing this to the agent — please try again.",
    );
  }
}
