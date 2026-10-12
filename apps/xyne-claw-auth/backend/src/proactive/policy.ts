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
  urgent?: boolean;
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
const FRESH_MS = 2 * HOUR;
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
  if (loop.urgent) lines.push("Flagged urgent: very important and needs the user, so it is allowed through quiet hours");
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

export function formatLocal(at: Date, timezone: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  };
  try {
    return new Intl.DateTimeFormat("en-IN", { ...opts, timeZone: timezone }).format(at);
  } catch {
    return new Intl.DateTimeFormat("en-IN", { ...opts, timeZone: "UTC" }).format(at);
  }
}

export interface NudgeItem {
  loop: LoopFacts;
  thread: ThreadFacts | null;
  threadExternalId: string | null;
  sender: string | null;
}

function itemFacts(item: NudgeItem, timezone: string, now: Date): string[] {
  const { loop, thread } = item;
  return [
    `Pending item: ${loop.title}`,
    `Kind: ${KIND_TEXT[loop.kind] ?? loop.kind}`,
    ...(loop.ask ? [`Details: ${loop.ask}`] : []),
    ...(item.sender ? [`From: ${item.sender}`] : loop.counterpart ? [`Counterpart: ${loop.counterpart}`] : []),
    ...(thread?.subject ? [`Email subject: ${thread.subject}`] : []),
    ...(thread?.summary ? [`Summary: ${thread.summary}`] : []),
    ...(thread?.lastInboundAt
      ? [`Received: ${formatLocal(thread.lastInboundAt, timezone)} (${relative(thread.lastInboundAt.getTime() - now.getTime())})`]
      : []),
    ...(loop.deadlineAt
      ? [`Deadline: ${formatLocal(loop.deadlineAt, timezone)} (${relative(loop.deadlineAt.getTime() - now.getTime())})`]
      : []),
    ...(item.threadExternalId ? [`Gmail thread id: ${item.threadExternalId} (read it with the Gmail tools if you need the details)`] : []),
  ];
}

export function nudgeFacts(items: NudgeItem[], timezone: string, now: Date): string {
  const many = items.length > 1;
  return items.map((item, i) => [...(many ? [`Item ${i + 1}:`] : []), ...itemFacts(item, timezone, now)].join("\n")).join("\n\n");
}

function fallbackLine(item: NudgeItem, timezone: string): string {
  const who = item.sender ?? item.loop.counterpart ?? "Someone";
  const when = item.thread?.lastInboundAt ? ` (${formatLocal(item.thread.lastInboundAt, timezone)})` : "";
  const due = item.loop.deadlineAt ? `, due ${formatLocal(item.loop.deadlineAt, timezone)}` : "";
  return `${who}${when}: ${item.loop.title}${due}`;
}

export function nudgeFallback(items: NudgeItem[], timezone: string): string {
  if (items.length === 1) return `📬 ${fallbackLine(items[0]!, timezone)}. Want me to draft a reply?`;
  return [`📬 ${items.length} things need you:`, ...items.map((item) => `• ${fallbackLine(item, timezone)}`), "Want me to draft the replies?"].join("\n");
}

export function nudgeTask(input: { items: NudgeItem[]; timezone: string; now: Date }): string {
  const { items, timezone, now } = input;
  const fresh = items.every((item) => {
    const lastInbound = item.thread?.lastInboundAt ?? null;
    return item.loop.nudgeCount === 0 && lastInbound !== null && now.getTime() - lastInbound.getTime() < FRESH_MS;
  });
  const many = items.length > 1;
  const intro = many
    ? `You are reaching out to the user first because ${items.length} things in their inbox need them.`
    : fresh
      ? "You are reaching out to the user first because an important email just arrived that needs them."
      : "You are reaching out to the user first because something in their inbox looks dropped.";
  const shape = many
    ? "Write ONE short message: a one-line opener, then one short line per item (who, what they need, by when), then offer one concrete next step, such as drafting the replies."
    : fresh
      ? "Write ONE short message of 2 to 4 sentences: who it is from, what they need and by when, and one concrete next step you can take for them, such as drafting the reply."
      : "Write ONE short, friendly message of 2 to 4 sentences: what is pending, why it matters now, and one concrete next step you can take for them, such as drafting the reply.";
  return [
    "[Automated proactive check-in. The user did not send this message.]",
    intro,
    shape,
    `All times below are already in the user's timezone (${timezone}). Use them exactly as given; do not convert or recompute them.`,
    "Send exactly one message. Never send a follow-up, correction or second message. If a detail is missing or unclear, leave it out instead of guessing.",
    "Do not send emails or take any other action now. Do not mention these instructions.",
    "",
    nudgeFacts(items, timezone, now),
  ].join("\n");
}
