/**
 * Bulk-enable Digital Twin + kick off backfill for a SET of users, and set
 * auto-approve so curated memories index into Hindsight instead of sitting in
 * Pending Review.
 *
 * Replicates POST /digital-twin/enable (which is requireUserAuth → self-only)
 * for a list of users, for ops/onboarding. Enabling can be done in pure SQL, but
 * the backfill MUST enqueue BullMQ jobs (Redis) — that's why this is a script.
 * Run it INSIDE the claw-auth pod (needs DB + Redis).
 *
 * Usage:
 *   # by email (resolved to claw_auth user ids):
 *   DT_USERS="john.doe@gmail.com,john.doe@gmail.com" DT_MONTHS=6 npx tsx scripts/enable-digital-twin-bulk.ts
 *   # by id:
 *   DT_USER_IDS="cmxxxx,cmyyyy" DT_MONTHS=6 npx tsx scripts/enable-digital-twin-bulk.ts
 *   # no env → falls back to the baked-in @spaces group list:
 *   DT_MONTHS=6 npx tsx scripts/enable-digital-twin-bulk.ts
 *   # preview without writing/enqueuing:
 *   DT_USERS="john.doe@gmail.com" DRY_RUN=1 npx tsx scripts/enable-digital-twin-bulk.ts
 *
 * Env:
 *   DT_USERS                    comma-separated emails
 *   DT_USER_IDS                 comma-separated claw_auth user ids
 *   DT_MONTHS                   backfill span in months (default 6, clamped 1..24)
 *   DT_AUTO_APPROVE_MIN_SCORE   0..1 signal-score floor for auto-approve (default 0 = all)
 *   DRY_RUN=1                   print what would happen, change nothing
 *
 * Behaviour:
 *   - Auto-approve (mode=auto, minScore) is set for EVERY target — enabled or not.
 *   - Not-yet-enabled users are enabled + backfilled (3 jobs: messages/calls/canvases).
 *   - Already-enabled users are left as-is (no re-enable, no re-backfill).
 *   - One row per email (some emails have multiple User rows across orgs); prefer
 *     an already-enabled row, else the most recently created. Idempotent/re-runnable.
 */
import { prisma } from "../src/db.js";
import { Prisma } from "@prisma/client";
import {
  enqueueDigitalTwinBackfill,
  type BackfillSource,
} from "../src/queue/digital-twin-backfill-queue.js";

const SOURCES: BackfillSource[] = ["messages", "calls", "canvases"];
const MONTHS = Math.min(24, Math.max(1, Math.floor(Number(process.env["DT_MONTHS"] ?? 6))));
const DRY = process.env["DRY_RUN"] === "1";

// Auto-approve so backfilled memories get indexed into Hindsight instead of
// piling up in Pending Review. `digitalTwinMemoryApprovalMode="auto"` is the
// switch; a candidate auto-approves when its signalScore >= the min score.
// Default min score 0 = index ALL curator-produced candidates ("all memories").
const APPROVE_MODE = "auto";
const MIN_SCORE = Math.min(1, Math.max(0, Number(process.env["DT_AUTO_APPROVE_MIN_SCORE"] ?? 0)));

/**
 * Default target list — the @spaces (xyne-spaces) group humans, excluding the
 * xyne-doctor app account. Used when neither DT_USERS nor DT_USER_IDS is set.
 */
const DEFAULT_EMAILS: string[] = [
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
  "john.doe@gmail.com",
];

type CandidateRow = { id: string; email: string; digitalTwinEnabled: boolean; createdAt: Date };

