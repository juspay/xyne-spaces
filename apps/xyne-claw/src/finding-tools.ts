/**
 * emit-finding — the extractor agent's only way to record what it learned.
 *
 * The agent reads a batch of threads and calls this once per observation. The
 * tool validates against the shared schema and buffers; the caller flushes the
 * batch to GCS when the session ends.
 *
 * Validation lives HERE rather than downstream because the eventual consumer is
 * the merge agent's prompt, which never complains — a malformed finding would
 * be silently misread rather than rejected. Failing at the tool boundary gives
 * the model the reason and a chance to correct itself, which is the only point
 * in the pipeline where correction is still possible.
 *
 * The agent never sees GCS: no bucket, no path, no credentials. It emits
 * observations; where they land is the caller's business.
 */

import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  FINDINGS_SCHEMA_VERSION,
  DEFAULT_FINDING_VOCABULARY,
  buildIdempotencyKey,
  validateFinding,
  type Finding,
  type FindingMode,
  type FindingVocabulary,
} from "xyne-claw-shared";
import { createLogger } from "./logger.js";

const log = createLogger("finding-tools");

/** Context the caller knows and the model must not invent. */
export interface FindingScope {
  workspaceId: string;
  project: { id: string; code: string; name: string };
  producer: { sessionId: string; agentSlug: string; model: string };
}

/** Collects a session's findings so the caller can flush them in one write. */
export class FindingCollector {
  private readonly findings: Finding[] = [];
  private readonly seen = new Set<string>();
  private rejected = 0;
  private duplicates = 0;

  constructor(
    private readonly scope: FindingScope,
    private readonly vocabulary: FindingVocabulary = DEFAULT_FINDING_VOCABULARY,
  ) {}

  add(finding: Finding): { ok: true } | { ok: false; reason: string } {
    const result = validateFinding(finding, this.vocabulary);
    if (!result.ok) {
      this.rejected += 1;
      return { ok: false, reason: result.reason };
    }
    // Within-session dedupe. The merge dedupes too, but catching it here keeps
    // the GCS object honest about how much was actually observed.
    if (this.seen.has(finding.idempotencyKey)) {
      this.duplicates += 1;
      return { ok: false, reason: `duplicate of an observation already recorded this session` };
    }
    this.seen.add(finding.idempotencyKey);
    this.findings.push(result.finding);
    return { ok: true };
  }

  /** JSONL body, or null when nothing survived. */
  toJsonl(): string | null {
    if (this.findings.length === 0) return null;
    return this.findings.map((f) => JSON.stringify(f)).join("\n") + "\n";
  }

  stats(): { emitted: number; rejected: number; duplicates: number } {
    return { emitted: this.findings.length, rejected: this.rejected, duplicates: this.duplicates };
  }

  get scopeRef(): FindingScope {
    return this.scope;
  }

  get vocabularyRef(): FindingVocabulary {
    return this.vocabulary;
  }
}

