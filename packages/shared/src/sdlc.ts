import { z } from "zod";

export const SDLC_BASELINE_KINDS = [
  "CORE_CODE_MAP",
  "FRONTEND_DESIGN_SYSTEM",
  "CODE_LINT_STANDARDS",
  "RUN_GUIDE",
  "TEST_GUIDE",
] as const;

export const sdlcBaselineKindSchema = z.enum(SDLC_BASELINE_KINDS);
export type SdlcBaselineKind = z.infer<typeof sdlcBaselineKindSchema>;

export const SDLC_ARTIFACT_KINDS = [
  "BASELINE",
  "PRD",
  "TECH_DOC",
] as const;
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
] as const;

export const sdlcEntityTypeSchema = z.enum(SDLC_ENTITY_TYPES);
export type SdlcEntityType = z.infer<typeof sdlcEntityTypeSchema>;

export const SDLC_RELATION_TYPES = [
  "TECH_DOC",
  "TICKET",
  "CONTEXT",
  "PULL_REQUEST",
  "DISCUSSION",
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
    .regex(/^github_pat_[A-Za-z0-9_]+$/, "Enter a GitHub fine-grained personal access token"),
  resourceOwner: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/),
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

export const createSdlcPullRequestSchema = z.object({
  executionId: z.string().min(1),
  sessionId: z.string().min(1),
  repoId: z.string().min(1),
  title: z.string().trim().min(1).max(256),
  body: z.string().max(65_536).default(""),
  head: z.string().trim().min(1).max(255),
  base: z.string().trim().min(1).max(255),
  commitHash: z.string().trim().regex(/^[0-9a-f]{40}$/i),
});
export type CreateSdlcPullRequestInput = z.infer<
  typeof createSdlcPullRequestSchema
>;

export const bootstrapSdlcRuntimeCredentialSchema = z.object({
  agentSlug: z.literal("sdlc-agent"),
  executionId: z.string().min(1),
  sessionId: z.string().min(1),
  repoId: z.string().min(1),
  operation: z.enum(["CLONE", "PUSH"]),
  sandboxId: z.string().min(1).max(256),
  sandboxPublicKey: z.string().min(32).max(1024),
});
export type BootstrapSdlcRuntimeCredentialInput = z.infer<
  typeof bootstrapSdlcRuntimeCredentialSchema
>;

export const createSdlcArtifactSchema = z.object({
  kind: z.enum(["PRD", "TECH_DOC"]),
  title: z.string().trim().min(1).max(255),
  content: z.array(z.unknown()).default([]),
  parentCanvasId: z.string().min(1).optional(),
  generateWithAi: z.boolean().default(false),
  aiPrompt: z.string().trim().max(5_000).optional(),
});
export type CreateSdlcArtifactInput = z.infer<typeof createSdlcArtifactSchema>;

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
  })
  .superRefine((value, ctx) => {
    if (
      value.kind === "BASELINE" &&
      (!value.baselineKind || !value.setupExecutionId || !value.workflowExecutionId)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Baseline artifacts require baselineKind, setupExecutionId, and workflowExecutionId",
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

export const updateSdlcBaselineDraftSchema = z
  .object({
    repoId: z.string().min(1),
    baselineKind: sdlcBaselineKindSchema,
    setupExecutionId: z.string().min(1),
    workflowExecutionId: z.string().min(1),
    title: z.string().trim().min(1).max(255),
    action: z.enum(['begin', 'upsert_section', 'finalize']),
    sectionKey: z.string().trim().min(1).max(80).optional(),
    sectionTitle: z.string().trim().min(1).max(255).optional(),
    markdown: z.string().min(1).max(1_000_000).optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.action === 'upsert_section' &&
      (!value.sectionKey || !value.sectionTitle || !value.markdown)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Section updates require sectionKey, sectionTitle, and markdown',
      });
    }
  });
export type UpdateSdlcBaselineDraftInput = z.infer<
  typeof updateSdlcBaselineDraftSchema
>;

export const createSdlcTicketSchema = z.object({
  title: z.string().trim().min(1).max(255),
  description: z.string().max(50_000).default(""),
  sourceCanvasId: z.string().min(1).optional(),
});
export type CreateSdlcTicketInput = z.infer<
  typeof createSdlcTicketSchema
>;

export const createSdlcLinkSchema = z.object({
  sourceType: sdlcEntityTypeSchema,
  sourceId: z.string().min(1),
  targetType: sdlcEntityTypeSchema,
  targetId: z.string().min(1),
  relationType: sdlcRelationTypeSchema,
});
export type CreateSdlcLinkInput = z.infer<typeof createSdlcLinkSchema>;

export const startSdlcWorkSchema = z.object({
  sourceType: z.enum(["CANVAS", "TICKET"]),
  sourceId: z.string().min(1),
});
export type StartSdlcWorkInput = z.infer<typeof startSdlcWorkSchema>;

export function isSdlcSurfaceMetadata(value: unknown): boolean {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as Record<string, unknown>).surface === "SDLC"
  );
}

export function isSdlcTicketMetadata(value: unknown): boolean {
  return (
    isSdlcSurfaceMetadata(value) &&
    typeof (value as Record<string, unknown>).repoId === "string"
  );
}

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
}

export interface SdlcChannelMetadata {
  surface: "SDLC";
  hiddenFromChat: true;
  repoId: string;
}