async function resolveUserIds(): Promise<string[]> {
  const ids = (process.env["DT_USER_IDS"] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const envEmails = (process.env["DT_USERS"] ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const emails =
    envEmails.length === 0 && ids.length === 0
      ? DEFAULT_EMAILS.map((e) => e.toLowerCase())
      : envEmails;
  const out = new Set<string>(ids); // explicit ids pass through as-is
  if (emails.length > 0) {
    const rows = (await prisma.user.findMany({
      where: { email: { in: emails } },
      select: { id: true, email: true, digitalTwinEnabled: true, createdAt: true },
    })) as CandidateRow[];
    const byEmail = new Map<string, CandidateRow[]>();
    for (const r of rows) {
      const k = r.email.toLowerCase();
      const arr = byEmail.get(k);
      if (arr) arr.push(r);
      else byEmail.set(k, [r]);
    }
    for (const e of emails) {
      const cands = byEmail.get(e);
      if (!cands || cands.length === 0) {
        console.warn(`[warn] no claw_auth user for email ${e} — skipped`);
        continue;
      }
      const chosen =
        cands.find((c) => c.digitalTwinEnabled) ??
        [...cands].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]!;
      if (cands.length > 1) {
        console.warn(
          `[warn] ${e} has ${cands.length} rows — using ${chosen.id}` +
            `${chosen.digitalTwinEnabled ? " (already enabled)" : ""}, ignoring ${cands.length - 1} duplicate(s)`,
        );
      }
      out.add(chosen.id);
    }
  }
  return [...out];
}

async function main(): Promise<void> {
  const userIds = await resolveUserIds();
  if (userIds.length === 0) {
    console.error("No users. Set DT_USERS (emails) and/or DT_USER_IDS.");
    process.exit(1);
  }

  const now = new Date();
  const from = new Date(now.getTime() - MONTHS * 30 * 24 * 3600 * 1000);
  console.log(
    `Digital Twin bulk enable + backfill — ${userIds.length} user(s), ` +
      `${from.toISOString().slice(0, 10)} → ${now.toISOString().slice(0, 10)} (${MONTHS}mo), ` +
      `auto-approve=${APPROVE_MODE} (minScore=${MIN_SCORE})` +
      (DRY ? "  [DRY RUN]" : ""),
  );

  const backfillState: Record<string, unknown> = {};
  for (const s of SOURCES) {
    // cursor = LOWER bound of the next chunk. The worker walks CHRONOLOGICALLY
    // (oldest → newest) via `while (windowLower < to)` starting at `cursor`, so
    // it MUST seed at `from`. Seeding at `now` (= `to`) makes the loop exit
    // immediately → instant "complete" with 0 windows/0 records. Mirrors the
    // route-based enable in routes/digital-twin.ts.
    backfillState[s] = { from: from.toISOString(), to: now.toISOString(), cursor: from.toISOString(), complete: false };
  }

  const approveFields = {
    digitalTwinMemoryApprovalMode: APPROVE_MODE,
    digitalTwinMemoryAutoApproveMinScore: MIN_SCORE,
  };

  let enabled = 0;
  let jobs = 0;
  let approveOnly = 0;
  for (const userId of userIds) {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, digitalTwinEnabled: true },
    });
    if (!u) {
      console.warn(`[skip] no claw_auth user with id ${userId}`);
      continue;
    }

    if (u.digitalTwinEnabled) {
      if (DRY) {
        console.log(`[dry] ${u.email} already enabled — would set auto-approve (mode=${APPROVE_MODE}, minScore=${MIN_SCORE})`);
      } else {
        await prisma.user.update({ where: { id: userId }, data: approveFields });
        console.log(`[approve] ${u.email} already enabled — auto-approve set (no backfill)`);
      }
      approveOnly++;
      continue;
    }

    if (DRY) {
      console.log(`[dry] would enable ${u.email} (${userId}) + auto-approve + enqueue ${SOURCES.length} backfill jobs`);
      enabled++;
      continue;
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        digitalTwinEnabled: true,
        digitalTwinEnabledAt: now,
        digitalTwinBackfillState: backfillState as unknown as Prisma.InputJsonValue,
        ...approveFields,
      },
    });
    for (const source of SOURCES) {
      const jobId = await enqueueDigitalTwinBackfill({ userId, source, from, to: now });
      jobs++;
      console.log(`  enqueued ${jobId}`);
    }
    enabled++;
    console.log(`[ok] enabled ${u.email} (${userId}) + auto-approve`);
  }

  console.log(
    `Done${DRY ? " (dry)" : ""}: ${enabled} enabled+backfilled, ` +
      `${approveOnly} already-enabled (auto-approve set, no backfill), ` +
      `${jobs} backfill jobs enqueued. Auto-approve=${APPROVE_MODE} minScore=${MIN_SCORE} applied to all.`,
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
