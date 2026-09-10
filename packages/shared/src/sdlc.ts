import { z } from "zod";

export const SDLC_BASELINE_KINDS = [
  "CORE_CODE_MAP",
  "FRONTEND_DESIGN_SYSTEM",
  "BACKEND_DESIGN_SYSTEM",
  "CODE_LINT_STANDARDS",
  "COMMIT_STANDARDS",
  "RUN_GUIDE",
  "TEST_GUIDE",
] as const;

export const SDLC_BASELINE_COUNT = SDLC_BASELINE_KINDS.length;

export const sdlcBaselineKindSchema = z.enum(SDLC_BASELINE_KINDS);
export type SdlcBaselineKind = z.infer<typeof sdlcBaselineKindSchema>;

function sdlcTimestamp(
  value: string | number | Date | null | undefined,
): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isSdlcBaselineApprovalCurrent(input: {
  approvedAt?: string | number | Date | null;
  lastEditedAt?: string | number | Date | null;
}): boolean {
  const approvedAt = sdlcTimestamp(input.approvedAt);
  if (approvedAt === null) return false;
  const lastEditedAt = sdlcTimestamp(input.lastEditedAt);
  return lastEditedAt === null || lastEditedAt <= approvedAt;
}

export const SDLC_ARTIFACT_KINDS = ["BASELINE", "PRD", "TECH_DOC"] as const;
export const sdlcArtifactKindSchema = z.enum(SDLC_ARTIFACT_KINDS);
export type SdlcArtifactKind = z.infer<typeof sdlcArtifactKindSchema>;

export const SDLC_ENTITY_TYPES = [
  "CANVAS",
  "TICKET",
  "CHANNEL",
  "CONVERSATION",
  "MESSAGE",
  "EMAIL",
  "CALL",
  "RECORDING",
  "ATTACHMENT",
  "PULL_REQUEST",
  "REPOSITORY",
  "WORKFLOW_EXECUTION",
] as const;

export const sdlcEntityTypeSchema = z.enum(SDLC_ENTITY_TYPES);
export type SdlcEntityType = z.infer<typeof sdlcEntityTypeSchema>;

export const SDLC_RELATION_TYPES = [
  "TECH_DOC",
  "TICKET",
  "CONTEXT",
  "PULL_REQUEST",
  "DISCUSSION",
  "WIKI_RUN",
] as const;

export const sdlcRelationTypeSchema = z.enum(SDLC_RELATION_TYPES);
export type SdlcRelationType = z.infer<typeof sdlcRelationTypeSchema>;

export const sdlcDiscussionSchema = z.object({
  repoId: z.string().min(1),
  ownerCanvasId: z.string().min(1),
  surfaceType: z.enum(["CANVAS", "TICKET", "PULL_REQUEST"]),
  surfaceId: z.string().min(1),
  linkId: z.string().min(1),
});
export type SdlcDiscussion = z.infer<typeof sdlcDiscussionSchema>;

export const SDLC_SETUP_STATUSES = [
  "NOT_STARTED",
  "QUEUED",
  "CLONING",
  "GENERATING",
  "PARTIALLY_FAILED",
  "CANCELLED",
  "READY_FOR_REVIEW",
  "APPROVED",
] as const;

export const sdlcSetupStatusSchema = z.enum(SDLC_SETUP_STATUSES);
export type SdlcSetupStatus = z.infer<typeof sdlcSetupStatusSchema>;

export const attachSdlcRepositorySchema = z.object({
  projectId: z.string().min(1),
  name: z.string().trim().min(1).max(120).optional(),
  url: z.string().trim().min(1).max(2048),
  baseBranch: z.string().trim().min(1).max(255).default("main"),
});
export type AttachSdlcRepositoryInput = z.infer<
  typeof attachSdlcRepositorySchema
>;

export const SDLC_VCS_PROVIDERS = ["GITHUB"] as const;
export const sdlcVcsProviderSchema = z.enum(SDLC_VCS_PROVIDERS);
export type SdlcVcsProvider = z.infer<typeof sdlcVcsProviderSchema>;

export const configureSdlcVcsCredentialSchema = z.object({
  token: z
    .string()
    .trim()
    .min(20)
    .max(512)
    .regex(
      /^github_pat_[A-Za-z0-9_]+$/,
      "Enter a GitHub fine-grained personal access token",
    ),
  resourceOwner: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9_.-]+$/),
});
export type ConfigureSdlcVcsCredentialInput = z.infer<
  typeof configureSdlcVcsCredentialSchema
