/**
 * Daily Brief → WhatsApp: the delivery half of a scheduled brief.
 *
 * Generation (services/dailyBrief.ts) stores the brief; the cron worker then
 * enqueues ONE delivery job per user per day (queue/daily-brief-delivery-*),
 * and this module decides whether and how that brief reaches the user's
 * linked WhatsApp. It never starts an LLM run: the stored brief is rendered
 * to a short message and handed to notifyUser().
 *
 * Exactly-once is enforced in the database, not in the queue: the brief row's
 * `whatsappDeliveredAt` is claimed with a conditional update before sending
 * and released again if the send fails, so a retried or duplicated job can
 * never send the same day's brief twice.
 */
import { prisma } from "../db.js";
import { CONFIG } from "../config.js";
import { createLogger } from "../logger.js";
import { DAILY_BRIEF_KIND } from "../repositories/index.js";
import { stripCitationMarkup } from "../surfaces/messaging/format.js";
import {
  recordDailyBriefWhatsappDelivery,
  recordDailyBriefWhatsappOptChange,
  type DailyBriefWhatsappOutcome,
} from "../otel/daily-brief-metrics.js";
import { briefDateBucket, type DailyBriefPayload } from "./dailyBrief.js";

const log = createLogger("daily-brief-whatsapp");

/** Hard ceiling for the rendered message. Keeps the brief to one WhatsApp
 *  bubble (no PDF fallback) and inside a template parameter's limit. */
export const WHATSAPP_BRIEF_MAX_CHARS = 900;
const MAX_ITEMS_PER_SECTION = 3;
const MAX_LINE_CHARS = 160;

const SECTIONS: ReadonlyArray<readonly [keyof DailyBriefPayload, string]> = [
  ["what_needs_you", "What needs you"],
  ["overdue", "Overdue"],
  ["waiting_on_others", "Waiting on others"],
  ["assigned_to_you", "Assigned to you"],
  ["todays_schedule", "Today's schedule"],
];

/** Shown under every brief so turning it off never needs a trip to Settings. */
export const BRIEF_OPT_OUT_HINT = "Reply /brief off to stop these.";

/**
 * Turn the WhatsApp copy of a user's brief on or off. Shared by the settings
 * API and the `/brief` chat command so both record the same audit time and
 * metric. Returns the previous value so callers can tell a no-op apart.
 */
export async function setDailyBriefWhatsappEnabled(
  userId: string,
  enabled: boolean,
  source: "settings" | "chat",
): Promise<boolean> {
  const before = await prisma.user.findUnique({ where: { id: userId }, select: { dailyBriefWhatsappEnabled: true } });
  await prisma.user.update({
    where: { id: userId },
    data: { dailyBriefWhatsappEnabled: enabled, dailyBriefWhatsappChangedAt: new Date() },
  });
  const previous = before?.dailyBriefWhatsappEnabled ?? true;
  if (previous !== enabled) recordDailyBriefWhatsappOptChange(enabled, source);
  return previous;
}

/** Where the full brief lives in Spaces. */
export function briefUrl(dateBucket: string): string {
  return `${CONFIG.spacesAppUrl.replace(/\/+$/, "")}/ai/daily-brief/${encodeURIComponent(dateBucket)}`;
}

/** One brief line as plain chat text: no citations, links reduced to their
 *  label, no headings, one line, capped. */
export function cleanBriefLine(line: string): string {
  const text = stripCitationMarkup(line)
    .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return text.length <= MAX_LINE_CHARS ? text : `${text.slice(0, MAX_LINE_CHARS - 1).trimEnd()}…`;
}

function sectionLines(brief: DailyBriefPayload, key: keyof DailyBriefPayload): string[] {
  const value = brief[key];
  return Array.isArray(value) ? value.map(cleanBriefLine).filter(Boolean) : [];
}

/**
 * Render a stored brief as one WhatsApp message of at most
 * WHATSAPP_BRIEF_MAX_CHARS. Sections keep their order of importance; each
 * shows up to three items, and whatever does not fit is counted rather than
 * cut mid-sentence. The link to the full brief is always kept.
 */
export function renderBriefForWhatsApp(brief: DailyBriefPayload, url: string): string {
  const header = `**Your brief for ${brief.date || "today"}**`;
  const footer = `Full brief: ${url}\n${BRIEF_OPT_OUT_HINT}`;
  const budget = WHATSAPP_BRIEF_MAX_CHARS - header.length - footer.length - 4;

  const blocks: string[] = [];
  let used = 0;
  let hidden = 0;
  for (const [key, heading] of SECTIONS) {
    const lines = sectionLines(brief, key);
    if (!lines.length) continue;
    const shown: string[] = [];
    for (const line of lines.slice(0, MAX_ITEMS_PER_SECTION)) {
      const candidate = [...shown, `• ${line}`];
      const block = `**${heading}**\n${candidate.join("\n")}`;
      if (used + block.length + 2 > budget) break;
      shown.push(`• ${line}`);
    }
    hidden += lines.length - shown.length;
    if (!shown.length) continue;
    const block = `**${heading}**\n${shown.join("\n")}`;
    blocks.push(block);
    used += block.length + 2;
  }

  const body = blocks.length ? blocks.join("\n\n") : "Nothing needs you this morning.";
  const more = hidden > 0 ? `\n\n+${hidden} more in the full brief.` : "";
  const out = `${header}\n\n${body}${more}\n\n${footer}`;
  // The `more` note is the one thing outside the budget; it is short, but
  // never let it push past the ceiling.
  return out.length <= WHATSAPP_BRIEF_MAX_CHARS ? out : `${header}\n\n${body}\n\n${footer}`;
}

