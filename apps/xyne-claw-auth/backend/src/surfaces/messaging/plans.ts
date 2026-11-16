/**
 * Plans on a messenger.
 *
 * In Spaces a plan is one card: proposed with Approve/Reject (plan mode), then
 * updated in place as each step runs. A phone chat has neither the card nor a
 * way to edit a sent message on every channel (the Cloud API has none), so:
 *
 *  - a proposed plan is a numbered list, followed by an Approve/Reject card —
 *    buttons on WhatsApp Cloud, a numbered reply on Baileys, both through the
 *    same parked-option tokens as write approvals (cards.ts);
 *  - progress is the list re-sent as steps complete, at most once per
 *    PROGRESS_INTERVAL_S, with the finished list always sent.
 *
 * The decision follows routes/flow-action.ts's plan-approval handler over the
 * same server state: the active plan pointer (stale/superseded check), the
 * plan-exec meta (approved titles for the reject filter), and a Turn 2
 * dispatched in auto mode with planContinuation and the same task wording.
 */
import { createLogger } from "../../logger.js";
import { errMsg } from "../../lib/errors.js";
import { redisService } from "../../redis.js";
import { chatMessageRepository } from "../../repositories/index.js";
import { isSlotBusy } from "../../lib/message-queue.js";
import {
  clearActivePlanCard,
  clearPlanExecMeta,
  getActivePlanCard,
  normalizePlanTitle,
  setActivePlanCard,
  setPlanExecMeta,
} from "../../lib/session-context.js";
import { continueInChat, dispatchGoalTurn } from "./busy.js";
import { newCardToken, parkOptions, type ParkedOption } from "./cards.js";
import { REDIS_PREFIX } from "./const.js";
import { deliverChannelResult, enqueueOutbound } from "./delivery.js";
import { resolveIdentity } from "./identity.js";
import type { ChannelAccount, ChannelDeliveryTarget, InteractiveCard } from "./plugin.js";

const log = createLogger("channel-plans");

/** Minimum gap between two progress lists in one conversation. The finished
 *  list is exempt, so the last word is never swallowed by the limit. */
export const PROGRESS_INTERVAL_S = 30;
const PROGRESS_STATE_TTL_S = 24 * 60 * 60;

export interface PlanStep {
  id: string;
  title: string;
}

export type PlanStepStatus = "pending" | "in_progress" | "completed" | "failed";

/** claw's propose-plan payload (routes/webhook.ts `pendingPlan`). */
export interface ProposedPlan {
  title: string;
  desc?: string;
  document?: string;
  todos: PlanStep[];
  trivial: boolean;
}

/** The agent's own plan-mode switch (agent.config.planMode), read the same
 *  way the Spaces mention path reads it. */
export function agentPlanModeOn(config: unknown): boolean {
  return !!config && typeof config === "object" && (config as Record<string, unknown>)["planMode"] === true;
}

/** The task Turn 2 starts with — the wording Spaces uses (flow-action.ts). */
export function planExecutionTask(steps: PlanStep[]): string {
  return "Execute this approved plan:\n" + steps.map((t, i) => `${i + 1}. ${t.title}`).join("\n");
}

function heading(prefix: string, title: string | undefined): string {
  const name = title?.trim();
  return name && name.toLowerCase() !== "plan" ? `**${prefix}: ${name}**` : `**${prefix}**`;
}

/** The proposal as the message that introduces the Approve/Reject choice. */
export function renderPlanProposal(plan: Pick<ProposedPlan, "title" | "desc" | "todos" | "trivial">): string {
  const lines = [heading(plan.trivial ? "Plan" : "Proposed plan", plan.title)];
  if (plan.desc?.trim()) lines.push(plan.desc.trim());
  lines.push("");
  plan.todos.forEach((t, i) => lines.push(`${i + 1}. ${t.title}`));
  lines.push("");
  lines.push(plan.trivial ? "_Quick one — running it now._" : "_Nothing runs until you approve._");
  return lines.join("\n");
}

const STATUS_SUFFIX: Record<PlanStepStatus, string> = {
  pending: "",
  in_progress: " — working on it",
  completed: " ✓",
  failed: " — failed",
};

/** One live snapshot of the step list. */
export function renderPlanProgress(title: string | undefined, todos: Array<PlanStep & { status: PlanStepStatus }>): string {
  const done = todos.filter((t) => t.status === "completed").length;
  const lines = [heading("Plan", title), ""];
  todos.forEach((t, i) => lines.push(`${i + 1}. ${t.title}${STATUS_SUFFIX[t.status] ?? ""}`));
  lines.push("");
  lines.push(`_${done} of ${todos.length} done_`);
  return lines.join("\n");
}

/** The Approve/Reject card. Its body stays short: the list itself went out
 *  as the message above it, so the 1024-character card cap never clips it. */
export function planDecisionCard(approveToken: string, rejectToken: string, note?: string): InteractiveCard {
  return {
    kind: "buttons",
    header: "Plan ready",
    body: note ?? "Run this plan?",
    footer: "Nothing runs until you choose.",
    buttons: [
      { id: approveToken, title: "Approve" },
      { id: rejectToken, title: "Reject" },
    ],
  };
}