>;

export const checkSdlcRepositoryAccessSchema = z.object({
  force: z.boolean().default(false),
});
export type CheckSdlcRepositoryAccessInput = z.infer<
  typeof checkSdlcRepositoryAccessSchema
>;

export const SDLC_WIKI_HISTORY_PERCENTAGES = [20, 50] as const;
export const sdlcWikiHistoryPercentageSchema = z.union([
  z.literal(20),
  z.literal(50),
]);
export type SdlcWikiHistoryPercentage = z.infer<
  typeof sdlcWikiHistoryPercentageSchema
>;

export const sdlcWikiHistoryRangeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("LAST_PERCENT"),
    percent: sdlcWikiHistoryPercentageSchema,
  }),
  z.object({ kind: z.literal("FULL") }),
  z.object({
    kind: z.literal("CUSTOM_SHA"),
    sha: z
      .string()
      .trim()
      .regex(/^[0-9a-f]{40}$/i),
  }),
]);
export type SdlcWikiHistoryRange = z.infer<typeof sdlcWikiHistoryRangeSchema>;

export const SDLC_WIKI_CHUNK_SIZES = [1, 10, 25, 50, 100] as const;
export const sdlcWikiChunkSizeSchema = z.union([
  z.literal(1),
  z.literal(10),
  z.literal(25),
  z.literal(50),
  z.literal(100),
]);
export type SdlcWikiChunkSize = z.infer<typeof sdlcWikiChunkSizeSchema>;

export const SDLC_WIKI_QUALITIES = ["QUICK", "STANDARD"] as const;
export const sdlcWikiQualitySchema = z.enum(SDLC_WIKI_QUALITIES);
export type SdlcWikiQuality = z.infer<typeof sdlcWikiQualitySchema>;

export const SDLC_WIKI_RUN_PHASES = [
  "QUEUED",
  "PREPARING",
  "BOOTSTRAPPING",
  "PROCESSING",
  "VALIDATING",
  "CORRECTING",
  "COMPLETED",
  "PARTIALLY_FAILED",
  "CANCELLED",
] as const;
export const sdlcWikiRunPhaseSchema = z.enum(SDLC_WIKI_RUN_PHASES);
export type SdlcWikiRunPhase = z.infer<typeof sdlcWikiRunPhaseSchema>;

export const SDLC_WIKI_ERROR_CODES = [
  "ACCESS_NOT_READY",
  "ACTIVE_RUN_EXISTS",
  "RUN_NOT_FOUND",
  "RUN_NOT_RETRYABLE",
  "RUN_CANCELLED",
  "INVALID_HISTORY_RANGE",
  "COMMIT_NOT_ASSIGNED",
  "COMMIT_OUT_OF_ORDER",
  "SESSION_MISMATCH",
  "CONTENT_CONFLICT",
  "INVALID_SOURCE_PATH",
  "PARTIAL_APPLY",
] as const;
export const sdlcWikiErrorCodeSchema = z.enum(SDLC_WIKI_ERROR_CODES);
export type SdlcWikiErrorCode = z.infer<typeof sdlcWikiErrorCodeSchema>;

export const SDLC_WIKI_ROOT_BOOTSTRAP_REF = "ROOT_BOOTSTRAP" as const;
export const sdlcWikiCommitRefSchema = z.union([
  z
    .string()
    .trim()
    .regex(/^[0-9a-f]{40}$/i),
  z.literal(SDLC_WIKI_ROOT_BOOTSTRAP_REF),
]);
export type SdlcWikiCommitRef = z.infer<typeof sdlcWikiCommitRefSchema>;

export const sdlcWikiAgentCommitRefSchema = z.union([
  z
    .string()
    .trim()
    .regex(/^[0-9a-f]{9,40}$/i),
  z.literal(SDLC_WIKI_ROOT_BOOTSTRAP_REF),
]);

export const startSdlcWikiRunSchema = z.object({
  historyRange: sdlcWikiHistoryRangeSchema.default({ kind: "FULL" }),
  chunkSize: sdlcWikiChunkSizeSchema.default(1),
  quality: sdlcWikiQualitySchema.default("STANDARD"),
});
export type StartSdlcWikiRunInput = z.infer<typeof startSdlcWikiRunSchema>;

