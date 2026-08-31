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

export const SDLC_ARTIFACT_KINDS = ["BASELINE"] as const;
export const sdlcArtifactKindSchema = z.enum(SDLC_ARTIFACT_KINDS);
export type SdlcArtifactKind = z.infer<typeof sdlcArtifactKindSchema>;

export const SDLC_CANVAS_TYPES = ["WIKI", ...SDLC_BASELINE_KINDS] as const;
export type SdlcCanvasType = (typeof SDLC_CANVAS_TYPES)[number];

export const BASELINE_CANVAS_TYPES: ReadonlySet<string> = new Set(
  SDLC_BASELINE_KINDS,
);

export function isBaselineCanvasType(
  value: string | null | undefined,
): value is SdlcBaselineKind {
  return typeof value === "string" && BASELINE_CANVAS_TYPES.has(value);
}

export function canvasTypeForSdlcArtifact(
  baselineKind?: SdlcBaselineKind | null,
): SdlcCanvasType {
  if (!baselineKind) {
    throw new Error("Baseline artifacts require a baselineKind");
  }
  return baselineKind;
}

export const CANVAS_STATUS_ACTIVE = "ACTIVE";

/**
 * Stored shape of sdlc_artifacts.sourceReferences (stringified JSON).
 * All parsing/stringifying of that column goes through the helpers below.
 */
export const sdlcStoredSourceReferenceSchema = z.object({
  path: z.string().min(1),
  commitSha: z.string().min(1),
  symbol: z.string().min(1).optional(),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
});
export type SdlcStoredSourceReference = z.infer<
  typeof sdlcStoredSourceReferenceSchema
>;
const sdlcStoredSourceReferencesSchema = z
  .array(sdlcStoredSourceReferenceSchema)
  .max(500);

export function parseSdlcSourceReferences(
  value: string | null | undefined,
): SdlcStoredSourceReference[] {
  if (!value) return [];
  try {
    const result = sdlcStoredSourceReferencesSchema.safeParse(
      JSON.parse(value),
    );
    return result.success ? result.data : [];
  } catch {
    return [];
  }
}

export function stringifySdlcSourceReferences(
  references: readonly SdlcStoredSourceReference[],
): string | null {
  return references.length > 0 ? JSON.stringify(references) : null;
}

export function parseSdlcSourcePaths(
  value: string | null | undefined,
): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(
          (path): path is string => typeof path === "string" && path.length > 0,
        )
      : [];
  } catch {
    return [];
  }
}

export function stringifySdlcSourcePaths(
  paths: readonly string[],
): string | null {
  return paths.length > 0 ? JSON.stringify(paths) : null;
}

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
  "TRACK",
] as const;

export const sdlcEntityTypeSchema = z.enum(SDLC_ENTITY_TYPES);
export type SdlcEntityType = z.infer<typeof sdlcEntityTypeSchema>;

/**
 * A CHANNEL -> REPOSITORY edge: the repository belongs to that hub. It shares a
 * table with the content graph, so every read of that graph excludes it — grep
 * this constant for those call sites. Written only by the hub endpoints.
 */
export const SDLC_MEMBERSHIP_RELATION = "REPOSITORY";

/**
 * A CHANNEL -> TRACK edge: the track belongs to that hub. Tracks carry no scope
 * column of their own, so this edge is the only thing that places one.
 */
export const SDLC_TRACK_MEMBERSHIP_RELATION = "TRACK";

/** Structure, not content. Every read of the content graph excludes these. */
export const SDLC_STRUCTURAL_RELATIONS = [
  SDLC_MEMBERSHIP_RELATION,
  SDLC_TRACK_MEMBERSHIP_RELATION,
] as const;

/** Relation types a user may create or delete through the generic link API. */
export const SDLC_CONTENT_RELATION_TYPES = [
  "TICKET",
  "CONTEXT",
  "PULL_REQUEST",
  "DISCUSSION",
  "WIKI_RUN",
  "TRACK_ITEM",
  "CALL",
] as const;

export const SDLC_RELATION_TYPES = [
  ...SDLC_CONTENT_RELATION_TYPES,
  ...SDLC_STRUCTURAL_RELATIONS,
] as const;

export const sdlcRelationTypeSchema = z.enum(SDLC_RELATION_TYPES);
export const sdlcContentRelationTypeSchema = z.enum(SDLC_CONTENT_RELATION_TYPES);
export type SdlcRelationType = z.infer<typeof sdlcRelationTypeSchema>;

export const sdlcDiscussionSchema = z
  .object({
    repoId: z.string().min(1),
    ownerType: z.enum(["CANVAS", "TRACK"]),
    ownerId: z.string().min(1),
    surfaceType: z.enum(["CANVAS", "TICKET", "PULL_REQUEST"]).optional(),
    surfaceId: z.string().min(1).optional(),
    linkId: z.string().min(1),
  })
  .superRefine((value, ctx) => {
    if (
      value.ownerType === "CANVAS" &&
      (!value.surfaceType || !value.surfaceId)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "CANVAS discussions require surfaceType and surfaceId",
      });
    }
  });