/** The single `{{1}}` of the brief template, used outside the 24h window:
 *  counts plus the link, since a template cannot carry the full layout. */
export function briefTemplateText(brief: DailyBriefPayload, url: string): string {
  const counts: string[] = [];
  const add = (n: number, label: string) => {
    if (n > 0) counts.push(`${n} ${label}`);
  };
  add(sectionLines(brief, "what_needs_you").length, "need you");
  add(sectionLines(brief, "overdue").length, "overdue");
  add(sectionLines(brief, "waiting_on_others").length, "waiting on others");
  add(sectionLines(brief, "todays_schedule").length, "on today's schedule");
  const summary = counts.length ? counts.join(", ") : "Nothing needs you this morning";
  return `${summary}. Full brief: ${url}`;
}

export type DeliveryResult = { outcome: DailyBriefWhatsappOutcome | "stale" | "missing"; retry: boolean };

function finish(userId: string, outcome: DeliveryResult["outcome"], retry = false): DeliveryResult {
  if (outcome !== "stale" && outcome !== "missing") recordDailyBriefWhatsappDelivery(outcome);
  log.info(`[daily-brief-whatsapp] user=${userId} outcome=${outcome}${retry ? " (will retry)" : ""}`);
  return { outcome, retry };
}

/**
 * Send one user's stored brief for `dateBucket` to their WhatsApp, at most
 * once. Returns `retry: true` only for a transient send failure; every other
 * outcome is final (no target, opted out, window shut with no template…).
 */
export async function deliverDailyBriefToWhatsapp(
  userId: string,
  dateBucket: string,
  now: Date = new Date(),
): Promise<DeliveryResult> {
  if (CONFIG.dailyBriefWhatsappDisabled) return finish(userId, "disabled");
  // A delivery that was held past its day (quiet hours, a queue backlog) is
  // yesterday's news; the next brief is the one worth sending.
  if (dateBucket !== briefDateBucket(now)) return finish(userId, "stale");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { dailyBriefEnabled: true, dailyBriefWhatsappEnabled: true },
  });
  if (!user?.dailyBriefEnabled || !user.dailyBriefWhatsappEnabled) return finish(userId, "opted_out");

  const row = await prisma.generatedContent.findUnique({
    where: { userId_kind_dateBucket: { userId, kind: DAILY_BRIEF_KIND, dateBucket } },
    select: { id: true, orgId: true, status: true, data: true, whatsappDeliveredAt: true },
  });
  if (!row) return finish(userId, "missing");
  // A regenerate that started after the job was queued flips the row to
  // "generating"; wait for it rather than dropping the day's message.
  if (row.status === "generating") return finish(userId, "missing", true);
  if (row.status !== "ready" || !row.data) return finish(userId, "missing");
  if (CONFIG.dailyBriefWhatsappOrgs.length > 0 && !CONFIG.dailyBriefWhatsappOrgs.includes(row.orgId)) {
    return finish(userId, "disabled");
  }
  if (row.whatsappDeliveredAt) return finish(userId, "duplicate_skipped");

  // Claim before sending: only one job may hold the day's brief.
  const claimedAt = new Date();
  const claim = await prisma.generatedContent.updateMany({
    where: { id: row.id, whatsappDeliveredAt: null },
    data: { whatsappDeliveredAt: claimedAt },
  });
  if (claim.count === 0) return finish(userId, "duplicate_skipped");

  const brief = row.data as unknown as DailyBriefPayload;
  const url = briefUrl(dateBucket);
  const release = () =>
    prisma.generatedContent
      .updateMany({ where: { id: row.id, whatsappDeliveredAt: claimedAt }, data: { whatsappDeliveredAt: null } })
      .catch((err: unknown) => log.warn(`[daily-brief-whatsapp] could not release claim for ${userId}: ${String(err)}`));

  // Imported here so the queue/worker modules stay cheap to load in tests and
  // the messaging layer is only pulled in when a brief is actually sent.
  const { notifyUser } = await import("../surfaces/messaging/agent-tools.js");
  let sent: Awaited<ReturnType<typeof notifyUser>>;
  try {
    sent = await notifyUser({
      userId,
      orgId: row.orgId,
      text: renderBriefForWhatsApp(brief, url),
      templateKind: "dailyBrief",
      templateText: briefTemplateText(brief, url),
    });
  } catch (err) {
    await release();
    log.warn(`[daily-brief-whatsapp] send threw for ${userId}: ${String(err)}`);
    return finish(userId, "failed", true);
  }
  if (sent.ok) return finish(userId, sent.viaTemplate ? "template" : "sent");

  await release();
  return finish(userId, sent.reason, sent.reason === "failed");
}