export const refreshSdlcWikiRunSchema = z.object({
  chunkSize: sdlcWikiChunkSizeSchema.default(1),
  quality: sdlcWikiQualitySchema.default("STANDARD"),
});
export type RefreshSdlcWikiRunInput = z.infer<typeof refreshSdlcWikiRunSchema>;

const sdlcWikiPagePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .regex(
    /^(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\/\/)[^/\\]+(?:\/[^/\\]+)*\.md$/i,
    "Use a normalized relative Markdown path",
  );
const sdlcWikiSourcePathsSchema = z
  .array(z.string().trim().min(1).max(1024))
  .max(500);
export const sdlcSourceReferenceInputSchema = z.object({
  path: z.string().trim().min(1).max(1024),
  symbol: z.string().trim().min(1).max(512).optional(),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
});
export type SdlcSourceReferenceInput = z.infer<typeof sdlcSourceReferenceInputSchema>;

export const sdlcSourceReferencesSchema = z
  .array(sdlcSourceReferenceInputSchema)
  .max(500)
  .optional();

const sdlcWikiSourceReferencesSchema = sdlcSourceReferencesSchema;

const sdlcWikiRevisionSourceReferenceSchema = z.object({
  path: z.string().trim().min(1).max(1024),
  commitSha: sdlcWikiCommitRefSchema,
  symbol: z.string().trim().min(1).max(512).optional(),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
});

const sdlcWikiCreateActionSchema = z.object({
  action: z.literal("create"),
  path: sdlcWikiPagePathSchema,
  title: z.string().trim().min(1).max(255),
  markdown: z.string().min(1).max(5_000_000),
  sourcePaths: sdlcWikiSourcePathsSchema.min(1),
  sourceReferences: sdlcWikiSourceReferencesSchema,
});
const sdlcWikiWriteActionFields = {
  path: sdlcWikiPagePathSchema,
  expectedContentHash: z.string().trim().min(1).max(128),
  title: z.string().trim().min(1).max(255),
  markdown: z.string().min(1).max(5_000_000),
  sourcePaths: sdlcWikiSourcePathsSchema.min(1),
  sourceReferences: sdlcWikiSourceReferencesSchema,
};
const sdlcWikiUpdateActionSchema = z.object({
  action: z.literal("update"),
  ...sdlcWikiWriteActionFields,
});
const sdlcWikiRestoreActionSchema = z.object({
  action: z.literal("restore"),
  ...sdlcWikiWriteActionFields,
});
const sdlcWikiArchiveActionSchema = z.object({
  action: z.literal("archive"),
  path: sdlcWikiPagePathSchema,
  expectedContentHash: z.string().trim().min(1).max(128),
  sourcePaths: sdlcWikiSourcePathsSchema,
  sourceReferences: sdlcWikiSourceReferencesSchema,
});
const sdlcWikiSectionActionFields = {
  path: sdlcWikiPagePathSchema,
  expectedContentHash: z.string().trim().min(1).max(128),
  heading: z.string().trim().min(1).max(255),
  sourcePaths: sdlcWikiSourcePathsSchema.min(1),
  sourceReferences: sdlcWikiSourceReferencesSchema,
};
const sdlcWikiReplaceSectionActionSchema = z.object({
  action: z.literal("replace_section"),
  ...sdlcWikiSectionActionFields,
  markdown: z.string().min(1).max(1_000_000),
});
const sdlcWikiInsertSectionActionSchema = z.object({
  action: z.literal("insert_section"),
  ...sdlcWikiSectionActionFields,
  markdown: z.string().min(1).max(1_000_000),
});
const sdlcWikiRemoveSectionActionSchema = z.object({
  action: z.literal("remove_section"),
  ...sdlcWikiSectionActionFields,
  markdown: z.string().min(1).max(1_000_000).optional(),
});

export const sdlcWikiPageActionSchema = z.discriminatedUnion("action", [
  sdlcWikiCreateActionSchema,
  sdlcWikiUpdateActionSchema,
  sdlcWikiRestoreActionSchema,
  sdlcWikiArchiveActionSchema,
  sdlcWikiReplaceSectionActionSchema,
  sdlcWikiInsertSectionActionSchema,
  sdlcWikiRemoveSectionActionSchema,
]);
export type SdlcWikiPageAction = z.infer<typeof sdlcWikiPageActionSchema>;

export const beginSdlcWikiCheckpointSchema = z.object({
  executionId: z.string().min(1),
  commitSha: sdlcWikiAgentCommitRefSchema,
});
export type BeginSdlcWikiCheckpointInput = z.infer<
  typeof beginSdlcWikiCheckpointSchema
