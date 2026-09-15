import { Prisma } from "@prisma/client";
import { errMsg } from "../lib/errors.js";
import { prisma } from "../db.js";
import { createLogger } from "../logger.js";
import { ensureTwinBank } from "./userMemoryCuratorClient.js";
import { ensureDefaultFiles, TWIN_AGENT_SLUG } from "./agentMemoryFiles.js";
import {
  cancelDigitalTwinBackfill,
  enqueueDigitalTwinBackfill,
  type BackfillSource,
} from "../queue/digital-twin-backfill-queue.js";
import {
  BACKFILL_SOURCE_KEYS,
  type BackfillState,
  type BackfillEntryShape,
} from "./backfillStatus.js";

const log = createLogger("admin-digital-twin-control");
const MAX_BACKFILL_MONTHS = 24;

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
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    throw new AdminDigitalTwinControlError("Invalid backfill date range", 400, "INVALID_BACKFILL_WINDOW");
  }
  const earliestAllowed = new Date(to);
  earliestAllowed.setUTCMonth(earliestAllowed.getUTCMonth() - MAX_BACKFILL_MONTHS);
  if (from < earliestAllowed) {
    throw new AdminDigitalTwinControlError(
      `Backfill must span ${MAX_BACKFILL_MONTHS} months or fewer`,
      400,
      "INVALID_BACKFILL_WINDOW",
    );
  }
  return { from, to };
}

export function buildAdminBackfillState(
  window: ParsedAdminBackfillWindow,
  now = new Date(),
): BackfillState {
  const spanMs = window.to.getTime() - window.from.getTime();
  const windowsTotal = Math.max(1, Math.ceil(spanMs / (30 * 24 * 60 * 60 * 1000)));
  const nowIso = now.toISOString();
  const state: BackfillState = {};
  for (const source of BACKFILL_SOURCE_KEYS) {
    state[source] = {
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      cursor: window.from.toISOString(),
      complete: false,
      progress: {
        windowsTotal,
        windowsDone: 0,
        recordsSeen: 0,
        candidatesMade: 0,
        currentWindow: null,
        lastError: null,
        startedAt: nowIso,
        updatedAt: nowIso,
      },
    };
  }
  return state;
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
  const entries = BACKFILL_SOURCE_KEYS
    .map((source) => (raw as BackfillState)[source])
    .filter((entry): entry is BackfillEntryShape => Boolean(entry));
  if (entries.length === 0) return summarizeAdminBackfill(null);

  const incomplete = entries.filter((entry) => entry.complete !== true);
  const allPaused = incomplete.length > 0 && incomplete.every((entry) => Boolean(entry.pausedAt));
  const lastError = entries
    .map((entry) => entry.progress?.lastError?.message ?? null)
    .find((message): message is string => Boolean(message)) ?? null;
  const windowsDone = entries.reduce((sum, entry) => sum + (entry.progress?.windowsDone ?? 0), 0);
  const windowsTotal = entries.reduce((sum, entry) => sum + (entry.progress?.windowsTotal ?? 0), 0);

  return {
    status: lastError ? "error" : incomplete.length === 0 ? "complete" : allPaused ? "paused" : "running",
    from: entries.map((entry) => entry.from).filter((value): value is string => Boolean(value)).sort()[0] ?? null,
    to: entries.map((entry) => entry.to).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null,
    progressPct: windowsTotal > 0 ? Math.min(100, Math.round((windowsDone * 100) / windowsTotal)) : null,
    recordsSeen: entries.reduce((sum, entry) => sum + (entry.progress?.recordsSeen ?? 0), 0),
    candidatesMade: entries.reduce((sum, entry) => sum + (entry.progress?.candidatesMade ?? 0), 0),
    lastError,
  };
}

async function requireTargetUser(userId: string): Promise<void> {
  const exists = await prisma.user.count({ where: { id: userId } });
  if (exists === 0) {
    throw new AdminDigitalTwinControlError("User not found", 404, "USER_NOT_FOUND");
  }
}

async function enqueueBackfillForAllSources(
  userId: string,
  window: ParsedAdminBackfillWindow,
): Promise<string[]> {
  const jobIds: string[] = [];
  for (const source of BACKFILL_SOURCE_KEYS as readonly BackfillSource[]) {
    jobIds.push(await enqueueDigitalTwinBackfill({ userId, source, ...window }));
  }
  return jobIds;
}

export async function adminEnableDigitalTwin(input: {
  userId: string;
  backfill?: AdminBackfillWindowInput | null;
}): Promise<{ enabledAt: Date; backfillJobIds: string[] }> {
  await requireTargetUser(input.userId);
  const now = new Date();
  const window = input.backfill ? parseAdminBackfillWindow(input.backfill, now) : null;
  const state = window ? buildAdminBackfillState(window, now) : null;

  await cancelDigitalTwinBackfill(input.userId);
  await prisma.user.update({
    where: { id: input.userId },
    data: {
      digitalTwinEnabled: true,
      digitalTwinEnabledAt: now,
      digitalTwinBackfillState: state
        ? (state as unknown as Prisma.InputJsonValue)
        : (Prisma.JsonNull as unknown as Prisma.NullableJsonNullValueInput),
    },
  });

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
  const cancelledJobs = await cancelDigitalTwinBackfill(userId);
  await prisma.user.update({
    where: { id: userId },
    data: {
      digitalTwinEnabled: false,
      digitalTwinBackfillState: Prisma.JsonNull as unknown as Prisma.NullableJsonNullValueInput,
    },
  });
  return { cancelledJobs };
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
  const state = buildAdminBackfillState(window);
  await cancelDigitalTwinBackfill(input.userId);
  await prisma.user.update({
    where: { id: input.userId },
    data: { digitalTwinBackfillState: state as unknown as Prisma.InputJsonValue },
  });
  await ensureTwinBank();
  return { backfillJobIds: await enqueueBackfillForAllSources(input.userId, window) };
}
