/**
 * People-KB findings — the contract between extraction and merge.
 *
 * The extractor agent emits these through `emit-finding` (apps/xyne-claw), which
 * validates each one and flushes the batch to object storage. The merge job
 * (apps/xyne-claw-auth/services/kbMergeDaily) reads them back and hands them to
 * the merge agent, which turns them into KB pages.
 *
 * The far consumer is a PROMPT, which never complains: rename a field and the
 * agent silently does something plausible instead of failing. Nothing else in
 * the stack has that property, so the shape lives here — both sides import it
 * and break at compile time — and `validateFinding` rejects malformed
 * observations at the tool boundary, the last point where the model can still
 * be told to fix them.
 *
 * Serialised as JSONL, one self-contained observation per line. Object storage
 * has no append, so each extraction session writes its OWN object under
 * people-kb/findings/dt=<conversation date>/<CODE>/<sessionId>.jsonl. Sessions
 * run concurrently, so no line may depend on another, and a truncated final
 * line costs one observation rather than the file.
 *
 * Partitioned by when the CONVERSATION happened, not when extraction ran: a
 * backfill spans months, and filing it under the run date would collapse it
 * into one prefix, leaving the merge unable to process days in order.
 */

/**
 * Bump when a field changes meaning.
 *
 * Checked by validateFinding when a finding is emitted, so a mismatch fails
 * loudly at write time. Nothing re-validates on the read side — findings in
 * storage are trusted, which is why the write-side check has to be strict.
 *
 * 2: modes became observations. See FindingMode.
 */
export const FINDINGS_SCHEMA_VERSION = 2;

/**
 * How a person relates to an entity — what was OBSERVED, never what it means.
 *
 * Every value has to be pointable-at in the quote. "Is this in the text?" has an
 * answer; "does this person own vespa?" does not. The previous set asked for the
 * second kind: OWNS was a verdict nobody states out loud, so it landed on
 * whoever sounded most confident — which is exactly the assertive passer-by we
 * were trying to tell apart from the actual owner. Nothing could catch it either,
 * because there was no quote to check it against.
 *
 * OWNS is now a CONCLUSION, drawn by reconcile once a signal has repeated across
 * distinct threads. It is never emitted.
 *
 * Roughly by weight:
 *   DEFERRED_TO        someone else named them — third-party, so the strongest
 *   RESOLVED           their message ended it / they closed the ticket
 *   CORRECTED          they overrode someone else's answer
 *   ANSWERED           gave a substantive answer
 *   CLAIMED_OWNERSHIP  said it themselves — self-reported, needs corroboration
 *   REVIEWED           ticket reviewer role, structural rather than conversational
 *   ASKED              asked about it — evidence AGAINST expertise
 *
 * DEFERRED_TO vs CLAIMED_OWNERSHIP is the pair that matters: the org pointing at
 * someone, versus someone pointing at themselves. Both used to collapse into OWNS.
 */
export type FindingMode =
  | "DEFERRED_TO"
  | "RESOLVED"
  | "CORRECTED"
  | "ANSWERED"
  | "CLAIMED_OWNERSHIP"
  | "REVIEWED"
  | "ASKED";

/**
 * Routed to a KB root by the merge: SERVICE -> services/, SURFACE -> surfaces/,
 * TOOL -> tools/.
 *
 * PRACTICE is gone: the practices/ folder was dropped because nothing in the
 * findings reliably produced one, which left those findings with no home at all.
 */
export type FindingEntityKind = "SERVICE" | "SURFACE" | "TOOL";

/**
 * The value sets a finding is checked against.
 *
 * Supplied per-run rather than fixed here, because these are the taxonomy — the
 * part worth experimenting with. Pinning them in a shipped package meant a new
 * mode cost a package bump and a redeploy of both services, while the prompt
 * beside it was a DB column editable from the UI. Now both live on the agent row.
 *
 * Only the vocabulary is configurable. Everything else validateFinding checks is
 * structural — it is what makes findings joinable, and not a matter of opinion.
 */