>;

export const writeSdlcWikiPageSchema = z.object({
  executionId: z.string().min(1),
  commitSha: sdlcWikiAgentCommitRefSchema,
  page: sdlcWikiPageActionSchema,
});
export type WriteSdlcWikiPageInput = z.infer<typeof writeSdlcWikiPageSchema>;

export const moveSdlcWikiPageSchema = z.object({
  executionId: z.string().min(1),
  commitSha: sdlcWikiAgentCommitRefSchema,
  sourcePath: sdlcWikiPagePathSchema,
  destinationPath: sdlcWikiPagePathSchema,
  expectedContentHash: z.string().trim().min(1).max(128),
  title: z.string().trim().min(1).max(255).optional(),
});
export type MoveSdlcWikiPageInput = z.infer<typeof moveSdlcWikiPageSchema>;

export const finalizeSdlcWikiCommitSchema = z.object({
  executionId: z.string().min(1),
  commitSha: sdlcWikiAgentCommitRefSchema,
  outcome: z.enum(["changes", "noop"]),
  summary: z.string().trim().min(1).max(4_000),
});
export type FinalizeSdlcWikiCommitInput = z.infer<
  typeof finalizeSdlcWikiCommitSchema
>;

export const sdlcWikiValidatorReportSchema = z.object({
  complete: z.boolean(),
  missingTopics: z.array(z.string().trim().min(1).max(1_000)).max(100),
  issues: z.array(z.string().trim().min(1).max(1_000)).max(100),
  suggestions: z.array(z.string().trim().min(1).max(1_000)).max(100),
});
export type SdlcWikiValidatorReport = z.infer<
  typeof sdlcWikiValidatorReportSchema
>;

export const sdlcWikiRevisionEvidenceSchema = z.object({
  action: z.enum([
    "created",
    "updated",
    "archived",
    "restored",
    "refined",
    "moved",
  ]),
  commitSha: sdlcWikiCommitRefSchema,
  canvasId: z.string().min(1),
  canvasVersionId: z.string().min(1),
  contentHash: z.string().trim().min(1).max(128),
  sourcePaths: sdlcWikiSourcePathsSchema,
  path: sdlcWikiPagePathSchema.optional(),
  title: z.string().trim().min(1).max(500).optional(),
  archived: z.boolean().optional(),
  sourceReferences: z
    .array(sdlcWikiRevisionSourceReferenceSchema)
    .max(500)
    .optional(),
});
export type SdlcWikiRevisionEvidence = z.infer<
  typeof sdlcWikiRevisionEvidenceSchema
>;

export const sdlcWikiCommitOutcomeSchema = z.object({
  commitSha: sdlcWikiCommitRefSchema,
  status: z.enum(["updated", "noop"]),
  revisions: z.array(sdlcWikiRevisionEvidenceSchema),
  completedAt: z.string().datetime(),
});
export type SdlcWikiCommitOutcome = z.infer<typeof sdlcWikiCommitOutcomeSchema>;

export const SDLC_WIKI_FRESHNESS = ["CURRENT", "STALE", "UNKNOWN"] as const;
export const sdlcWikiFreshnessSchema = z.enum(SDLC_WIKI_FRESHNESS);
export type SdlcWikiFreshness = z.infer<typeof sdlcWikiFreshnessSchema>;

export interface SdlcWikiRunProgress {
  phase: SdlcWikiRunPhase;
  total: number;
  processed: number;
  updated: number;
  noop: number;
  failed: number;
  aggregated?: number;
  cursorSha: string | null;
  targetHeadSha: string | null;
  error: string | null;
  recovery?: {
    attempts: number;
    noProgressAttempts: number;
    lastCause: string;
    lastCauseAt: string;
  };
  windows?: {
    total: number;
    completed: number;
    updated: number;
    noop: number;
    failed: number;
    intermediate: number;
  };
  currentWindowBeforeSha?: string | null;
  currentWindowAfterSha?: string | null;
  activeCheckpointSha?: string | null;
}

const sdlcRunAuthoritySchema = z.union([
  z.object({
    executionId: z.string().min(1),
    sessionId: z.string().min(1),
  }),
  z.object({
    interactiveGrant: z.string().min(1),
    conversationId: z.string().min(1),
  }),
]);

