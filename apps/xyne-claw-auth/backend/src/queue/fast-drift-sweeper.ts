import { prisma } from "../db.js";
import { createLogger } from "../logger.js";
import { errMsg } from "../lib/errors.js";
import { detectDrift, hourBucket, type DriftAlert } from "../lib/fast-subagent-ops.js";

const log = createLogger("fast-drift-sweeper");
const SWEEP_MS = Math.max(60_000, Number(process.env["FAST_DRIFT_SWEEP_MS"]) || 1_800_000);
const DAY_MS = 86_400_000;

let timer: NodeJS.Timeout | undefined;
let sweeping = false;

export async function runDriftCheck(orgId?: string, now = Date.now()): Promise<Array<DriftAlert & { orgId: string; id: string }>> {
  const org = orgId ? { orgId } : {};
  const rows = await prisma.fastSubagentCall.findMany({
    where: { ...org, completedAt: { gte: new Date(now - 8 * DAY_MS) } },
    select: { orgId: true, subagentName: true, completedAt: true, xorAnswers: true, xorUnsure: true, xorItems: true, xorUnavailable: true },
    take: 200_000,
  });
  const reviews = await prisma.xorReviewSample.findMany({
    where: { ...org, verdict: { not: null }, reviewedAt: { gte: new Date(now - 7 * DAY_MS) } },
    select: { orgId: true, subagentName: true, verdict: true, reviewedAt: true },
    take: 50_000,
  });
  const orgs = new Set([...rows.map((r) => r.orgId), ...reviews.map((r) => r.orgId)]);
  const bucket = hourBucket(now);
  const created: Array<DriftAlert & { orgId: string; id: string }> = [];
  for (const o of orgs) {
    const alerts = detectDrift(rows.filter((r) => r.orgId === o), reviews.filter((r) => r.orgId === o), now);
    if (alerts.length === 0) continue;
    const inserted = await prisma.fastSubagentAlert.createManyAndReturn({
      data: alerts.map((a) => ({ orgId: o, bucket, ...a })),
      skipDuplicates: true,
      select: { id: true, subagentName: true, kind: true },
    });
    for (const row of inserted) {
      const a = alerts.find((x) => x.subagentName === row.subagentName && x.kind === row.kind)!;
      log.warn(`[fast-drift] ${a.message}`, { event: "fast_subagent_drift", orgId: o, subagent: a.subagentName, kind: a.kind, baseline: a.baseline, current: a.current });
      created.push({ ...a, orgId: o, id: row.id });
    }
  }
  return created;
}

async function sweep(): Promise<void> {
  if (sweeping) return;
  sweeping = true;
  try {
    await runDriftCheck();
  } catch (err) {
    log.warn(`[fast-drift] sweep failed: ${errMsg(err)}`);
  } finally {
    sweeping = false;
  }
}

export function initFastDriftSweeper(): void {
  if (timer) return;
  timer = setInterval(() => void sweep(), SWEEP_MS);
  timer.unref();
  log.info("[fast-drift] Worker started");
}

export async function closeFastDriftSweeper(): Promise<void> {
  if (!timer) return;
  clearInterval(timer);
  timer = undefined;
}