export type SdlcDiscussion = z.infer<typeof sdlcDiscussionSchema>;

export const SDLC_TRACK_STATUSES = ["ACTIVE", "COMPLETED", "ARCHIVED"] as const;
export const sdlcTrackStatusSchema = z.enum(SDLC_TRACK_STATUSES);

/**
 * Call-to-SDLC linking context passed from the call initiator through LiveKit
 * room metadata. Owner is a canvas or a track; the webhook writes
 * OWNER -> CALL [CALL] and OWNER -> CONVERSATION [DISCUSSION] links.
 */
export const sdlcCallLinkSchema = z.object({
  ownerType: z.enum(["CANVAS", "TRACK"]),
  ownerId: z.string().min(1),
});
export type SdlcCallLink = z.infer<typeof sdlcCallLinkSchema>;

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

export const createSdlcChannelSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  // At least one: a hub with no repositories has no screen to render.
  repoIds: z.array(z.string().min(1)).min(1).max(100),
});
export type CreateSdlcChannelInput = z.infer<typeof createSdlcChannelSchema>;

export const addSdlcChannelRepositoriesSchema = z.object({
  repoIds: z.array(z.string().min(1)).min(1).max(100),
});
export type AddSdlcChannelRepositoriesInput = z.infer<
  typeof addSdlcChannelRepositoriesSchema
>;

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
export type SdlcSourceReferenceInput = z.infer<
  typeof sdlcSourceReferenceInputSchema
>;

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

export const createSdlcPullRequestSchema = z
  .object({
    repoId: z.string().min(1),
    title: z.string().trim().min(1).max(256),
    body: z.string().max(65_536).default(""),
    head: z.string().trim().min(1).max(255),
    base: z.string().trim().min(1).max(255),
    commitHash: z
      .string()
      .trim()
      .regex(/^[0-9a-f]{40}$/i),
  })
  .and(sdlcRunAuthoritySchema);
export type CreateSdlcPullRequestInput = z.infer<
  typeof createSdlcPullRequestSchema
>;

export const bootstrapSdlcRuntimeCredentialSchema = z
  .object({
    agentSlug: z.literal("sdlc-agent"),
    repoId: z.string().min(1),
    operation: z.enum(["CLONE", "PUSH", "INTERACTIVE"]),
    sandboxId: z.string().min(1).max(256),
    sandboxPublicKey: z.string().min(32).max(1024),
  })
  .and(sdlcRunAuthoritySchema);
export type BootstrapSdlcRuntimeCredentialInput = z.infer<
  typeof bootstrapSdlcRuntimeCredentialSchema
>;

export const createSdlcClawArtifactSchema = z
  .object({
    repoId: z.string().min(1),
    // The hub to write into. A repository sits in several, so it cannot be inferred.
    channelId: z.string().min(1).optional(),
    kind: sdlcArtifactKindSchema.optional(),
    folderId: z.string().min(1).optional(),
    title: z.string().trim().min(1).max(255),
    markdown: z.string().min(1).max(5_000_000),
    baselineKind: sdlcBaselineKindSchema.optional(),
    setupExecutionId: z.string().min(1).optional(),
    workflowExecutionId: z.string().min(1).optional(),
    relatedCanvasIds: z.array(z.string().min(1)).optional(),
    trackId: z.string().min(1).optional(),
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
    const isArtifact = value.kind !== "BASELINE";
    if (isArtifact) {
      if (!value.folderId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Artifact creation requires a folderId (the artifact type)",
        });
      }
      if (!value.trackId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Artifacts require a track",
        });
      }
    }
  });
export type CreateSdlcClawArtifactInput = z.infer<
  typeof createSdlcClawArtifactSchema
>;

export const updateSdlcClawArtifactSchema = z.object({
  repoId: z.string().min(1),
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
  // Content relations only: membership is not a link a caller may forge.
  relationType: sdlcContentRelationTypeSchema,
});
export type CreateSdlcLinkInput = z.infer<typeof createSdlcLinkSchema>;

export const createSdlcTrackSchema = z.object({
  repoId: z.string().min(1),
  channelId: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
});
export type CreateSdlcTrackInput = z.infer<typeof createSdlcTrackSchema>;

export const createSdlcArtifactTypeSchema = z.object({
  repoId: z.string().min(1),
  channelId: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(80),
});
export type CreateSdlcArtifactTypeInput = z.infer<typeof createSdlcArtifactTypeSchema>;

export const renameSdlcArtifactTypeSchema = z.object({
  repoId: z.string().min(1),
  folderId: z.string().min(1),
  name: z.string().trim().min(1).max(80),
});
export type RenameSdlcArtifactTypeInput = z.infer<typeof renameSdlcArtifactTypeSchema>;

export function inferRepositoryNameFromUrl(raw: string): string | null {
  const value = raw.trim().replace(/^git@([^:]+):/, "https://$1/");
  const path = value.includes("://") ? value.split("://")[1] : value;
  const segments = (path ?? "")
    .split(/[?#]/)[0]!
    .replace(/\.git$/i, "")
    .split("/")
    .filter(Boolean);
  return segments.length >= 3 ? segments.at(-1)! : null;
}