export interface FindingVocabulary {
  entityKinds: readonly string[];
  modes: readonly string[];
}

export const DEFAULT_FINDING_VOCABULARY: FindingVocabulary = {
  entityKinds: ["SERVICE", "SURFACE", "TOOL"],
  modes: [
    "DEFERRED_TO",
    "RESOLVED",
    "CORRECTED",
    "ANSWERED",
    "CLAIMED_OWNERSHIP",
    "REVIEWED",
    "ASKED",
  ],
};

/**
 * The project a finding belongs to.
 *
 * Supplied by the extraction pipeline via `findingScope`, closed over by
 * emit-finding — the model never chooses it. A batch is dispatched for one
 * channel of one project, so the project is known before the model sees a
 * single message.
 *
 * All three identifiers travel together because they do different jobs — `code`
 * paths the KB folder (stable, readable, and unmovable once written), `id`
 * resolves back to the live record, `name` is what a human reads.
 */
export interface FindingProject {
  id: string;
  /** Short stable code, e.g. "XYNE". Unique per workspace; used as the KB path segment. */
  code: string;
  name: string;
}

export interface FindingSource {
  type: "CHAT_THREAD" | "TICKET";
  project: FindingProject;
  /** Deep link to the thread or ticket. Every claim in the KB cites this. */
  permalink: string;
  /** When the conversation happened — NOT when it was extracted. Backfills would otherwise all look fresh. */
  occurredAt: string;

  // CHAT_THREAD
  scopeType?: string;
  scopeId?: string;
  threadId?: string;
  messageIds?: string[];

  // TICKET
  ticketKey?: string;
  ticketState?: string;
  boardId?: string;
  /** The person's relationship to the ticket, e.g. ASSIGNEE / REVIEWER. */
  role?: string;
}

export interface FindingPerson {
  userId: string;
  displayName: string;
  email?: string;
}

export interface FindingEntity {
  kind: FindingEntityKind;
  /** Lowercase, hyphenated, singular — this becomes a KB folder name. */
  name: string;
}

export interface FindingEvidence {
  /** Verbatim quote. What makes a KB claim auditable rather than an assertion. */
  quote: string;
  /** Message id or ticket field the quote came from. */
  ref?: string;
}

export interface Finding {
  schemaVersion: number;
  observationId: string;
  /** When extraction ran. Distinct from `source.occurredAt`. */
  emittedAt: string;
  workspaceId: string;

  producer: {
    sessionId: string;
    agentSlug: string;
    model: string;
  };

  source: FindingSource;
  entity: FindingEntity;

  /**
   * What was learned, standing on its own.
   *
   * Optional person: some of the most valuable facts have no clear owner
   * ("job.discard() kills retries" is true regardless of who noticed). Forcing
   * every fact through a person would drop those entirely.
   */
  claim?: string;
  person?: FindingPerson;
  /** What was observed, not what it means. Standing is reconcile's call. */
  mode?: FindingMode;

  evidence: FindingEvidence;
  /** 0–1. The merge skips anything below 0.5 as too weak to record as expertise. */
  confidence: number;