export const createSdlcPullRequestSchema = z.object({
  repoId: z.string().min(1),
  title: z.string().trim().min(1).max(256),
  body: z.string().max(65_536).default(""),
  head: z.string().trim().min(1).max(255),
  base: z.string().trim().min(1).max(255),
  commitHash: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{40}$/i),
}).and(sdlcRunAuthoritySchema);
export type CreateSdlcPullRequestInput = z.infer<
  typeof createSdlcPullRequestSchema
>;

export const bootstrapSdlcRuntimeCredentialSchema = z.object({
  agentSlug: z.literal("sdlc-agent"),
  repoId: z.string().min(1),
  operation: z.enum(["CLONE", "PUSH", "INTERACTIVE"]),
  sandboxId: z.string().min(1).max(256),
  sandboxPublicKey: z.string().min(32).max(1024),
}).and(sdlcRunAuthoritySchema);
export type BootstrapSdlcRuntimeCredentialInput = z.infer<
  typeof bootstrapSdlcRuntimeCredentialSchema
>;

export const createSdlcClawArtifactSchema = z
  .object({
    repoId: z.string().min(1),
    kind: sdlcArtifactKindSchema,
    title: z.string().trim().min(1).max(255),
    markdown: z.string().min(1).max(5_000_000),
    baselineKind: sdlcBaselineKindSchema.optional(),
    setupExecutionId: z.string().min(1).optional(),
    workflowExecutionId: z.string().min(1).optional(),
    parentCanvasId: z.string().min(1).optional(),
    generationCommit: z.string().trim().max(255).optional(),
    sourceReferences: sdlcSourceReferencesSchema,
  })
  .superRefine((value, ctx) => {
    if (
      value.kind === "BASELINE" &&
      (!value.baselineKind ||
        !value.setupExecutionId ||
        !value.workflowExecutionId)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Baseline artifacts require baselineKind, setupExecutionId, and workflowExecutionId",
      });
    }
    if (value.kind === "TECH_DOC" && !value.parentCanvasId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Tech Doc artifacts require a parent PRD",
      });
    }
  });
export type CreateSdlcClawArtifactInput = z.infer<
  typeof createSdlcClawArtifactSchema
>;

export const updateSdlcClawArtifactSchema = z
  .object({
    repoId: z.string().min(1),
    kind: z.enum(["PRD", "TECH_DOC"]),
    canvasId: z.string().min(1),
    title: z.string().trim().min(1).max(255).optional(),
    markdown: z.string().min(1).max(5_000_000),
    sourceReferences: sdlcSourceReferencesSchema,
  });
export type UpdateSdlcClawArtifactInput = z.infer<
  typeof updateSdlcClawArtifactSchema
>;

export const updateSdlcBaselineDraftSchema = z
  .object({
    repoId: z.string().min(1),
    baselineKind: sdlcBaselineKindSchema,
    setupExecutionId: z.string().min(1),
    workflowExecutionId: z.string().min(1),
    title: z.string().trim().min(1).max(255),
    action: z.enum(["begin", "upsert_section", "finalize"]),
    sectionKey: z.string().trim().min(1).max(80).optional(),
    sectionTitle: z.string().trim().min(1).max(255).optional(),
    markdown: z.string().min(1).max(1_000_000).optional(),
    sourceReferences: sdlcSourceReferencesSchema,
  })
  .superRefine((value, ctx) => {
    if (
      value.action === "upsert_section" &&
      (!value.sectionKey || !value.sectionTitle || !value.markdown)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Section updates require sectionKey, sectionTitle, and markdown",
      });
    }
  });
export type UpdateSdlcBaselineDraftInput = z.infer<
  typeof updateSdlcBaselineDraftSchema
>;

export const createSdlcLinkSchema = z.object({
  sourceType: sdlcEntityTypeSchema,
  sourceId: z.string().min(1),
  targetType: sdlcEntityTypeSchema,
  targetId: z.string().min(1),
  relationType: sdlcRelationTypeSchema,
});
export type CreateSdlcLinkInput = z.infer<typeof createSdlcLinkSchema>;

export interface SdlcCanvasMetadata {
  surface: "SDLC";
  repoId: string;
  artifactKind: SdlcArtifactKind;
  baselineKind?: SdlcBaselineKind;
  generationStatus?: "GENERATING" | "READY";
  completedSections?: string[];
  generationCommit?: string;
  setupExecutionId?: string;
  approvedAt?: string;
  approvedBy?: string;
  knowledgeDocumentId?: string;
  sdlcSourceReferences?: Array<{
    path: string;
    commitSha: string;
    symbol?: string;
    startLine?: number;
    endLine?: number;
  }>;
}

