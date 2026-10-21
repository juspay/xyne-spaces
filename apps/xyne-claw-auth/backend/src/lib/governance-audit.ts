/**
 * The governance audit stream: one row per decision, inserted plain and hash-chained per org by a
 * background sequencer, so the hot path never waits for the chain. Side-effect events are written
 * synchronously (a failure must refuse the call); everything else is batched once a second.
 */
import { createHmac } from "node:crypto";
import type { GovernanceAuditEvent, Prisma } from "@prisma/client";
import { canonicalJson, sha256Hex } from "xyne-claw-shared/governance";
import { governanceAuditEventRepository as repo } from "../repositories/governanceRepository.js";
import { gcsService } from "../services/storageService.js";
import { createLogger } from "../logger.js";

const log = createLogger("governance-audit");

export const GOVERNANCE_EVENT_TYPES = [
  "content_scan", "content_finding", "tool_call", "approval_requested", "approval_decided", "approval_expired",
  "kill_switch_set", "kill_switch_enforced", "kill_switch_cleared", "admin_override", "version_status_changed",
  "config_changed", "run_started",
] as const;
export type GovernanceEventType = (typeof GOVERNANCE_EVENT_TYPES)[number];
export const ACTOR_KINDS = ["user", "agent", "system", "admin"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

type Nullable<T> = { [K in keyof T]?: T[K] | null | undefined };
export type GovernanceEventInput = {
  orgId: string;
  eventType: GovernanceEventType;
  actorKind?: ActorKind | undefined;
  occurredAt?: Date | string | undefined;
} & Nullable<
  Pick<
    GovernanceAuditEvent,
    | "actorId" | "onBehalfOfUserId" | "actorIp" | "actorUserAgent" | "subjectKind" | "subjectId" | "contentSha256Before"
    | "contentSha256After" | "agentId" | "runId" | "conversationId" | "toolCallId" | "mcpServerId" | "toolName" | "traceId"
    | "spanId" | "decision" | "reasonCode" | "reasonText" | "policyVersion" | "scannerVersion" | "matchedRuleIds"
    | "findingIds" | "checkTierReached" | "parserMs" | "judgeMs" | "gateMs" | "outcome" | "toolEffect" | "destinationKind"
    | "destinationHost" | "riskLevelAtCall" | "carriedPrivateData" | "argumentsRedacted" | "approvalId" | "loadedVersionIds"
  >
>;

const QUEUE_CAP = 10_000;
const FLUSH_MS = 1_000;
const SEQUENCER_MS = 2_000;
const CHECKPOINT_MS = 5 * 60_000;
const BATCH = 500;
const LAG_WARN_MS = 60_000;

/** Prisma's create inputs take null but not undefined for an absent column. */
export function withoutUndefined<T extends object>(o: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as { [K in keyof T]: Exclude<T[K], undefined> };
}

function toRow(e: GovernanceEventInput): Prisma.GovernanceAuditEventCreateManyInput {
  const { occurredAt, actorKind, matchedRuleIds, findingIds, loadedVersionIds, ...rest } = withoutUndefined(e);
  return {
    ...(rest as Omit<Prisma.GovernanceAuditEventCreateManyInput, "occurredAt" | "actorKind">),
    occurredAt: occurredAt ? new Date(occurredAt) : new Date(),
    actorKind: actorKind ?? "system",
    matchedRuleIds: matchedRuleIds ?? [],
    findingIds: findingIds ?? [],
    loadedVersionIds: loadedVersionIds ?? [],
  };
}

/** Writes before the side effect runs; a throw means the caller must refuse with "audit unavailable". */
export async function recordGovernanceEvent(e: GovernanceEventInput): Promise<GovernanceAuditEvent> {
  return repo.create(toRow(e));
}

const queue: GovernanceEventInput[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let dropped = 0;

export function queueGovernanceEvent(e: GovernanceEventInput): void {
  if (queue.length >= QUEUE_CAP) {
    queue.shift();
    dropped++;
  }
  queue.push(e);
  if (!flushTimer) flushTimer = setTimeout(() => void flushGovernanceEvents(), FLUSH_MS).unref();
}

export async function flushGovernanceEvents(): Promise<number> {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  const batch = queue.splice(0, queue.length);
  if (batch.length === 0) return 0;
  try {
    await repo.createMany(batch.map(toRow));
  } catch (err) {
    dropped += batch.length;
    log.error(`[governance-audit] dropped ${batch.length} queued events (${dropped} total):`, err);
    return 0;
  }
  return batch.length;
}

export const governanceQueueStats = (): { pending: number; dropped: number } => ({ pending: queue.length, dropped });

const HASHED = [
  "id", "orgId", "eventType", "occurredAt", "orgSequence", "previousRowSha256", "actorKind", "actorId", "onBehalfOfUserId",
  "actorIp", "actorUserAgent", "subjectKind", "subjectId", "contentSha256Before", "contentSha256After", "agentId", "runId",
  "conversationId", "toolCallId", "mcpServerId", "toolName", "traceId", "spanId", "decision", "reasonCode", "reasonText",
  "policyVersion", "scannerVersion", "matchedRuleIds", "findingIds", "checkTierReached", "parserMs", "judgeMs", "gateMs",
  "outcome", "toolEffect", "destinationKind", "destinationHost", "riskLevelAtCall", "carriedPrivateData", "argumentsRedacted",
  "approvalId", "loadedVersionIds",
] as const;

/** Every decision field is inside the hash; only createdAt (set by the database) and the hash itself are outside. */
export function auditRowSha256(row: GovernanceAuditEvent, orgSequence: number, previousRowSha256: string | null): string {
  const fields: Record<string, unknown> = {};
  for (const k of HASHED) fields[k] = row[k];
  fields["orgSequence"] = orgSequence;
  fields["previousRowSha256"] = previousRowSha256;
  fields["occurredAt"] = row.occurredAt.toISOString();
  return sha256Hex(canonicalJson(fields));
}

const chainedOrgs = new Set<string>();

/** Assigns sequence numbers and hashes to one org's unchained rows, oldest first. Returns rows chained. */
export async function chainPendingEvents(orgId: string): Promise<number> {
  const last = await repo.lastChained(orgId);
  let sequence = last?.orgSequence ?? 0;
  let previous = last?.rowSha256 ?? null;
  let done = 0;
  for (;;) {
    const rows = await repo.unchained(orgId, BATCH);
    if (rows.length === 0) return done;
    const lag = Date.now() - rows[0]!.occurredAt.getTime();
    if (lag > LAG_WARN_MS) log.warn(`[governance-audit] chain lag ${Math.round(lag / 1000)}s for org ${orgId}`);
    for (const row of rows) {
      const hash = auditRowSha256(row, sequence + 1, previous);
      const { count } = await repo.chain(row.id, sequence + 1, previous, hash);
      if (count === 0) return done;
      sequence++;
      previous = hash;
      done++;
      chainedOrgs.add(orgId);
    }
    if (rows.length < BATCH) return done;
  }
}

export type ChainProblem = { sequence: number; kind: "gap" | "previous_mismatch" | "hash_mismatch" };
export interface ChainVerification {
  ok: boolean;
  checked: number;
  lastSequence: number;
  lastRowSha256: string | null;
  problem?: ChainProblem;
}

/** Re-checks contiguity, links and hashes from a sequence (a checkpoint, or 1 for the whole chain). */
export async function verifyAuditChain(orgId: string, fromSequence = 1, previousRowSha256: string | null = null): Promise<ChainVerification> {
  let expected = fromSequence;
  let previous = previousRowSha256;
  let checked = 0;
  for (;;) {
    const rows = await repo.chained(orgId, expected, BATCH);
    for (const row of rows) {
      const seq = row.orgSequence ?? -1;
      const problem = (kind: ChainProblem["kind"]): ChainVerification => ({
        ok: false, checked, lastSequence: expected - 1, lastRowSha256: previous, problem: { sequence: seq, kind },
      });
      if (seq !== expected) return problem("gap");
      if (row.previousRowSha256 !== previous) return problem("previous_mismatch");
      if (row.rowSha256 !== auditRowSha256(row, seq, previous)) return problem("hash_mismatch");
      expected++;
      previous = row.rowSha256;
      checked++;
    }
    if (rows.length < BATCH) return { ok: true, checked, lastSequence: expected - 1, lastRowSha256: previous };
  }
}

export interface AuditCheckpoint {
  orgId: string;
  lastSequence: number;
  lastRowSha256: string;
  takenAt: string;
  signature: string;
}

const checkpointKey = (): string => process.env["GOVERNANCE_CHECKPOINT_KEY"] ?? process.env["ENCRYPTION_KEY"] ?? "";

export function signCheckpoint(body: Omit<AuditCheckpoint, "signature">): string {
  return createHmac("sha256", checkpointKey()).update(canonicalJson(body)).digest("hex");
}

export async function buildAuditCheckpoint(orgId: string): Promise<AuditCheckpoint | null> {
  const last = await repo.lastChained(orgId);
  if (!last?.orgSequence || !last.rowSha256) return null;
  const body = { orgId, lastSequence: last.orgSequence, lastRowSha256: last.rowSha256, takenAt: new Date().toISOString() };
  return { ...body, signature: signCheckpoint(body) };
}

// Write-once storage is the bucket's retention policy; the verifier restarts from the newest checkpoint it finds.
async function writeAuditCheckpoints(): Promise<void> {
  if (!checkpointKey()) return;
  for (const orgId of chainedOrgs) {
    const cp = await buildAuditCheckpoint(orgId).catch(() => null);
    if (!cp) continue;
    const path = `governance/audit-checkpoints/${orgId}/${cp.takenAt}.json`;
    await gcsService.uploadFile(Buffer.from(JSON.stringify(cp)), path, "application/json").catch((err) => {
      log.warn(`[governance-audit] checkpoint for org ${orgId} not stored:`, err instanceof Error ? err.message : err);
    });
  }
}

let sequencerTimer: NodeJS.Timeout | null = null;
let checkpointTimer: NodeJS.Timeout | null = null;
let ticking = false;

async function sequencerTick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    for (const { orgId } of await repo.orgsWithUnchained()) await chainPendingEvents(orgId);
  } catch (err) {
    // A unique-key clash is the other pod winning the same batch; the next tick re-reads the chain head.
    log.warn("[governance-audit] sequencer tick failed:", err instanceof Error ? err.message : err);
  } finally {
    ticking = false;
  }
}

export function startGovernanceSequencer(): void {
  if (sequencerTimer) return;
  sequencerTimer = setInterval(() => void sequencerTick(), SEQUENCER_MS);
  sequencerTimer.unref();
  checkpointTimer = setInterval(() => void writeAuditCheckpoints(), CHECKPOINT_MS);
  checkpointTimer.unref();
}

export async function stopGovernanceSequencer(): Promise<void> {
  if (sequencerTimer) clearInterval(sequencerTimer);
  if (checkpointTimer) clearInterval(checkpointTimer);
  sequencerTimer = checkpointTimer = null;
  await flushGovernanceEvents();
}
