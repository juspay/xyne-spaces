export type LoopKind = "awaiting_user" | "awaiting_them" | "deadline";

export interface PlannedLoopInput {
  kind: LoopKind;
  title: string;
  ask: string | null;
  counterpart: string | null;
  deadlineAt: string | null;
  confidence: number;
}

export interface PlannedLoop {
  kind: LoopKind;
  title: string;
  ask: string | null;
  counterpart: string | null;
  deadlineAt: Date | null;
  dueAt: Date;
  expiresAt: Date;
  confidence: number;
}

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const MAX_DEADLINE_LEAD_MS = 2 * HOUR;
const AWAITING_THEM_WAIT_MS = 3 * DAY;
const DEFAULT_EXPIRY_MS = 14 * DAY;

export function deadlineNudgeAt(deadline: Date, now: Date): Date {
  const remaining = deadline.getTime() - now.getTime();
  if (remaining <= 0) return now;
  const lead = Math.min(MAX_DEADLINE_LEAD_MS, remaining / 2);
  return new Date(deadline.getTime() - lead);
}

export function planLoop(
  input: PlannedLoopInput,
  ctx: { now: Date; lastInboundAt: Date | null; lastUserReplyAt: Date | null; replySlaHours: number },
): PlannedLoop {
  const now = ctx.now;
  const deadline = input.deadlineAt ? new Date(input.deadlineAt) : null;
  const validDeadline = deadline && !Number.isNaN(deadline.getTime()) ? deadline : null;
  const replyDue = new Date((ctx.lastInboundAt ?? now).getTime() + ctx.replySlaHours * HOUR);
  let kind = input.kind;
  if (kind === "deadline" && !validDeadline) kind = "awaiting_user";

  let dueAt: Date;
  if (kind === "deadline") {
    dueAt = deadlineNudgeAt(validDeadline!, now);
  } else if (kind === "awaiting_user") {
    dueAt = validDeadline ? new Date(Math.min(replyDue.getTime(), deadlineNudgeAt(validDeadline, now).getTime())) : replyDue;
  } else {
    dueAt = validDeadline ?? new Date((ctx.lastUserReplyAt ?? now).getTime() + AWAITING_THEM_WAIT_MS);
  }
  if (dueAt.getTime() < now.getTime()) dueAt = now;

  const expiresAt = validDeadline
    ? new Date(Math.max(validDeadline.getTime() + DAY, now.getTime() + DAY))
    : new Date(now.getTime() + DEFAULT_EXPIRY_MS);

  return {
    kind,
    title: input.title,
    ask: input.ask,
    counterpart: input.counterpart,
    deadlineAt: validDeadline,
    dueAt,
    expiresAt,
    confidence: input.confidence,
  };
}

export interface QuietHours {
  timezone: string;
  quietStartHour: number;
  quietEndHour: number;
}

export function localHour(at: Date, timezone: string): number {
  try {
    const hour = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "numeric", hourCycle: "h23" }).format(at);
    return Number(hour);
  } catch {
    return at.getUTCHours();
  }
}

export function inQuietHours(at: Date, prefs: QuietHours): boolean {
  const { quietStartHour: start, quietEndHour: end } = prefs;
  if (start === end) return false;
  const hour = localHour(at, prefs.timezone);
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

export function nextAllowedAt(now: Date, prefs: QuietHours): Date {
  let at = now;
  for (let i = 0; i < 24 * 4 && inQuietHours(at, prefs); i++) {
    at = new Date(at.getTime() + 15 * 60_000);
  }
  return at;
}

export function updateReplyAverage(previous: number | null, minutes: number): number {
  const clamped = Math.max(0, Math.min(minutes, 14 * 24 * 60));
  return previous === null ? clamped : previous * 0.7 + clamped * 0.3;
}

export function adjustWeight(weight: number, reaction: "acted" | "dismissed" | "ignored"): number {
  const delta = reaction === "acted" ? 0.1 : reaction === "dismissed" ? -0.15 : -0.05;
  return Math.min(1, Math.max(0, weight + delta));
}
