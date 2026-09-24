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
import { consumeOption, parseMenuChoice, peekOption, tokenForMenuChoice } from "./cards.js";
import {
  DEDUP_TTL_S,
  NOT_LINKED_TEXT,
  RATE_LIMITED_TEXT,
  RATE_LIMIT_NOTICE_TTL_S,
  REDIS_PREFIX,
  UNLINKED_NOTICE_TTL_S,
} from "./const.js";
import { enqueueOutbound, typingCancelled, typingFinished, typingStarted } from "./delivery.js";
import { pickAckReaction } from "./ack.js";
import { agentActionGatesOf } from "./agent-tools.js";
import { dispatchChannelRun } from "./dispatch.js";
import { channelConversationId } from "./ids.js";
import { consumeGroupContext, readGroupContext, rememberGroupMessage, renderGroupContext } from "./group-context.js";
import { resolveIdentity } from "./identity.js";
import type { AnyChannelPlugin, ChannelAccount, ChannelDeliveryTarget, InboundMessage } from "./plugin.js";
import { chatIsAnswerable, evaluatePolicy } from "./policy.js";
import { formatAgentList, namesAnAgent, parseAgentRoute } from "./routing.js";
import { policyOf } from "./schema.js";
import { handleControlCommand, parseControlCommand, rememberActiveRun } from "./commands.js";
import { runSerialized } from "./serialize.js";
import { isAudio, transcribeAudio, transcriptionEnabled } from "./transcribe.js";
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

/** A bare number against the newest numbered menu in this chat, and only when
 *  this is the person the menu was shown to. */