interface PlanOwner {
  target: ChannelDeliveryTarget;
  userId: string;
  conversationId: string;
  agentSlug: string;
}

/** Park a fresh Approve/Reject pair for `planId` and send the card. */
async function offerPlanDecision(owner: PlanOwner, planId: string, note?: string): Promise<void> {
  const approveToken = newCardToken();
  const rejectToken = newCardToken();
  const common = {
    chatId: owner.target.chatId,
    senderId: owner.target.senderId,
    userId: owner.userId,
    conversationId: owner.conversationId,
    agentSlug: owner.agentSlug,
  };
  const parked: Array<{ token: string; option: ParkedOption }> = [
    { token: approveToken, option: { ...common, action: { kind: "plan", decision: "approve", planId } } },
    { token: rejectToken, option: { ...common, action: { kind: "plan", decision: "reject", planId } } },
  ];
  await parkOptions(owner.target.connectedSurfaceId, parked);
  await enqueueOutbound(owner.target.connectedSurfaceId, {
    kind: "card",
    chatId: owner.target.chatId,
    card: planDecisionCard(approveToken, rejectToken, note),
  });
}

/**
 * A plan-mode Turn 1 ended in propose-plan. Send the list and, unless the
 * plan is trivial, the Approve/Reject choice; a trivial plan runs at once.
 * Returns the Turn 2 session when one was started while this result still
 * holds the conversation's slot — the caller must then not release it.
 */
export async function deliverChannelPlan(input: PlanOwner & { orgId?: string; plan: ProposedPlan }): Promise<string | null> {
  const { plan, conversationId, agentSlug } = input;
  const text = renderPlanProposal(plan);

  // The plan turn's answer is empty — without this row the transcript shows
  // nothing under the person's request, and the next turn cannot see the plan.
  if (input.orgId) {
    await chatMessageRepository
      .create({
        conversationId,
        agentSlug,
        userId: input.userId,
        orgId: input.orgId,
        role: "assistant",
        content: text,
        status: "completed",
      })
      .catch((err) => log.warn(`[plans] could not record the plan in ${conversationId}: ${errMsg(err)}`));
  }
  await deliverChannelResult({ target: input.target, status: "completed", result: text });

  if (plan.trivial) {
    await clearActivePlanCard(conversationId, agentSlug);
    await setPlanExecMeta(conversationId, agentSlug, {
      autoApproved: true,
      approvedTitles: plan.todos.map((t) => normalizePlanTitle(t.title)),
      approvedAt: new Date().toISOString(),
      ...planFacts(plan),
    }).catch(() => undefined);
    const sessionId = await dispatchGoalTurn({
      target: input.target,
      userId: input.userId,
      agentSlug,
      task: planExecutionTask(plan.todos),
      idempotencyKey: `plan-auto-${newCardToken()}`,
      plan: { phase: "execute", todos: plan.todos },
    }).catch((err) => {
      log.warn(`[plans] trivial plan dispatch failed conv=${conversationId}: ${errMsg(err)}`);
      return null;
    });
    if (!sessionId) {
      await enqueueOutbound(input.target.connectedSurfaceId, {
        kind: "text",
        chatId: input.target.chatId,
        text: "I couldn't start that plan — please ask again.",
      });
    }
    return sessionId;
  }

  // A new proposal replaces any earlier one: its tokens stay parked, but the
  // active pointer no longer names it, so tapping it is refused.
  const planId = newCardToken();
  await setActivePlanCard(conversationId, agentSlug, {
    messageId: planId,
    todos: plan.todos,
    ...planFacts(plan),
  });
  await clearPlanExecMeta(conversationId, agentSlug);
  await offerPlanDecision(input, planId);
  log.info(`[plans] proposed ${plan.todos.length} step(s) conv=${conversationId} plan=${planId}`);
  return null;
}

function planFacts(plan: { title?: string; desc?: string; document?: string }): { title?: string; desc?: string; document?: string } {
  return {
    ...(plan.title ? { title: plan.title } : {}),
    ...(plan.desc ? { desc: plan.desc } : {}),
    ...(plan.document ? { document: plan.document } : {}),
  };
}

const STALE_PLAN_TEXT = "This plan is no longer active. Ask me again for a new plan.";

/**
 * Redeem a tapped (or typed) Approve/Reject. The token has already been
 * consumed by the caller, so every path replies with something.
 */
