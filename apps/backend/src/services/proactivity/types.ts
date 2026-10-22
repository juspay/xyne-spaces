/**
 * Shapes the proactivity policy decides on. Everything here is plain data, built by the
 * pipeline from the database and Redis, so the policy itself never reads either.
 */

/** What a channel admin chose. SHADOW runs everything and posts nothing. */
export type ProactivityMode = 'OFF' | 'ANSWER' | 'SHADOW';

const PROACTIVITY_MODES: readonly ProactivityMode[] = ['OFF', 'ANSWER', 'SHADOW'];

export const isProactivityMode = (value: unknown): value is ProactivityMode =>
  typeof value === 'string' && (PROACTIVITY_MODES as readonly string[]).includes(value);

/** A message as the policy sees it when it arrives. */
export interface NewMessage {
  messageId: string;
  conversationId: string;
  channelId: string;
  workspaceId: string;
  senderId: string;
  /** A person, or a bot, app or agent. */
  fromPerson: boolean;
  /** Not the opening message of its thread. */
  isReply: boolean;
  /** @mentions a claw agent, so it goes the normal tagged way. */
  tagsAgent: boolean;
  /** @mentions people: they get longer to answer first. */
  mentionsPeople: boolean;
  /** Plain text, mentions rendered as @Name. */
  text: string;
  createdAt: number;
}

/** An agent's unprompted answer, which replies in its thread are follow-ups to. */
export interface Exchange {
  /** The question the agent first answered; follow-ups count against it. */
  episodeId: string;
  agentSlug: string;
  agentUserId: string;
  /** Follow-ups it has answered so far. */
  followUps: number;
}

/** The channel a message arrived in, and what applies to its sender there. */
export interface Room {
  channelId: string;
  mode: ProactivityMode;
  isDirect: boolean;
  /** Desk or Slack Connect: a customer may read it. */
  customerFacing: boolean;
  /** Set when the message replies in a thread an agent answered unprompted. */
  exchange: Exchange | null;
  /**
   * A reply in the sender's own thread that nobody else has replied to yet: a
   * clarification of their question, not a turn in a conversation between people.
   */
  ownQuietThread: boolean;
}

/** One person's burst in one channel. Lives in Redis while it waits. */
export interface Episode {
  id: string;
  workspaceId: string;
  channelId: string;
  senderId: string;
  messageIds: string[];
  firstAt: number;
  lastAt: number;
  /** Times a new message restarted the timer. */
  resets: number;
  /** When the wait is over, as last computed by the policy. */
  deadline: number;
  /** The one extra wait for someone typing has been used. */
  graceUsed: boolean;
  /**
   * A reply in a thread where people are already talking. It waits longer, so the
   * person they're talking with goes first, and is kept to its one thread.
   */
  inConversation: boolean;
  /** Its key among the sender's episodes in the channel: the sender, or sender and thread. */
  scope: string;
  /** One of its messages tags people, who get longer to answer first. */
  mentionsPeople: boolean;
}

/** A message in a snapshot. Ids are short labels (m1, m2…) the questions point at. */
export interface SnapshotMessage {
  label: string;
  messageId: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  fromAgent: boolean;
  text: string;
  at: number;
}

/** Everything the policy reads to decide, as of one moment. */
export interface Snapshot {
  channelName: string;
  mode: ProactivityMode;
  askerId: string;
  askerName: string;
  /** The asker's messages in the episode. */
  asked: SnapshotMessage[];
  /** For a reply in a conversation: the thread before it, so XOR sees who it's to. */
  before: SnapshotMessage[];
  /** Everything said in the question's own threads since it was asked. */
  after: SnapshotMessage[];
  /** Someone other than the asker is typing in one of the episode's threads. */
  othersTyping: boolean;
  /**
   * An agent is already on it in one of those threads: tagged there, working, or
   * replied. Then it is that agent's question, and nobody races it.
   */
  agentEngaged: boolean;
  now: number;
}

/** An agent in the channel that may answer without a mention. */
export interface AgentCard {
  slug: string;
  userId: string;
  name: string;
  /** What it can answer and from where. Routing reads only this. */
  description: string;
}

export type Probabilities = Record<string, number>;

export interface Watch {
  kind: 'ignore' | 'episode' | 'followUp';
  reason: string;
}

export interface Deadline {
  at: number;
  /** This deadline is the typing grace, so the episode has now used it. */
  grace: boolean;
}

export interface Gate {
  /** bump: only "anyone?", so the question it repeats is judged instead. */
  outcome: 'quiet' | 'open' | 'bump';
  reason: string;
  /** XOR's probability for the question `reason` names, when one decided it. */
  score?: number;
  /** Labels of the asked messages that cleared every question. */
  passed: string[];
  probabilities: Probabilities;
}

/** `score` is the best agent's probability. */
export type Route =
  | { kind: 'agents'; agents: AgentCard[]; score?: number; probabilities: Probabilities }
  | { kind: 'none'; reason: string; score?: number; probabilities: Probabilities };

/** What an agent handed back instead of posting. */
export interface Draft {
  agentSlug: string;
  text: string;
  /** Tools the run called, by name. Its sources are linked in `text`. */
  toolsUsed: string[];
  /** Ids of the asker's messages the draft was written for. */
  answers: string[];
  /** Times this draft was redone because the asker added to the question. */
  redrafts: number;
  /** The check before posting already waited once for someone typing. */
  waitedForTyping: boolean;
  /** A reply to the agent's own answer asking for more: someone asked, so the bar is lower. */
  followUp?: boolean;
}

/**
 * A draft's own state. Carried in the draft's callback URL and handed back with the
 * draft, so the backend stores none of it.
 */
/**
 * What a draft carries through claw-auth and back, in its callback URL. Nothing in it
 * decides who posts: that is the agent's own bot, looked up from its slug.
 */
export interface DraftContext {
  /** Ids of the asker's messages it answers. */
  answers: string[];
  startedAt: number;
  redrafts: number;
  waitedForTyping: boolean;
  /** Bot users of every agent drafting for this question: their replies are part of the answer. */
  peers: string[];
}

/**
 * What an agent wrote and what it relied on. Never stored: it is checked as it arrives,
 * and only rides along in the recheck job while a draft waits for someone typing.
 */
export type DraftContent = Pick<Draft, 'text' | 'toolsUsed'>;

/** `score`: XOR's probability for the question `reason` names, when one decided it. */
export type Send = { reason: string; score?: number; probabilities: Probabilities } & (
  | { action: 'post'; correction: boolean }
  | { action: 'react'; messageId: string }
  | { action: 'hold' }
  | { action: 'redraft' }
  | { action: 'wait'; until: number }
);

export interface FollowUp {
  answer: boolean;
  reason: string;
  /** XOR's probability for the question `reason` names, when one decided it. */
  score?: number;
  probabilities: Probabilities;
}