export interface SdlcWikiCanvasMetadata {
  source: "sdlc-wiki-pipeline";
  surface: "SDLC";
  documentKind: "WIKI";
  repoId: string;
  projectId: string;
  repositoryUrl: string;
  wikiRelativePath: string;
  wikiSourcePaths: string[];
  wikiLastCommitSha: string;
  wikiContentHash: string;
  wikiCanvasVersionId: string;
  wikiSyncedAt: string;
  wikiArchivedAt?: string;
  wikiArchivedByCommit?: string;
}

export interface SdlcChannelMetadata {
  surface: "SDLC";
  hiddenFromChat: true;
  repoId: string;
}

const nullableNonEmpty = z.string().min(1).nullable();

export const SDLC_AGENT_OPERATIONS = [
  "interactive",
  "baseline",
  "artifact",
  "work",
  "wiki",
] as const;
export const sdlcAgentOperationSchema = z.enum(SDLC_AGENT_OPERATIONS);
export type SdlcAgentOperation = z.infer<typeof sdlcAgentOperationSchema>;

export const SDLC_WIKI_AGENT_ROLES = [
  "BOOTSTRAP_SURVEY",
  "BOOTSTRAP_PAGE",
  "BOOTSTRAP_EDITOR",
  "BOOTSTRAP",
  "GENERATOR",
  "ARCHITECTURE_VALIDATOR",
  "CORRECTOR",
] as const;
export const sdlcWikiAgentRoleSchema = z.enum(SDLC_WIKI_AGENT_ROLES);
export type SdlcWikiAgentRole = z.infer<typeof sdlcWikiAgentRoleSchema>;


export const sdlcAgentContextSchema = z
  .object({
    version: z.literal(1),
    operation: sdlcAgentOperationSchema,
    workspaceId: z.string().min(1),
    projectId: z.string().min(1),
    channelId: z.string().min(1),
    actorUserId: z.string().min(1),
    repository: z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      url: z.string().min(1),
      baseBranch: z.string().min(1),
    }),
    permissions: z.object({ repositoryRole: z.enum(["ADMIN", "MEMBER"]) }),
    gates: z.object({
      capabilities: z.array(z.unknown()),
      allBaselinesApproved: z.boolean(),
    }),
    execution: z.object({
      workflowExecutionId: nullableNonEmpty,
      sessionId: nullableNonEmpty,
      conversationId: nullableNonEmpty,
    }),
    interactiveGrant: nullableNonEmpty.optional(),
    artifact: z.object({
      kind: nullableNonEmpty,
      id: nullableNonEmpty,
      sourceType: nullableNonEmpty,
      sourceId: nullableNonEmpty,
    }),
    ticketId: nullableNonEmpty.optional(),
    setupExecutionId: nullableNonEmpty.optional(),
    baselineKind: sdlcBaselineKindSchema.nullable().optional(),
    generationCommit: nullableNonEmpty.optional(),
    wiki: z
      .object({
        role: sdlcWikiAgentRoleSchema.nullable(),
        assignedCommitShas: z.array(z.string()),
        bootstrapRef: z.string().nullable(),
        targetHeadSha: z.string().nullable(),
      })
      .optional(),
  })
  .superRefine((context, ctx) => {
    const fail = (message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    const hasExecution =
      Boolean(context.execution.workflowExecutionId) && Boolean(context.execution.sessionId);

    switch (context.operation) {
      case "baseline":
        if (!context.setupExecutionId) fail("setupExecutionId is required for baseline runs");
        if (!context.baselineKind) fail("baselineKind is required for baseline runs");
        if (!hasExecution) fail("baseline runs require a bound execution");
        break;
      case "artifact":
        if (!hasExecution) fail("artifact runs require a bound execution");
        break;
      case "work":
        if (!context.ticketId) fail("ticketId is required for work runs");
        if (!hasExecution) fail("work runs require a bound execution");
        break;
      case "interactive":
        if (!context.execution.conversationId) fail("interactive runs require a conversationId");
        if (!context.interactiveGrant) fail("interactive runs require an interactiveGrant");
        break;
      case "wiki":
        break;
    }
  });
export type SdlcAgentContext = z.infer<typeof sdlcAgentContextSchema>;