  /**
   * `<threadId|ticketKey>:<userId>:<entity>:<mode>` — stable across re-runs, so
   * re-extracting a window produces the same keys. That is what makes a backfill
   * or a retried window safe.
   *
   * A repeat is CONFIRMATION, not noise: the merge bumps the claim's `last` and
   * `seen` markers rather than discarding it, which is how a fact is known to
   * still be current.
   */
  idempotencyKey: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Validates one parsed JSONL line.
 *
 * `vocabulary` supplies the accepted kinds and modes; everything else checked
 * here is structural and fixed. Returns the reason on failure rather than
 * throwing: a malformed observation should be logged and skipped, never fail the
 * batch around it.
 */
export function validateFinding(
  value: unknown,
  vocabulary: FindingVocabulary = DEFAULT_FINDING_VOCABULARY,
): { ok: true; finding: Finding } | { ok: false; reason: string } {
  const f = value as Partial<Finding> | null;
  if (!f || typeof f !== "object") return { ok: false, reason: "not an object" };

  if (f.schemaVersion !== FINDINGS_SCHEMA_VERSION) {
    return { ok: false, reason: `unsupported schemaVersion ${String(f.schemaVersion)}` };
  }
  if (!isNonEmptyString(f.observationId)) return { ok: false, reason: "observationId missing" };
  if (!isNonEmptyString(f.idempotencyKey)) return { ok: false, reason: "idempotencyKey missing" };

  const source = f.source;
  if (!source || typeof source !== "object") return { ok: false, reason: "source missing" };
  if (!isNonEmptyString(source.permalink)) return { ok: false, reason: "source.permalink missing" };
  if (!isNonEmptyString(source.occurredAt)) return { ok: false, reason: "source.occurredAt missing" };

  // The KB path segment. An invented or empty code strands a whole night's
  // findings in an orphan tree that cannot be moved afterwards.
  if (!source.project || !isNonEmptyString(source.project.code)) {
    return { ok: false, reason: "source.project.code missing" };
  }
  if (!isNonEmptyString(source.project.id)) return { ok: false, reason: "source.project.id missing" };

  const entity = f.entity;
  if (!entity || !isNonEmptyString(entity.name)) return { ok: false, reason: "entity.name missing" };
  if (!vocabulary.entityKinds.includes(entity.kind as string)) {
    return {
      ok: false,
      reason: `unknown entity.kind ${String(entity.kind)} — expected one of ${vocabulary.entityKinds.join(", ")}`,
    };
  }
  if (entity.name !== entity.name.toLowerCase()) {
    return { ok: false, reason: `entity.name must be lowercase: ${entity.name}` };
  }

  if (!f.evidence || !isNonEmptyString(f.evidence.quote)) {
    return { ok: false, reason: "evidence.quote missing" };
  }
  if (typeof f.confidence !== "number" || f.confidence < 0 || f.confidence > 1) {
    return { ok: false, reason: `confidence out of range: ${String(f.confidence)}` };
  }

  // A person without an id cannot be resolved back to a user record, and
  // display names collide — so half a person is worse than none.
  if (f.person && !isNonEmptyString(f.person.userId)) {
    return { ok: false, reason: "person.userId missing" };
  }
  if (f.mode !== undefined && !vocabulary.modes.includes(f.mode)) {
    return {
      ok: false,
      reason: `unknown mode ${String(f.mode)} — expected one of ${vocabulary.modes.join(", ")}`,
    };
  }
  // A finding needs to say something: either a fact, or who relates to what.
  if (!isNonEmptyString(f.claim) && !f.person) {
    return { ok: false, reason: "needs either a claim or a person" };
  }

  return { ok: true, finding: f as Finding };
}

/** Builds the dedupe key. One definition, so writer and reader cannot disagree. */
export function buildIdempotencyKey(parts: {
  sourceKey: string;
  userId?: string;
  entityName: string;
  mode?: FindingMode;
}): string {
  return [parts.sourceKey, parts.userId ?? "-", parts.entityName, parts.mode ?? "-"].join(":");
}

/** Parses a JSONL body, returning valid findings and the reason each reject failed. */
export function parseFindingsJsonl(
  body: string,
  vocabulary: FindingVocabulary = DEFAULT_FINDING_VOCABULARY,
): {
  findings: Finding[];
  rejected: Array<{ line: number; reason: string }>;
} {
  const findings: Finding[] = [];
  const rejected: Array<{ line: number; reason: string }> = [];

  body.split("\n").forEach((line, index) => {
    if (!line.trim()) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      rejected.push({ line: index + 1, reason: "invalid JSON" });
      return;
    }
    const result = validateFinding(parsed, vocabulary);
    if (result.ok) findings.push(result.finding);
    else rejected.push({ line: index + 1, reason: result.reason });
  });

  return { findings, rejected };
}