function str(params: unknown, key: string): string {
  const value = (params as Record<string, unknown> | undefined)?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function num(params: unknown, key: string): number | undefined {
  const value = (params as Record<string, unknown> | undefined)?.[key];
  return typeof value === "number" ? value : undefined;
}

/**
 * Builds the tool. Scope is closed over, so project, workspace and producer
 * come from the caller — the model cannot attribute a finding to another
 * project, and cannot get the project code wrong.
 *
 * The vocabulary comes from the caller too, so the taxonomy can be retuned from
 * the agent row without shipping a new package.
 */
export function createEmitFindingTool(collector: FindingCollector): ToolDefinition {
  const scope = collector.scopeRef;
  const vocabulary = collector.vocabularyRef;

  return {
    name: "emit-finding",
    label: "Emit Finding",
    description: [
      "Record one observation about who knows what, or one fact worth keeping.",
      "",
      "Call once per distinct observation. An observation needs either a `claim`",
      "(a fact that stands on its own) or a `person` (someone who demonstrated",
      "knowledge) — ideally both.",
      "",
      "RECORD WHAT YOU SAW, NEVER WHAT IT MEANS. Every `mode` must be something you",
      "can point at in the quote. If you are concluding rather than observing, you",
      "have the wrong mode. Do not decide who owns something — that is worked out",
      "later, from how often a signal repeats across different threads.",
      "",
      "`entityName` must be lowercase and hyphenated (e.g. 'vespa', 'euler-api-txns').",
      "Check existing KB pages first and reuse the name already in use there rather",
      "than inventing a variant — 'postgres' and 'postgresql' become two permanent",
      "pages that split the knowledge.",
      "",
      "`quote` must be verbatim from the source. It is what makes the claim",
      "auditable, so never paraphrase it.",
    ].join("\n"),
    parameters: Type.Unsafe({
      type: "object",
      additionalProperties: false,
      properties: {
        entityName: { type: "string", description: "Lowercase, hyphenated. e.g. 'vespa'." },
        entityKind: {
          type: "string",
          enum: [...vocabulary.entityKinds],
          description: "SERVICE for deployables and infrastructure; TOOL for things you operate with.",
        },
        claim: {
          type: "string",
          description: "The fact, standing alone. Omit only when the observation is purely about a person.",
        },
        userId: { type: "string", description: "Spaces user id of the person, verbatim from the batch." },
        displayName: { type: "string", description: "The person's name as shown." },
        mode: {
          type: "string",
          enum: [...vocabulary.modes],
          description: [
            "What the quote SHOWS this person doing. Not your read of their standing.",
            "DEFERRED_TO — someone ELSE pointed at them: 'ask X', 'X would know'.",
            "RESOLVED — their message ended the thread, or they closed the ticket.",
            "CORRECTED — they overrode someone else's answer.",
            "ANSWERED — they gave a substantive answer.",
            "CLAIMED_OWNERSHIP — they said so themselves: 'I own this', 'I'll take it'.",
            "REVIEWED — they are the ticket's reviewer.",
            "ASKED — they asked about it. Record this; it is evidence they are NOT",
            "the expert here, and leaving it out is how a bystander gets mistaken",
            "for an authority.",
          ].join(" "),
        },
        quote: { type: "string", description: "Verbatim evidence from the source." },
        ref: { type: "string", description: "Message id or ticket field the quote came from." },
        confidence: { type: "number", description: "0-1. Below 0.5 will not be recorded as expertise." },
        sourceType: { type: "string", enum: ["CHAT_THREAD", "TICKET"] },
        sourceKey: { type: "string", description: "threadId for chat, ticket key for a ticket." },
        permalink: { type: "string", description: "Deep link to the thread or ticket." },
        occurredAt: { type: "string", description: "ISO time the conversation happened, NOT now." },
      },
      required: ["entityName", "entityKind", "quote", "confidence", "sourceType", "sourceKey", "permalink", "occurredAt"],
    }),
    async execute(_toolCallId: string, params: unknown) {
      const entityName = str(params, "entityName");
      const userId = str(params, "userId");
      const mode = str(params, "mode") as FindingMode | "";
      const sourceKey = str(params, "sourceKey");
      const confidence = num(params, "confidence");

      const finding: Finding = {
        schemaVersion: FINDINGS_SCHEMA_VERSION,
        // Derived from the observation, not random: a re-run of the same batch
        // produces the same ids, so a retried session does not duplicate.
        observationId: `obs_${sourceKey}_${entityName}_${userId || "none"}_${mode || "none"}`,
        emittedAt: new Date().toISOString(),
        workspaceId: scope.workspaceId,
        producer: scope.producer,
        source: {
          type: str(params, "sourceType") === "TICKET" ? "TICKET" : "CHAT_THREAD",
          project: scope.project,
          permalink: str(params, "permalink"),
          occurredAt: str(params, "occurredAt"),
          ...(str(params, "sourceType") === "TICKET"
            ? { ticketKey: sourceKey }
            : { threadId: sourceKey }),
        },
        entity: {
          // Not defaulted. A guessed kind routes the finding to a KB folder that
          // cannot be moved afterwards, so a missing one is rejected instead.
          kind: str(params, "entityKind") as Finding["entity"]["kind"],
          name: entityName.toLowerCase(),
        },
        ...(str(params, "claim") ? { claim: str(params, "claim") } : {}),
        ...(userId
          ? { person: { userId, displayName: str(params, "displayName") || userId } }
          : {}),
        ...(mode ? { mode: mode as FindingMode } : {}),
        evidence: {
          // NOT trimmed — a verbatim quote keeps its whitespace.
          quote: ((params as Record<string, unknown>)?.["quote"] as string) ?? "",
          ...(str(params, "ref") ? { ref: str(params, "ref") } : {}),
        },
        confidence: confidence ?? 0,
        idempotencyKey: buildIdempotencyKey({
          sourceKey,
          ...(userId ? { userId } : {}),
          entityName: entityName.toLowerCase(),
          ...(mode ? { mode: mode as FindingMode } : {}),
        }),
      };

      const result = collector.add(finding);
      if (!result.ok) {
        log.warn(`[emit-finding] rejected ${entityName}: ${result.reason}`);
        return {
          content: [{ type: "text" as const, text: `Not recorded — ${result.reason}. Fix and call again.` }],
          details: { error: true },
        };
      }

      log.info(
        `[emit-finding] ${scope.project.code} ${entityName} ` +
          `${mode || "claim"} ${userId ? `by ${userId}` : ""} conf=${confidence}`,
      );
      return {
        content: [{ type: "text" as const, text: `Recorded: ${entityName} (${mode || "claim"})` }],
        details: { entityName, mode },
      };
    },
  };
}