async function menuToken(accountId: string, chatId: string, text: string, senderId: string): Promise<string | null> {
  const choice = parseMenuChoice(text);
  return choice === null ? null : tokenForMenuChoice(accountId, chatId, choice, senderId);
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

/** Same once-per-window guard for the throttling notice itself. */
async function shouldTellRateLimited(accountId: string, senderId: string): Promise<boolean> {
  try {
    const set = await redisService
      .getConnection()
      .set(`${REDIS_PREFIX}:rl-told:${accountId}:${senderId}`, "1", "EX", RATE_LIMIT_NOTICE_TTL_S, "NX");
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

/**
 * Entry point for every inbound message.
 *
 * Serialised per chat, so turns are handled and dispatched in the order they
 * were sent (serialize.ts) — a slow photo cannot be overtaken by the text
 * sent straight after it.
 *
 * The remaining gap, named here because the comment used to overclaim: the
 * chat's queue releases once a turn has been ACCEPTED, not once the agent has
 * answered. A message arriving while a run is still working starts a second
 * run on the same conversation, blind to the first. Closing
 * that means either steering the live run or waiting on /webhook/result, both
 * of which are larger changes than this one.
 */
export async function handleInbound(ctx: InboundContext, msg: InboundMessage): Promise<void> {
  const { account } = ctx;
  // Dropped and deduped before buffering: a message that is not going to be
  // answered must not hold the window open or be merged in twice.
  //
  // A tap can carry an empty title; the option id is the content. A photo sent
  // with no caption is not an empty message — it is the whole message. And
  // `loadAttachments` counts as content: on a channel that fetches lazily a
  // captionless photo has no text and no attachments yet, so testing only
  // those would silently ignore every picture sent without a caption.
  const hasMedia = !!msg.attachments?.length || !!msg.loadAttachments;
  if (msg.fromSelf) {
    log.info(`[inbound] skipped our own echo account=${account.id} chat=${msg.chatId}`);
    return;
  }
  if (!msg.text.trim() && !msg.cardReplyId && !hasMedia) {
    log.info(`[inbound] nothing in it account=${account.id} chat=${msg.chatId}`);
    return;
  }
  if (await isDuplicate(account.id, msg.messageId)) {
    log.info(`[inbound] already seen id=${msg.messageId} account=${account.id}`);
    return;
  }
  // Everything past here is accounted for by a later line, so a message that
  // appears here and nowhere else was lost rather than refused.
  log.info(
    `[inbound] received account=${account.id} chat=${msg.chatId} sender=${msg.senderId}` +
      `${msg.selfChat ? " self" : ""}${msg.isGroup ? " group" : ""} chars=${msg.text.trim().length}`,
  );

  await runSerialized(`${account.id}:${msg.chatId}`, () => handleOne(ctx, msg)).catch((err) =>
    log.error(`[inbound] handling failed account=${account.id} chat=${msg.chatId}: ${errMsg(err)}`),
  );
}

async function handleOne(ctx: InboundContext, msg: InboundMessage): Promise<void> {
  const { account, plugin } = ctx;
  let text = msg.text.trim();

  const policy = policyOf(account.config);

  // Who sent this, properly. Inside the queue so two quick messages cannot
  // swap places while one of them looks the sender up, and behind the
  // chat-level gate so a group the account ignores never pays for it.
  if (msg.resolveSenderId && chatIsAnswerable(policy, { isGroup: msg.isGroup, chatId: msg.chatId, selfChat: msg.selfChat === true })) {
    const resolved = await msg.resolveSenderId().catch((err) => {
      log.warn(`[inbound] sender lookup failed account=${account.id}: ${errMsg(err)}`);
      return null;
    });
    if (resolved) msg.senderId = resolved;
  }

  // Tapping a card we sent is an ANSWER, not a new request, so it resolves
  // before policy and routing: the token is single-use and bound to this chat
  // and this sender, which is a narrower gate than policy would apply. On a
  // channel with no native cards the same options were offered as a numbered
  // menu, so a bare "2" resolves the same way — but only there, so that a
  // stray "2" on WhatsApp can never stand in for a button that exists.
  const tappedToken =
    msg.cardReplyId ??
    (plugin.capabilities.interactive ? null : await menuToken(account.id, msg.chatId, text, msg.senderId));
  if (tappedToken) {
    // Look before spending it. A numbered menu is addressed to the whole chat,
    // so anyone in a group can type "1" — if that consumed the token, a
    // bystander answering something else would silently retire someone else's
    // pending approval.
    const parked = await peekOption(account.id, tappedToken);
    if (parked && (parked.chatId !== msg.chatId || parked.senderId !== msg.senderId)) {
      log.warn(
        `[inbound] card token answered by the wrong person account=${account.id} sender=${msg.senderId} expected=${parked.senderId}`,
      );
      return;
    }
    const option = parked ? await consumeOption(account.id, tappedToken) : null;
    if (!option) {
      // The card is spent. Only the person it belonged to is owed an
      // explanation — a native tap is always theirs, and a typed number only
      // reaches here when the menu was theirs. Saying it out loud to a group
      // for the next half hour is noise nobody asked for.
      if (msg.cardReplyId) {
        await enqueueOutbound(account.id, {
          kind: "text",
          chatId: msg.chatId,
          text: "That option has already been used or has expired — ask me again and I'll re-send it.",
        });
        return;
      }
      // A stale typed number is just a message; let it be handled as one.
      log.info(`[inbound] stale menu choice account=${account.id} sender=${msg.senderId}`);
    } else if (option.action.kind === "approve-write" || option.action.kind === "decline-write") {
      await redeemApproval({ account, option, senderId: msg.senderId, chatId: msg.chatId });
      return;
    } else {
      // Picker options carry no side effect of their own: they stand in for
      // something the person could have typed, so hand them to normal routing.
      text = option.action.kind === "agent" ? `/${option.action.slug}` : option.action.text;
    }
  }

  const linkedUserId = await resolveIdentity({
    surfaceId: account.surfaceId,
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
    // …which the code now actually does. A personal number has nothing for a
    // stranger to register against: its accounts are only ever offered to
    // their own owner (routes/numbers.ts), so "sign in and add this number"
    // sends them to a door that does not open.
    if (plugin.accountScope === "user") {
      log.info(`[inbound] silent to unlinked sender=${msg.senderId} on personal account=${account.id}`);
      return;
    }
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

  // Throttle the expensive half. Checked here and not on arrival so the
  // notice only ever goes to someone the account would have answered anyway:
  // replying to a stranger the policy already ignores would be a worse leak
  // than the flood it is protecting against.
  if (await overRateLimit(account.id, msg.senderId, policy.rateLimitPerMinute)) {
    log.warn(`[inbound] rate-limited sender=${msg.senderId} account=${account.id}`);
    if (await shouldTellRateLimited(account.id, msg.senderId)) await reply(RATE_LIMITED_TEXT);
    return;
  }

  const route = parseAgentRoute(text);
  const bound = await findDefaultAgent(account, account.surfaceId);

  // Control commands: about the conversation, not to the agent. Resolved
  // before routing because they never start a run, and answered against the
  // DEFAULT agent's thread — that is the one a person is in when they ask for
  // a fresh start without naming anybody.
  const command = parseControlCommand(text);
  if (command) {
    await handleControlCommand({ command, account, chatId: msg.chatId, userId, agentSlug: bound?.agent.slug ?? null, reply });
    return;
  }

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

  // Show life NOW. Everything above was cheap; everything below is not — a
  // 12 MB download and a minute of transcription both sit between here and
  // the first word of the answer, and they are exactly the wait that needs a
  // signal. The indicator refreshes itself until the reply lands.
  if (plugin.capabilities.typing) {
    await typingStarted(account.id, msg.chatId);
    await enqueueOutbound(account.id, {
      kind: "typing",
      chatId: msg.chatId,
      on: true,
      messageId: msg.ref.messageId,
    });
  }

  // Now that the message is going to be answered, it is worth paying for its
  // files. Before this point the account may well have ignored it.
  let mediaNote = "";
  if (!msg.attachments?.length && msg.loadAttachments) {
    msg.attachments = await msg.loadAttachments().catch((err) => {
      log.warn(`[inbound] attachment fetch failed account=${account.id}: ${errMsg(err)}`);
      return [];
    });
    // Nothing readable at all: say so rather than dropping it, so the person
    // is not left staring at an unanswered message.
    if (!msg.attachments.length && msg.mediaKind) mediaNote = `(sent a ${msg.mediaKind} that could not be read)`;
  }

  // A voice note is a spoken message, so the words become the request itself
  // and the audio is dropped: the model reads text, never an ogg.
  let spoken = "";
  const audio = msg.attachments?.find((file) => isAudio(file.mimeType));
  if (audio && transcriptionEnabled()) {
    spoken = await transcribeAudio(audio);
    if (spoken) {
      msg.attachments = (msg.attachments ?? []).filter((file) => file !== audio);
      log.info(`[inbound] transcribed voice note account=${account.id} chars=${spoken.length}`);
    }
  }

  // Give a captionless attachment something to be a request about, so it does
  // not fall through the "what would you like me to do?" branch below.
  const task =
    route.task ||
    spoken ||
    (audio && !spoken ? "(sent a voice note that could not be transcribed)" : "") ||
    (msg.attachments?.length
      ? `(sent ${msg.attachments.map((file) => file.fileName).join(", ")})`
      : mediaNote || route.task);
  if (!task) {
    await reply(`What would you like /${agent.slug} to do?`);
    return;
  }

  // One switch decides every emoji this number sends: the ack now, and the
  // outcome that replaces it when the run ends.
  const reactionsOn =
    plugin.capabilities.reactions && agentActionGatesOf(account.config.channel).reactions;

  const target: ChannelDeliveryTarget = {
    channel: account.channel,
    connectedSurfaceId: account.id,
    accountKey: account.accountKey,
    chatId: msg.chatId,
    senderId: msg.senderId,
    isGroup: msg.isGroup,
    quoted: msg.ref,
    ...(reactionsOn && policy.ackReaction ? { statusReactions: true } : {}),
  };

  // "React to messages: off" has to mean this number never reacts. The ack is
  // not the agent asking, but it is still an emoji arriving from them, and two
  // settings that both say "reactions" must not disagree.
  if (policy.ackReaction && reactionsOn) {
    await enqueueOutbound(account.id, { kind: "react", ref: msg.ref, emoji: pickAckReaction(task, policy.ackReaction) });
  }

  // Everything said in this room since we last spoke, quoted for the model.
  // Read now, dropped only once the run is accepted: erasing it up front loses
  // the conversation for good when the dispatch fails. The run still belongs
  // to this sender.
  const overheard = msg.isGroup && policy.groupHistoryLimit > 0 ? await readGroupContext(account.id, msg.chatId) : [];
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
      ...(msg.attachments?.length ? { attachments: msg.attachments } : {}),
      target,
    });
    // Quoted and accepted, so these lines must not reach a second run.
    await consumeGroupContext(account.id, msg.chatId, overheard.length);
    await rememberActiveRun(account.id, msg.chatId, { sessionId, agentSlug: agent.slug, startedAt: Date.now() });
    log.info(`[inbound] dispatched session=${sessionId} agent=${agent.slug} account=${account.id} chat=${msg.chatId}`);
  } catch (err) {
    const message = errMsg(err);
    log.error(`[inbound] dispatch failed account=${account.id} chat=${msg.chatId}: ${message}`);
    // Only if nothing else is still working here, same rule as a delivered result.
    if (plugin.capabilities.typing && (await typingFinished(account.id, msg.chatId))) {
      await enqueueOutbound(account.id, { kind: "typing", chatId: msg.chatId, on: false });
    }
    await reply(
      message.includes("restricted")
        ? `You don't have access to /${agent.slug}. Send /agents to see who you can talk to.`
        : "Something went wrong handing this to the agent — please try again.",
    );
  }
}
