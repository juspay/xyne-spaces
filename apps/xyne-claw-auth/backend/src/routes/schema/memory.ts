/**
 * Wire contracts for the routes in memory.ts.
 */
import { z } from "zod";
import { DIGITAL_TWIN_SLUG } from "xyne-claw-shared";
import { MEMORY_FILE_NAME_RE } from "../../services/agentMemoryFiles.js";
import { identifier, nonBlankString, pageLimit, pageOffset } from "./common.js";

/** Records accepted per import request. */
export const IMPORT_MAX_RECORDS = Math.max(1, Number(process.env["MEMORY_IMPORT_MAX_RECORDS"] ?? 50));

const trimmed = z.string().trim();
/** Agent slug from a query or body; blank or absent means the digital twin. */
const slugOrTwin = trimmed.optional().transform((value) => value || DIGITAL_TWIN_SLUG);
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: "must be YYYY-MM-DD" });

// ── Params ──────────────────────────────────────────────────────────────────

export const agentSlugParams = z.object({ agentSlug: identifier });
export const memoryIdParams = z.object({ agentSlug: identifier, hindsightMemoryId: identifier });
export const subsystemParams = z.object({
  agentSlug: identifier,
  subsystem: trimmed.toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { error: "Invalid subsystem name" }),
});
export const backfillJobParams = z.object({ agentSlug: identifier, jobId: identifier });
export const idParams = z.object({ id: identifier });

// ── Query ───────────────────────────────────────────────────────────────────

export const userFileQuery = z.object({
  userId: trimmed.default(""),
  agentSlug: slugOrTwin,
  name: trimmed.default(""),
  candidates: z.string().optional(),
});

export const reviewsQuery = z.object({
  agentSlug: identifier.optional(),
  status: z.enum(["pending", "approved", "rejected"]).default("pending"),
  limit: pageLimit(20, 100),
  offset: pageOffset,
});

export const memoriesQuery = z.object({
  scope: z.enum(["user", "shared"]).optional(),
  search: trimmed.max(1_000).optional(),
  subsystem: trimmed.max(128).optional(),
  userTag: trimmed.optional(),
  limit: pageLimit(50, 200),
  offset: pageOffset,
});

export const statsQuery = z.object({
  range: z.enum(["7d", "30d", "90d"]).default("7d"),
  userTag: trimmed.optional(),
});

export const userTagQuery = z.object({ userTag: trimmed.optional() });

export const batchesQuery = z.object({
  agentSlug: identifier.optional(),
  status: z.string().max(32).optional(),
  limit: pageLimit(20, 100),
  offset: pageOffset,
});

// ── Body ────────────────────────────────────────────────────────────────────

export const agentFileWriteBody = z.object({
  agentSlug: slugOrTwin,
  userId: trimmed.min(1),
  name: trimmed.regex(MEMORY_FILE_NAME_RE, { error: "invalid file name" }),
  content: nonBlankString,
  mode: z.enum(["append", "replace"]).default("append"),
});

export const reviewActionBody = z.object({ action: z.enum(["approve", "reject"]) });

export const optionalAgentBody = z.object({ agentSlug: identifier.optional() });

export const retentionSweepBody = z.object({
  dryRun: z.boolean().default(true),
  maxInvalidations: z.number().int().min(1).optional(),
});

export const recallBody = z.object({
  query: nonBlankString,
  scope: z.enum(["user", "shared"]).optional(),
  userId: identifier.optional(),
  budget: z.enum(["low", "mid", "high"]).default("low"),
});

const importRecord = z.object({
  content: z.string().nullish(),
  subsystem: z.string().nullish(),
  timestamp: z.string().nullish(),
  entities: z.array(z.string()).nullish(),
});

export const importBody = z.object({
  records: z.array(importRecord).min(1).max(IMPORT_MAX_RECORDS),
  mode: z.enum(["verbatim", "extract"]).default("verbatim"),
});

export const uploadMdBody = z.object({
  filename: trimmed.min(1),
  content: trimmed.min(1).max(200_000),
});

export const uploadSessionBody = z.object({
  filename: trimmed.min(1),
  content: trimmed.min(1).max(20_000_000),
  source: z.enum(["claude", "opencode", "codex"]).default("claude"),
});

export const batchApproveBody = z.object({ sessionIds: z.array(identifier).optional() });

const recallHit = z.object({
  agentSlug: identifier,
  hindsightMemoryId: identifier,
  userId: identifier,
  sessionId: identifier,
  scope: identifier,
  rank: z.number().nullish(),
  recalledAt: z.string().refine((value) => Number.isFinite(Date.parse(value)), { error: "invalid date" }),
});

export const recallHitsBody = z.object({ hits: z.array(recallHit).max(1_000) });

export const backfillBody = z
  .object({
    from: isoDay.optional(),
    to: isoDay.optional(),
    days: z.number().int().min(1).max(30).default(7),
  })
  .refine((body) => Boolean(body.from) === Boolean(body.to), { error: "'from' and 'to' go together" });

export const enableBody = z.object({
  sharedAllowed: z.boolean().optional(),
  approvalStrategy: z.enum(["HUMAN_ONLY", "EVALS_ONLY", "EVALS_THEN_HUMAN"]).optional(),
});
