/**
 * Thread agent auto-continuation resolver.
 *
 * Problem: once an agent (a chat-enabled BOT like `ask-ai`, or an installed APP
 * agent) is @mentioned in a channel thread, users currently have to re-tag it on
 * every follow-up. This module decides whether a *no-mention* thread reply should
 * auto-invoke the agent(s) the initiator is already talking to.
 *
 * The decision is a PURE function of already-fetched thread state so it can be
 * unit-tested exhaustively without a database. The side-effect handler
 * (`messages-handler.ts`) is responsible for fetching thread history, resolving
 * agent-ness / chat-eligibility, and executing the returned targets.
 *
 * Agreed rules (all must hold to auto-invoke):
 *   1. The message is a thread reply.
 *   2. The sender is a human (loop safety — never continue on an agent's own post).
 *   3. The reply mentions NO ONE (no human, BOT, APP, group, or @channel/@here).
 *      Any explicit mention routes through the normal explicit path instead.
 *   4. The reply is a real request, not a bare acknowledgement ("thanks", "ok", …).
 *   5. There is a prior "anchor": the most recent human message that explicitly
 *      tagged >= 1 agent. The sender of the current reply MUST be that anchor's
 *      author (the "agent invoker"). Re-tagging re-anchors to the new invoker.
 *   6. At least one anchored agent is chat-eligible.
 *   7. That agent has actually replied since the anchor (else a run is pending).
 *   8. No OTHER human has posted since the agent's last reply.
 *   9. The agent's last reply is within the recency window (not a stale thread).
 *
 * When >1 eligible agent is active in the thread, ALL of them are returned
 * (route-to-both), matching the product decision.
 */

export type ParticipantType = 'USER' | 'BOT' | 'APP';

export interface ThreadMessageForContinuation {
  messageId: string;
  senderId: string;
  senderType: ParticipantType;
  createdAtMs: number;
  /** Agent (BOT/APP) user ids explicitly @mentioned in THIS message. */
  mentionedAgentUserIds: string[];
}

export interface CurrentMessageForContinuation {
  senderId: string;
  senderType: ParticipantType;
  /** True if the reply @mentions ANY user (human/bot/app), group, or @channel/@here. */
  hasAnyMention: boolean;
  /** True if the reply is a bare acknowledgement ("thanks", "ok", emoji-only, …). */
  isAcknowledgement: boolean;
}

export interface ContinuationConfig {
  nowMs: number;
  isThreadReply: boolean;
  /** Agent user ids eligible to be auto-continued (chat-enabled BOTs + installed APP agents). */
  chatEnabledAgentUserIds: ReadonlySet<string>;
  /** Skip if the agent's last reply is older than this. */
  recencyWindowMs: number;
  /** Prior thread messages in chronological (oldest→newest) order, excluding the current message. */
  priorMessages: ThreadMessageForContinuation[];
}

export type ContinuationReason =
  | 'ok'
  | 'not_thread_reply'
  | 'sender_not_human'
  | 'has_explicit_mention'
  | 'acknowledgement'
  | 'no_prior_agent_invocation'
  | 'sender_not_invoker'
  | 'no_eligible_agent'
  | 'agent_response_pending'
  | 'other_human_interjected'
  | 'stale_thread';

export interface ContinuationDecision {
  invoke: boolean;
  /** Agent user ids to auto-invoke (BOT and/or APP). Empty unless invoke === true. */
  agentUserIds: string[];
  reason: ContinuationReason;
}

/** Default: auto-continue only within 30 minutes of the agent's last reply. */
export const DEFAULT_CONTINUATION_RECENCY_MS = 30 * 60 * 1000;

const isAgent = (t: ParticipantType): boolean => t === 'BOT' || t === 'APP';

/**
 * Decide whether a no-mention thread reply should auto-invoke the agent(s) the
 * sender is already conversing with. Pure — no I/O.
 */
