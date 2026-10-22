/**
 * The static content registry's write side: commit() hashes a static item, records a pending version
 * once per (org, subject, hash), runs the parser inline and files its findings. Loaders and the
 * per-kind adapters arrive with PR-6; the judge and detonator jobs update the other verdict columns.
 */
import { Prisma, type StaticContentVersion } from "@prisma/client";
import { hashPromptText, scanText, type StaticContentKind, type Verdict, allRules } from "xyne-claw-shared/governance";
import { contentScanFindingRepository, staticContentVersionRepository as versions } from "../repositories/governanceRepository.js";
import { queueGovernanceEvent, type ActorKind } from "./governance-audit.js";

export const WRITTEN_BY = ["person", "agent", "seed", "mcp_server", "admin", "build"] as const;
export type WrittenBy = (typeof WRITTEN_BY)[number];
export const APPROVAL_STATUSES = ["pending", "approved", "rejected", "held", "revoked"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
export const APPROVED_VIA = ["baseline", "checks_passed", "owner", "claw_admin", "admin_override", "ci_build"] as const;
export type ApprovedVia = (typeof APPROVED_VIA)[number];

export interface CommitInput {
  orgId: string;
  contentKind: StaticContentKind;
  subjectKey: string;
  /** The canonical text for text kinds. A skill bundle passes contentSha256 and bytesStoragePath instead. */
  text?: string | undefined;
  contentSha256?: string | undefined;
  bytesStoragePath?: string | undefined;
  promptVersionId?: string | undefined;
  writtenBy: WrittenBy;
  writtenByUserId?: string | undefined;
  writtenByAgentId?: string | undefined;
  writtenInConversationId?: string | undefined;
  writtenAtRiskLevel?: string | undefined;
  carriesPrivateData?: boolean | undefined;
  supersedesVersionId?: string | undefined;
}

const ACTOR_OF: Record<WrittenBy, ActorKind> = { person: "user", agent: "agent", seed: "system", mcp_server: "system", admin: "admin", build: "system" };
const TEXT_IN_ROW: ReadonlySet<StaticContentKind> = new Set(["memory_file", "user_instruction", "agent_config_text", "mcp_tool_definition", "code_constant"]);

function isUniqueClash(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/** Idempotent: the same bytes for the same subject return the existing version and scan nothing. */
export async function commitStaticContentVersion(input: CommitInput): Promise<{ version: StaticContentVersion; created: boolean }> {
  const contentSha256 = input.contentSha256 ?? hashPromptText(input.text ?? "");
  if (input.text === undefined && input.contentSha256 === undefined) throw new Error("commit: text or contentSha256 is required");
  const existing = await versions.findByHash(input.orgId, input.subjectKey, contentSha256);
  if (existing) return { version: existing, created: false };

  const { text, orgId, contentKind, subjectKey } = input;
  let version: StaticContentVersion;
  try {
    version = await versions.create({
      orgId,
      contentKind,
      subjectKey,
      contentSha256,
      writtenBy: input.writtenBy,
      writtenByUserId: input.writtenByUserId ?? null,
      writtenByAgentId: input.writtenByAgentId ?? null,
      writtenInConversationId: input.writtenInConversationId ?? null,
      writtenAtRiskLevel: input.writtenAtRiskLevel ?? null,
      carriesPrivateData: input.carriesPrivateData ?? false,
      bytesText: text !== undefined && TEXT_IN_ROW.has(contentKind) ? text : null,
      bytesStoragePath: input.bytesStoragePath ?? null,
      promptVersionId: input.promptVersionId ?? null,
      supersedesVersionId: input.supersedesVersionId ?? null,
    });
  } catch (err) {
    const raced = isUniqueClash(err) ? await versions.findByHash(orgId, subjectKey, contentSha256) : null;
    if (!raced) throw err;
    return { version: raced, created: false };
  }

  let verdict: Verdict | undefined;
  let scannerVersion: string | undefined;
  let matchedRuleIds: string[] = [];
  let findingIds: string[] = [];
  let reasonCode: string | undefined;
  let parserMs: number | undefined;
  let detail = "stored without a text scan";
  if (text !== undefined) {
    const t0 = performance.now();
    const scan = scanText({ text, kind: contentKind });
    parserMs = Math.round(performance.now() - t0);
    verdict = scan.verdict;
    scannerVersion = scan.scannerVersion;
    matchedRuleIds = [...new Set(scan.findings.map((f) => f.ruleId))];
    reasonCode = scan.findings[0]?.reasonCode;
    // What ran, so the record answers "which checks passed": the parser's rules for this kind; the judge and the detonator come later.
    const checked = allRules().filter((r) => (r.kinds === undefined || r.kinds.includes(contentKind)) && !(r.excludeKinds?.includes(contentKind) ?? false) && !r.outboundOnly).length;
    detail = `parser ${scan.scannerVersion}: ${verdict}; ${checked} rules checked over ${text.length} chars in ${parserMs} ms, ${scan.findings.length} finding(s)${matchedRuleIds.length > 0 ? ` (${matchedRuleIds.slice(0, 12).join(", ")})` : ""}${scan.signals.length > 0 ? `, ${scan.signals.length} weak signal(s)` : ""}${scan.truncated ? ", text truncated at the size cap" : ""}${scan.budgetExceeded ? ", time budget exceeded" : ""}; judge and detonator not run (later phases)`.slice(0, 1_900);
    const rows = scan.findings.map((f) => ({
      orgId,
      foundIn: "static_version",
      staticContentVersionId: version.id,
      foundByCheck: "parser",
      verdict: f.verdict,
      ruleId: f.ruleId,
      ruleFamily: f.family,
      score: f.score,
      startOffset: f.span.start,
      endOffset: f.span.end,
      redactedExcerpt: f.excerpt,
      scanProfile: contentKind,
      scannerVersion: scan.scannerVersion,
    }));
    if (rows.length > 0) findingIds = (await contentScanFindingRepository.createMany(rows)).map((f) => f.id);
    version = await versions.update(version.id, { parserVerdict: verdict, scannerVersion, lastScannedAt: new Date() });
  }
  queueGovernanceEvent({
    orgId,
    eventType: "content_scan",
    actorKind: ACTOR_OF[input.writtenBy],
    actorId: input.writtenByUserId ?? input.writtenByAgentId ?? null,
    subjectKind: contentKind,
    subjectId: subjectKey,
    contentSha256After: contentSha256,
    agentId: input.writtenByAgentId ?? null,
    conversationId: input.writtenInConversationId ?? null,
    decision: verdict === "injection" ? "block" : verdict === "clean" || verdict === undefined ? "allow" : "ask",
    reasonCode: reasonCode ?? null,
    reasonText: detail,
    scannerVersion: scannerVersion ?? null,
    matchedRuleIds,
    findingIds,
    checkTierReached: text !== undefined ? "parser" : null,
    parserMs: parserMs ?? null,
  });
  return { version, created: true };
}

export interface ApprovalInput {
  approvalStatus: ApprovalStatus;
  approvedVia?: ApprovedVia | undefined;
  actorUserId?: string | undefined;
  actorKind?: ActorKind | undefined;
  overrideReason?: string | undefined;
  overrideExpiresAt?: Date | undefined;
}

export async function setStaticContentApproval(versionId: string, input: ApprovalInput): Promise<StaticContentVersion> {
  const approved = input.approvalStatus === "approved";
  const version = await versions.update(versionId, {
    approvalStatus: input.approvalStatus,
    approvedVia: approved ? (input.approvedVia ?? null) : null,
    approvedByUserId: approved ? (input.actorUserId ?? null) : null,
    approvedAt: approved ? new Date() : null,
    overrideReason: input.overrideReason ?? null,
    overrideExpiresAt: input.overrideExpiresAt ?? null,
  });
  queueGovernanceEvent({
    orgId: version.orgId,
    eventType: input.approvedVia === "admin_override" ? "admin_override" : "version_status_changed",
    actorKind: input.actorKind ?? (input.actorUserId ? "user" : "system"),
    actorId: input.actorUserId ?? null,
    subjectKind: version.contentKind,
    subjectId: version.subjectKey,
    contentSha256After: version.contentSha256,
    decision: approved ? "allow" : input.approvalStatus === "pending" ? null : "block",
    reasonText: [input.approvalStatus, input.approvedVia, input.overrideReason].filter(Boolean).join(": "),
  });
  return version;
}