export async function redeemPlanDecision(input: {
  account: ChannelAccount;
  option: ParkedOption;
  target: ChannelDeliveryTarget;
}): Promise<void> {
  const { account, option, target } = input;
  const reply = (text: string) => enqueueOutbound(account.id, { kind: "text", chatId: target.chatId, text });
  const action = option.action;
  if (action.kind !== "plan" || !option.conversationId || !option.agentSlug) {
    await reply("That option has expired. Ask again and I'll re-send it.");
    return;
  }
  const conversationId = option.conversationId;
  const agentSlug = option.agentSlug;

  // Same rule as a write approval: the tap must come from the person the
  // plan was proposed to, as they are linked now, not as they were.
  const liveUserId = await resolveIdentity({ surfaceId: account.surfaceId, senderId: target.senderId, orgId: account.orgId });
  if (liveUserId !== null && liveUserId !== option.userId) {
    log.error(`[plans] identity changed under a parked plan: sender=${target.senderId} now=${liveUserId} was=${option.userId}`);
    await reply("This plan isn't yours to approve.");
    return;
  }

  const active = await getActivePlanCard(conversationId, agentSlug).catch(() => null);
  if (!active || active.messageId !== action.planId || !active.todos.length) {
    await reply(STALE_PLAN_TEXT);
    return;
  }

  if (action.decision === "reject") {
    await clearActivePlanCard(conversationId, agentSlug);
    await clearPlanExecMeta(conversationId, agentSlug);
    await reply("Plan rejected — nothing was run.");
    await recordDecision(option, account.orgId, "Rejected the plan.", "Plan rejected — nothing was run.");
    log.info(`[plans] rejected conv=${conversationId} plan=${action.planId}`);
    return;
  }

  // Turn 2 must not race a run still working in this chat (flow-action.ts
  // refuses for the same reason). The tap is spent, so offer a fresh one.
  if (await isSlotBusy(conversationId, agentSlug)) {
    await offerPlanDecision(
      { target, userId: option.userId, conversationId, agentSlug },
      action.planId,
      "I'm still finishing something here — approve the plan once I'm done.",
    );
    return;
  }

  await clearActivePlanCard(conversationId, agentSlug);
  await setPlanExecMeta(conversationId, agentSlug, {
    autoApproved: false,
    approvedTitles: active.todos.map((t) => normalizePlanTitle(t.title)),
    approvedAt: new Date().toISOString(),
    ...planFacts(active),
  }).catch(() => undefined);
  await reply(`Approved — running ${active.todos.length} step(s)…`);
  try {
    await continueInChat({
      target,
      userId: option.userId,
      agentSlug,
      task: planExecutionTask(active.todos),
      idempotencyKey: `plan-${action.planId}`,
      plan: { phase: "execute", todos: active.todos.map((t) => ({ id: t.id, title: t.title })) },
    });
    log.info(`[plans] approved conv=${conversationId} plan=${action.planId}`);
  } catch (err) {
    log.error(`[plans] approved plan dispatch failed conv=${conversationId}: ${errMsg(err)}`);
    await reply("Something went wrong starting the plan — please ask again.");
  }
}

/** Best-effort transcript note, so the next turn knows what was decided. */
async function recordDecision(option: ParkedOption, orgId: string, decision: string, outcome: string): Promise<void> {
  if (!option.conversationId) return;
  const common = { conversationId: option.conversationId, agentSlug: option.agentSlug || "assistant", userId: option.userId, orgId };
  try {
    await chatMessageRepository.create({ ...common, role: "user", content: decision });
    await chatMessageRepository.create({ ...common, role: "assistant", content: outcome, status: "completed" });
  } catch (err) {
    log.warn(`[plans] could not record the decision in ${option.conversationId}: ${errMsg(err)}`);
  }
}

function progressKey(accountId: string, conversationId: string): string {
  return `${REDIS_PREFIX}:plan-progress:${accountId}:${conversationId}`;
}

/** What a list says, for "has anything changed since we last sent it". */
export function progressSignature(todos: Array<{ title: string; status: string }>): string {
  return todos.map((t) => `${normalizePlanTitle(t.title)}=${t.status}`).join("|");
}

/**
 * A todo-write landed: re-send the list if it changed and either the gap
 * since the last one has passed or the plan has just finished. The gap is a
 * Redis SET NX with an expiry, so it holds across pods.
 */
export async function sendChannelPlanProgress(input: {
  target: ChannelDeliveryTarget;
  conversationId: string;
  title?: string;
  todos: Array<PlanStep & { status: PlanStepStatus }>;
  allDone: boolean;
}): Promise<boolean> {
  const { target } = input;
  if (input.todos.length === 0) return false;
  const key = progressKey(target.connectedSurfaceId, input.conversationId);
  const signature = progressSignature(input.todos);
  try {
    const redis = redisService.getConnection();
    if ((await redis.get(`${key}:last`)) === signature) return false;
    if (!input.allDone) {
      const free = await redis.set(`${key}:gap`, "1", "EX", PROGRESS_INTERVAL_S, "NX");
      if (free !== "OK") return false;
    }
    await redis.set(`${key}:last`, signature, "EX", PROGRESS_STATE_TTL_S);
  } catch (err) {
    // Redis down: one extra list beats a plan that goes silent.
    log.warn(`[plans] progress throttle unavailable: ${errMsg(err)}`);
  }
  await enqueueOutbound(target.connectedSurfaceId, {
    kind: "text",
    chatId: target.chatId,
    text: renderPlanProgress(input.title, input.todos),
    ...(target.conversationId ? { conversationId: target.conversationId } : {}),
  });
  return true;
}
