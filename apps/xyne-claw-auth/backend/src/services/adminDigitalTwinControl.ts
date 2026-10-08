import { errMsg } from "../lib/errors.js";
import { prisma } from "../db.js";
import { createLogger } from "../logger.js";
import { ensureTwinBank } from "./twinMemoryBank.js";
import { ensureDefaultFiles, TWIN_AGENT_SLUG } from "./agentMemoryFiles.js";
import { cancelDigitalTwinBackfill } from "../queue/digital-twin-backfill-queue.js";
import { disableTwin, enqueueBackfillForAllSources, writeBackfillState } from "./digitalTwinLifecycle.js";
import {
  BACKFILL_SOURCES,
  MAX_BACKFILL_MONTHS,
  backfillRangeProblem,
  buildBackfillState,
  type BackfillState,
  type BackfillEntryShape,
} from "./digitalTwinBackfillState.js";

const log = createLogger("admin-digital-twin-control");

export interface AdminBackfillWindowInput {
  from: string;
  to?: string;
}

export interface ParsedAdminBackfillWindow {
  from: Date;
  to: Date;
}

export class AdminDigitalTwinControlError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "AdminDigitalTwinControlError";
  }
}

export function parseAdminBackfillWindow(
  input: AdminBackfillWindowInput,
  now = new Date(),
): ParsedAdminBackfillWindow {
  if (!input || typeof input.from !== "string" || !input.from.trim()) {
    throw new AdminDigitalTwinControlError("backfill.from is required", 400, "INVALID_BACKFILL_WINDOW");
  }
  if (input.to != null && typeof input.to !== "string") {
    throw new AdminDigitalTwinControlError("backfill.to must be an ISO date", 400, "INVALID_BACKFILL_WINDOW");
  }

  const from = new Date(input.from);
  const to = input.to ? new Date(input.to) : now;
  const problem = backfillRangeProblem(from, to);
  if (problem) {
    throw new AdminDigitalTwinControlError(
      problem === "invalid"
        ? "Invalid backfill date range"
        : `Backfill must span ${MAX_BACKFILL_MONTHS} months or fewer`,
      400,
      "INVALID_BACKFILL_WINDOW",
    );
  }
  return { from, to };
}

export interface AdminBackfillSummary {
  status: "not_started" | "running" | "paused" | "complete" | "error";
  from: string | null;
  to: string | null;
  progressPct: number | null;
  recordsSeen: number;
  candidatesMade: number;
  lastError: string | null;
}

export function summarizeAdminBackfill(raw: unknown): AdminBackfillSummary {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      status: "not_started",
      from: null,
      to: null,
      progressPct: null,
      recordsSeen: 0,
      candidatesMade: 0,
      lastError: null,
    };
  }
  const entries = BACKFILL_SOURCES
    .map((source) => (raw as BackfillState)[source])
    .filter((entry): entry is BackfillEntryShape => Boolean(entry));
  if (entries.length === 0) return summarizeAdminBackfill(null);

  const incomplete = entries.filter((entry) => entry.complete !== true);
  const allPaused = incomplete.length > 0 && incomplete.every((entry) => Boolean(entry.pausedAt));
  const lastError = entries
    .map((entry) => entry.progress?.lastError?.message ?? null)
    .find((message): message is string => Boolean(message)) ?? null;
  const sum = (pick: (e: BackfillEntryShape) => number | undefined) => entries.reduce((n, e) => n + (pick(e) ?? 0), 0);
  const windowsDone = sum((e) => e.progress?.windowsDone);
  const windowsTotal = sum((e) => e.progress?.windowsTotal);

  return {
    status: lastError ? "error" : incomplete.length === 0 ? "complete" : allPaused ? "paused" : "running",
    from: entries.map((entry) => entry.from).filter((value): value is string => Boolean(value)).sort()[0] ?? null,
    to: entries.map((entry) => entry.to).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null,
    progressPct: windowsTotal > 0 ? Math.min(100, Math.round((windowsDone * 100) / windowsTotal)) : null,
    recordsSeen: sum((e) => e.progress?.recordsSeen),
    candidatesMade: sum((e) => e.progress?.candidatesMade),
    lastError,
  };
}

async function requireTargetUser(userId: string): Promise<void> {
  const exists = await prisma.user.count({ where: { id: userId } });
  if (exists === 0) {
    throw new AdminDigitalTwinControlError("User not found", 404, "USER_NOT_FOUND");
  }
}

export async function adminEnableDigitalTwin(input: {
  userId: string;
  backfill?: AdminBackfillWindowInput | null;
}): Promise<{ enabledAt: Date; backfillJobIds: string[] }> {
  await requireTargetUser(input.userId);
  const now = new Date();
  const window = input.backfill ? parseAdminBackfillWindow(input.backfill, now) : null;
  const state = window ? buildBackfillState(window, now) : null;

  await cancelDigitalTwinBackfill(input.userId);
  await writeBackfillState(input.userId, state, { digitalTwinEnabled: true, digitalTwinEnabledAt: now });

  await ensureTwinBank();
  await ensureDefaultFiles(TWIN_AGENT_SLUG, input.userId).catch((error) => {
    log.warn("Failed to seed default Digital Twin files during admin enable", {
      userId: input.userId,
      error: errMsg(error),
    });
  });

  return {
    enabledAt: now,
    backfillJobIds: window ? await enqueueBackfillForAllSources(input.userId, window) : [],
  };
}

export async function adminDisableDigitalTwin(userId: string): Promise<{ cancelledJobs: number }> {
  await requireTargetUser(userId);
  return { cancelledJobs: await disableTwin(userId) };
}

export async function adminStartDigitalTwinBackfill(input: {
  userId: string;
  backfill: AdminBackfillWindowInput;
}): Promise<{ backfillJobIds: string[] }> {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { digitalTwinEnabled: true },
  });
  if (!user) throw new AdminDigitalTwinControlError("User not found", 404, "USER_NOT_FOUND");
  if (!user.digitalTwinEnabled) {
    throw new AdminDigitalTwinControlError(
      "Enable Digital Twin before starting a backfill",
      409,
      "DIGITAL_TWIN_DISABLED",
    );
  }

  const window = parseAdminBackfillWindow(input.backfill);
  const state = buildBackfillState(window, new Date());
  await cancelDigitalTwinBackfill(input.userId);
  await writeBackfillState(input.userId, state);
  await ensureTwinBank();
  return { backfillJobIds: await enqueueBackfillForAllSources(input.userId, window) };
}
