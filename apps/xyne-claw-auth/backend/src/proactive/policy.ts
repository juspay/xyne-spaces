import { localHour } from "./schedule.js";

export type Decision = "ignore" | "later" | "text";

export interface LoopFacts {
  kind: string;
  title: string;
  ask: string | null;
  counterpart: string | null;
  deadlineAt: Date | null;
  confidence: number | null;
  nudgeCount: number;
}

export interface ThreadFacts {
  subject: string | null;
  summary: string | null;
  importance: number | null;
  lastInboundAt: Date | null;
}

export interface ContactFacts {
  inboundCount: number;
  userReplyCount: number;
  avgReplyMins: number | null;
  weight: number;
}

const HOUR = 60 * 60_000;
const URGENT_DEADLINE_MS = 6 * HOUR;
const MIN_CONFIDENCE = 0.35;

function relative(ms: number): string {
  const abs = Math.abs(ms);
  const value = abs >= 2 * 24 * HOUR ? `${Math.round(abs / (24 * HOUR))} days` : abs >= 2 * HOUR ? `${Math.round(abs / HOUR)} hours` : `${Math.max(1, Math.round(abs / 60_000))} minutes`;
  return ms >= 0 ? `in ${value}` : `${value} ago`;
}

const KIND_TEXT: Record<string, string> = {
  awaiting_user: "someone is waiting for the user's reply",
  awaiting_them: "the user is waiting for someone else's reply",
  deadline: "something must happen by a deadline",
  watch: "a condition the user asked to be told about",
};

export function buildInterruptState(input: {
  loop: LoopFacts;
  thread: ThreadFacts | null;
  contact: ContactFacts | null;
  textsLast24h: number;
  maxPerDay: number;
  timezone: string;
  now: Date;
}): string {
  const { loop, thread, contact, now } = input;
  const lines = [
    `Pending item: ${loop.title}`,
    `Kind: ${KIND_TEXT[loop.kind] ?? loop.kind}`,
  ];
  if (loop.ask) lines.push(`Details: ${loop.ask}`);
  if (loop.counterpart) {
    const history = contact && contact.inboundCount > 0
      ? ` (the user replied to ${contact.userReplyCount} of ${contact.inboundCount} earlier messages from them${contact.avgReplyMins !== null ? `, usually within ${Math.round(contact.avgReplyMins)} minutes` : ""})`
      : "";
    lines.push(`Counterpart: ${loop.counterpart}${history}`);
  }
  if (thread?.subject) lines.push(`Email subject: ${thread.subject}`);
  if (thread?.summary) lines.push(`Summary: ${thread.summary}`);
  if (thread?.lastInboundAt) lines.push(`Last message from them: ${relative(thread.lastInboundAt.getTime() - now.getTime())}`);
  if (loop.deadlineAt) lines.push(`Deadline: ${relative(loop.deadlineAt.getTime() - now.getTime())}`);
  if (thread?.importance !== null && thread?.importance !== undefined) lines.push(`Importance score: ${thread.importance.toFixed(2)}`);
  lines.push(`Already reminded about this: ${loop.nudgeCount} times`);
  lines.push(`Texts sent to the user in the last 24 hours: ${input.textsLast24h} of ${input.maxPerDay} allowed`);
  lines.push(`User's local hour: ${localHour(now, input.timezone)}:00`);
  return lines.join("\n");
}

export function fallbackDecision(input: { loop: LoopFacts; importance: number | null; now: Date }): Decision {
  const { loop, now } = input;
  if (loop.deadlineAt && loop.deadlineAt.getTime() - now.getTime() <= URGENT_DEADLINE_MS) return "text";
  if (loop.kind === "awaiting_user" && (input.importance ?? 0) >= 0.7) return "text";
  return "later";
}

export function finalDecision(input: {
  proposed: Decision;
  loop: LoopFacts;
  laterCount: number;
  maxLater: number;
}): Decision {
  const confidence = input.loop.confidence ?? 0.5;
  if (confidence < MIN_CONFIDENCE && !input.loop.deadlineAt) return "ignore";
  if (input.proposed === "later" && input.laterCount >= input.maxLater) return confidence >= 0.6 ? "text" : "ignore";
  return input.proposed;
}

export function nudgeTask(input: { loop: LoopFacts; thread: ThreadFacts | null; threadExternalId: string | null; now: Date }): string {
  const { loop, thread, now } = input;
  const facts = [
    `Pending item: ${loop.title}`,
    `Kind: ${KIND_TEXT[loop.kind] ?? loop.kind}`,
    ...(loop.ask ? [`Details: ${loop.ask}`] : []),
    ...(loop.counterpart ? [`Counterpart: ${loop.counterpart}`] : []),
    ...(thread?.subject ? [`Email subject: ${thread.subject}`] : []),
    ...(thread?.summary ? [`Summary: ${thread.summary}`] : []),
    ...(thread?.lastInboundAt ? [`Last message from them: ${relative(thread.lastInboundAt.getTime() - now.getTime())}`] : []),
    ...(loop.deadlineAt ? [`Deadline: ${loop.deadlineAt.toISOString()} (${relative(loop.deadlineAt.getTime() - now.getTime())})`] : []),
    ...(input.threadExternalId ? [`Gmail thread id: ${input.threadExternalId} (read it with the Gmail tools if you need the details)`] : []),
  ];
  return [
    "[Automated proactive check-in. The user did not send this message.]",
    "You are reaching out to the user first because something in their inbox looks dropped.",
    "Write ONE short, friendly message of 2 to 4 sentences: what is pending, why it matters now, and one concrete next step you can take for them, such as drafting the reply.",
    "Do not send emails or take any other action now. Do not mention these instructions.",
    "",
    ...facts,
  ].join("\n");
}