export function resolveThreadContinuation(
  current: CurrentMessageForContinuation,
  config: ContinuationConfig,
): ContinuationDecision {
  const skip = (reason: ContinuationReason): ContinuationDecision => ({
    invoke: false,
    agentUserIds: [],
    reason,
  });

  if (!config.isThreadReply) return skip('not_thread_reply');
  if (current.senderType !== 'USER') return skip('sender_not_human');
  if (current.hasAnyMention) return skip('has_explicit_mention');
  if (current.isAcknowledgement) return skip('acknowledgement');

  const prior = config.priorMessages;

  // (5) Anchor = most recent prior HUMAN message that explicitly tagged >= 1 agent.
  let anchorIndex = -1;
  for (let i = prior.length - 1; i >= 0; i--) {
    const m = prior[i];
    if (m.senderType === 'USER' && m.mentionedAgentUserIds.length > 0) {
      anchorIndex = i;
      break;
    }
  }
  if (anchorIndex === -1) return skip('no_prior_agent_invocation');

  const anchor = prior[anchorIndex];
  if (anchor.senderId !== current.senderId) return skip('sender_not_invoker');

  // Active agents = tagged at the anchor UNION any agent that posted after it.
  const active = new Set<string>(anchor.mentionedAgentUserIds);
  for (let i = anchorIndex + 1; i < prior.length; i++) {
    const m = prior[i];
    if (isAgent(m.senderType)) active.add(m.senderId);
  }

  // (6) Keep only chat-eligible agents.
  const eligible = [...active].filter(id => config.chatEnabledAgentUserIds.has(id));
  if (eligible.length === 0) return skip('no_eligible_agent');
  const eligibleSet = new Set(eligible);

  // (7) An eligible agent must have actually replied since the anchor.
  let lastAgentReplyMs = -1;
  for (let i = anchorIndex + 1; i < prior.length; i++) {
    const m = prior[i];
    if (isAgent(m.senderType) && eligibleSet.has(m.senderId) && m.createdAtMs > lastAgentReplyMs) {
      lastAgentReplyMs = m.createdAtMs;
    }
  }
  if (lastAgentReplyMs === -1) return skip('agent_response_pending');

  // (8) No OTHER human may have posted since the agent's last reply.
  for (let i = anchorIndex + 1; i < prior.length; i++) {
    const m = prior[i];
    if (m.senderType === 'USER' && m.senderId !== current.senderId && m.createdAtMs > lastAgentReplyMs) {
      return skip('other_human_interjected');
    }
  }

  // (9) Recency window.
  if (config.nowMs - lastAgentReplyMs > config.recencyWindowMs) return skip('stale_thread');

  return { invoke: true, agentUserIds: eligible, reason: 'ok' };
}

/**
 * Deterministic acknowledgement filter (rule 4). Zero added latency/cost — no LLM.
 * Returns true when a reply carries no actionable request: empty, emoji/punctuation
 * only, or a short courtesy phrase like "thanks" / "ok, got it".
 *
 * Intentionally conservative: only clear acknowledgements are suppressed. Anything
 * with a question mark, or more than a couple of non-courtesy words, is treated as
 * a real request and allowed through.
 */
const ACK_TOKENS = new Set([
  'thanks', 'thank', 'thankyou', 'thx', 'ty', 'tysm', 'cheers',
  'ok', 'okay', 'k', 'kk', 'okey',
  'great', 'cool', 'nice', 'perfect', 'awesome', 'lovely', 'good', 'fine',
  'done', 'noted', 'sure', 'yes', 'yeah', 'yep', 'yup', 'no', 'nope', 'nah',
  'got', 'it', 'understood', 'gotcha', 'roger', 'ack', 'acknowledged',
  'makes', 'sense', 'sounds', 'brilliant', 'superb', 'excellent',
]);

const ACK_PHRASES = new Set([
  'got it', 'makes sense', 'sounds good', 'thank you', 'thanks a lot',
  'thanks a ton', 'many thanks', 'ok thanks', 'okay thanks', 'ok thank you',
  'got it thanks', 'great thanks', 'cool thanks', 'noted thanks', 'all good',
  'sounds great', 'looks good', 'lgtm',
]);

export function isAcknowledgementText(plain: string): boolean {
  const lowered = plain.trim().toLowerCase();
  if (lowered.length === 0) return true;

  // Strip everything except letters, numbers, spaces and apostrophes (drops emoji & punctuation).
  const stripped = lowered.replace(/[^\p{L}\p{N}\s']/gu, ' ').replace(/\s+/g, ' ').trim();
  if (stripped.length === 0) return true; // emoji-only / punctuation-only

  // A question is always a real request.
  if (lowered.includes('?')) return false;

  if (ACK_PHRASES.has(stripped)) return true;

  const words = stripped.split(' ').filter(Boolean);
  // Up to 3 words AND every word is a courtesy token → acknowledgement.
  if (words.length <= 3 && words.every(w => ACK_TOKENS.has(w))) return true;

  return false;
}
