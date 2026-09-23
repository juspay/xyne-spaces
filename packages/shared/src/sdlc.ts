import { z } from "zod";

/** A Hub Knowledge document's sdlc_artifacts.artifactType. */
export const SDLC_HUB_KNOWLEDGE_ARTIFACT_TYPE = "HUB_KNOWLEDGE";

export function isHubKnowledgeArtifactType(value: string | null | undefined): boolean {
  return value === SDLC_HUB_KNOWLEDGE_ARTIFACT_TYPE;
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
  "WORKFLOW",
  "TRACK",
  "FOLDER",
  "LINK",
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

export const SDLC_ARTIFACT_REPOSITORY_RELATION = "CONTEXT";

export const SDLC_HUB_KNOWLEDGE_FOLDER = "Hub Knowledge";

export function sdlcHubKnowledgeFolderId(channelId: string): string {
  return `sdlc-knowledge-${channelId}`;
}

export const SDLC_WORKFLOW_RELATION = "WORKFLOW";
export const SDLC_WIKI_WORKFLOW_RELATION = "WIKI_WORKFLOW";

export const SDLC_ACTIVE_RUN_STATUSES = [
  "NEW",
  "PENDING",
  "SCHEDULED",
  "RUNNING",
  "EXTERNAL_WAIT",
  "WAITING_FOR_CHILD_EXECUTIONS",
  "PAUSED",
] as const;

export function sdlcHubWorkflowFolderId(channelId: string): string {
  return `sdlc-hub-${channelId}`;
}

/**
 * The parent -> child edge: a TRACK or FOLDER on the source side, the thing it
 * holds on the target. Shares its name with track membership because a root-level
 * item's containment edge *is* its track membership; nesting only changes which
 * parent is on the source side.
 */
export const SDLC_CONTAINMENT_RELATION = "TRACK_ITEM";

/** Separate from TRACK_ITEM so the hub link graph leaves the Wiki trees out and users cannot move them. */
export const SDLC_HUB_ITEM_RELATION = "HUB_ITEM";

/** A scope folder -> every item under it, so one repository's wiki is one lookup. */
export const SDLC_HUB_ITEM_FLAT_RELATION = "HUB_ITEM_SECONDARY";

export const SDLC_WIKI_FOLDER = "Wiki";
export const SDLC_HUB_WIKI_FOLDER = "Hub";

export function sdlcWikiFolderId(channelId: string): string {
  return `sdlc-wiki-${channelId}`;
}

export function sdlcRepositoryWikiFolderId(channelId: string, repoId: string): string {
  return `sdlc-wiki-${channelId}-${repoId}`;
}

export function sdlcHubWikiFolderId(channelId: string): string {
  return `sdlc-wiki-hub-${channelId}`;
}

/**
 * What the folder tree renders. Tickets ride the same relationType from a track
 * but belong to their own section, so the tree filters rather than assuming
 * everything a track holds is a tree node.
 */
export const SDLC_TREE_TARGET_TYPES = [
  "FOLDER",
  "CANVAS",
  "ATTACHMENT",
  "LINK",
] as const;

/**
 * A TRACK -> item edge kept alongside the containment edge, so "everything in
 * this track" is one indexed lookup rather than a walk down the folder tree.
 * Derived: written and removed with the item it mirrors, never on its own.
 */
export const SDLC_TRACK_FLAT_RELATION = "TRACK_ITEM_SECONDARY";

/**
 * Edges no user may write or delete through the generic link API. Derived or
 * structural: the app maintains them with the thing they describe.
 */
export const SDLC_STRUCTURAL_RELATIONS = [
  SDLC_MEMBERSHIP_RELATION,
  SDLC_TRACK_MEMBERSHIP_RELATION,
  SDLC_TRACK_FLAT_RELATION,
  SDLC_WORKFLOW_RELATION,
  SDLC_WIKI_WORKFLOW_RELATION,
  SDLC_HUB_ITEM_RELATION,
  SDLC_HUB_ITEM_FLAT_RELATION,
] as const;

/**
 * Edges a hub's link graph leaves out: they place things in the hub rather than
 * relate them, so readers of the graph would double-count them.
 *
 * Narrower than SDLC_STRUCTURAL_RELATIONS on purpose. The flat track edge is not
 * user-writable, but the client does need to read it — excluding it here is what
 * made a track's artifact count read zero.
 */
export const SDLC_HUB_GRAPH_EXCLUDED_RELATIONS = [
  SDLC_MEMBERSHIP_RELATION,
  SDLC_TRACK_MEMBERSHIP_RELATION,
  SDLC_WORKFLOW_RELATION,
  SDLC_WIKI_WORKFLOW_RELATION,
  SDLC_HUB_ITEM_RELATION,
  SDLC_HUB_ITEM_FLAT_RELATION,
] as const;

/** Relation types a user may create or delete through the generic link API. */
export const SDLC_CONTENT_RELATION_TYPES = [
  "TICKET",
  "CONTEXT",
  "PULL_REQUEST",
  "DISCUSSION",
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
    repoId: z.string().min(1).optional(),
    ownerType: z.enum([
      "CANVAS",
      "TRACK",
      "FOLDER",
      "ATTACHMENT",
      "LINK",
    ]),
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

export const entityLinkContextSchema = z.object({
  sourceType: z.enum([
    "CANVAS",
    "TRACK",
    "FOLDER",
    "ATTACHMENT",
    "LINK",
  ]),
  sourceId: z.string().min(1),
  linkId: z.string().min(1),
  /**
   * A folder's conversation is filed on its track as well, so the track's list
   * shows everything discussed anywhere inside it. The flat relation, not a
   * second DISCUSSION row: DISCUSSION has to stay one per conversation or
   * resolveInheritedOwner picks between owners arbitrarily.
   */
  trackRollUp: z
    .object({ trackId: z.string().min(1), linkId: z.string().min(1) })
    .optional(),
});
export type EntityLinkContextInput = z.infer<typeof entityLinkContextSchema>;

export const entityLinkOwnerSchema = entityLinkContextSchema.omit({
  linkId: true,
  trackRollUp: true,
});
export type EntityLinkOwner = z.infer<typeof entityLinkOwnerSchema>;

export const SDLC_TRACK_STATUSES = ["ACTIVE", "COMPLETED", "ARCHIVED"] as const;
export const sdlcTrackStatusSchema = z.enum(SDLC_TRACK_STATUSES);

/**
 * Call-to-SDLC linking context passed from the call initiator through LiveKit
 * room metadata. Owner is a canvas or a track; the webhook writes
 * OWNER -> CALL [CALL] and OWNER -> CONVERSATION [DISCUSSION] links.
 */
export const sdlcCallLinkSchema = z.object({
  ownerType: z.enum([
    "CANVAS",
    "TRACK",
    "FOLDER",
    "LINK",
    "ATTACHMENT",
  ]),
  ownerId: z.string().min(1),
});
export type SdlcCallLink = z.infer<typeof sdlcCallLinkSchema>;

export const createSdlcChannelSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  repoIds: z.array(z.string().min(1)).max(100).default([]),
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
  // Omitted: the Provider's default branch, or main when it cannot be read.
  baseBranch: z.string().trim().min(1).max(255).optional(),
  // Required only when more than one credential serves the link's host.
  credentialId: z.string().min(1).optional(),
});
export type AttachSdlcRepositoryInput = z.infer<
  typeof attachSdlcRepositorySchema
>;

export const resolveSdlcRepositoryLinkSchema = z.object({
  projectId: z.string().min(1),
  url: z.string().trim().min(1).max(2048),
});
export type ResolveSdlcRepositoryLinkInput = z.infer<
  typeof resolveSdlcRepositoryLinkSchema
>;

export const SDLC_VCS_PROVIDERS = ["GITHUB", "BITBUCKET_SERVER"] as const;
export const sdlcVcsProviderSchema = z.enum(SDLC_VCS_PROVIDERS);
export type SdlcVcsProvider = z.infer<typeof sdlcVcsProviderSchema>;

export const SDLC_GITHUB_HOST = "github.com";

const sdlcCredentialNameSchema = z.string().trim().min(1).max(80);
const sdlcGithubTokenSchema = z
  .string()
  .trim()
  .min(20)
  .max(512)
  .regex(
    /^github_pat_[A-Za-z0-9_]+$/,
    "Enter a GitHub fine-grained personal access token",
  );
const sdlcBitbucketTokenSchema = z
  .string()
  .trim()
  .min(20)
  .max(512)
  .regex(/^[A-Za-z0-9+/=_-]+$/, "Enter a Bitbucket personal HTTP access token");
const sdlcBitbucketHostSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/, "Enter a host name such as bitbucket.example.com")
  .refine((host) => host !== SDLC_GITHUB_HOST, "Use the GitHub provider for github.com");

export function sdlcTokenSchemaFor(provider: SdlcVcsProvider) {
  return provider === "GITHUB" ? sdlcGithubTokenSchema : sdlcBitbucketTokenSchema;
}

export const createSdlcVcsCredentialSchema = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal("GITHUB"),
    name: sdlcCredentialNameSchema,
    token: sdlcGithubTokenSchema,
  }),
  z.object({
    provider: z.literal("BITBUCKET_SERVER"),
    name: sdlcCredentialNameSchema,
    host: sdlcBitbucketHostSchema,
    token: sdlcBitbucketTokenSchema,
  }),
]);
export type CreateSdlcVcsCredentialInput = z.infer<
  typeof createSdlcVcsCredentialSchema
>;

export const updateSdlcVcsCredentialSchema = z
  .object({
    name: sdlcCredentialNameSchema.optional(),
    token: z.string().trim().min(20).max(512).optional(),
  })
  .refine((value) => value.name !== undefined || value.token !== undefined, {
    message: "Provide a name or a token",
  });
export type UpdateSdlcVcsCredentialInput = z.infer<
  typeof updateSdlcVcsCredentialSchema
>;

export const checkSdlcRepositoryAccessSchema = z.object({
  force: z.boolean().default(false),
});
export type CheckSdlcRepositoryAccessInput = z.infer<
  typeof checkSdlcRepositoryAccessSchema
>;

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

const sdlcWikiFolderPathSchema = z
  .string()
  .trim()
  .max(512)
  .describe('Folders under the wiki scope, separated by "/". Empty is the scope root.');
const sdlcWikiTitleSchema = z.string().trim().min(1).max(255);
const sdlcWikiHeadingSchema = z.string().trim().min(1).max(255);
const sdlcWikiCanvasIdSchema = z.string().min(1);

export const sdlcWikiPageActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    folderPath: sdlcWikiFolderPathSchema.optional(),
    title: sdlcWikiTitleSchema,
    markdown: z.string().min(1).max(5_000_000),
  }),
  z.object({
    action: z.literal("update"),
    canvasId: sdlcWikiCanvasIdSchema,
    title: sdlcWikiTitleSchema.optional(),
    markdown: z.string().min(1).max(5_000_000),
  }),
  z.object({
    action: z.literal("replace_section"),
    canvasId: sdlcWikiCanvasIdSchema,
    heading: sdlcWikiHeadingSchema,
    markdown: z.string().min(1).max(1_000_000),
  }),
  z.object({
    action: z.literal("insert_section"),
    canvasId: sdlcWikiCanvasIdSchema,
    heading: sdlcWikiHeadingSchema,
    markdown: z.string().min(1).max(1_000_000),
  }),
  z.object({
    action: z.literal("remove_section"),
    canvasId: sdlcWikiCanvasIdSchema,
    heading: sdlcWikiHeadingSchema,
  }),
  z.object({ action: z.literal("archive"), canvasId: sdlcWikiCanvasIdSchema }),
  z.object({ action: z.literal("restore"), canvasId: sdlcWikiCanvasIdSchema }),
  z.object({
    action: z.literal("move"),
    canvasId: sdlcWikiCanvasIdSchema,
    folderPath: sdlcWikiFolderPathSchema,
    title: sdlcWikiTitleSchema.optional(),
  }),
]);
export type SdlcWikiPageAction = z.infer<typeof sdlcWikiPageActionSchema>;

const sdlcWikiScopeSchema = z.object({
  workspaceId: z.string().min(1),
  actorUserId: z.string().min(1),
  channelId: z.string().min(1),
  // Absent is the Hub Wiki.
  repoId: z.string().min(1).optional(),
});

export const listSdlcWikiPagesSchema = sdlcWikiScopeSchema.extend({
  includeArchived: z.boolean().optional(),
});
export type ListSdlcWikiPagesInput = z.infer<typeof listSdlcWikiPagesSchema>;

export const writeSdlcWikiPageSchema = sdlcWikiScopeSchema.extend({
  generationCommit: z.string().trim().min(1).max(255).optional(),
  page: sdlcWikiPageActionSchema,
});
export type WriteSdlcWikiPageInput = z.infer<typeof writeSdlcWikiPageSchema>;

/** A Wiki page on the artifact create endpoint: same row shape, placed by the Wiki store. */
export const createSdlcClawWikiPageSchema = z.object({
  artifactType: z.literal("WIKI"),
  channelId: z.string().min(1),
  // Absent is the Hub Wiki.
  repoId: z.string().min(1).optional(),
  folderPath: sdlcWikiFolderPathSchema.optional(),
  title: sdlcWikiTitleSchema,
  markdown: z.string().min(1).max(5_000_000),
});
export type CreateSdlcClawWikiPageInput = z.infer<
  typeof createSdlcClawWikiPageSchema
>;

export const setSdlcArtifactArchivedSchema = z.object({
  archived: z.boolean(),
});
export type SetSdlcArtifactArchivedInput = z.infer<
  typeof setSdlcArtifactArchivedSchema
>;

/** The Actor pair is current; the grant pair is what the older claw still sends, removed once it is gone. */
const sdlcRunAuthorityFields = {
  workspaceId: z.string().min(1).optional(),
  actorUserId: z.string().min(1).optional(),
  interactiveGrant: z.string().min(1).optional(),
  conversationId: z.string().min(1).optional(),
};

function hasRunAuthority(value: {
  workspaceId?: string | undefined;
  actorUserId?: string | undefined;
  interactiveGrant?: string | undefined;
  conversationId?: string | undefined;
}): boolean {
  return Boolean(
    (value.workspaceId && value.actorUserId) || (value.interactiveGrant && value.conversationId),
  );
}

const SDLC_RUN_AUTHORITY_MESSAGE = "workspaceId and actorUserId are required";

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
    draft: z.boolean().default(true),
    ...sdlcRunAuthorityFields,
  })
  .refine(hasRunAuthority, { message: SDLC_RUN_AUTHORITY_MESSAGE });
export type CreateSdlcPullRequestInput = z.infer<
  typeof createSdlcPullRequestSchema
>;

export const SDLC_AGENT_SLUG = "sdlc-agent" as const;

export const resolveSdlcAgentRepositorySchema = z.object({
  agentSlug: z.literal(SDLC_AGENT_SLUG),
  repoId: z.string().min(1),
  actorUserId: z.string().min(1),
  conversationId: z.string().min(1),
  channelId: z.string().min(1).optional(),
});
export type ResolveSdlcAgentRepositoryInput = z.infer<
  typeof resolveSdlcAgentRepositorySchema
>;

export const bootstrapSdlcRuntimeCredentialSchema = z
  .object({
    agentSlug: z.literal(SDLC_AGENT_SLUG).optional(),
    repoId: z.string().min(1),
    operation: z.literal("INTERACTIVE").optional(),
    sandboxId: z.string().min(1).max(256),
    sandboxPublicKey: z.string().min(32).max(1024),
    ...sdlcRunAuthorityFields,
  })
  .refine(hasRunAuthority, { message: SDLC_RUN_AUTHORITY_MESSAGE });
export type BootstrapSdlcRuntimeCredentialInput = z.infer<
  typeof bootstrapSdlcRuntimeCredentialSchema
>;

export interface SdlcSandboxGitCredential {
  provider: SdlcVcsProvider;
  host: string;
  cloneUrl: string;
  username: string;
  password: string;
  accountName: string;
  accountEmail: string;
}

export const listSdlcEntityLinksSchema = z.object({
  channelId: z.string().min(1),
  entityType: sdlcEntityTypeSchema,
  entityId: z.string().min(1),
  relationType: z.string().min(1).optional(),
  otherType: sdlcEntityTypeSchema.optional(),
  limit: z.number().int().min(1).max(200).default(100),
});
export type ListSdlcEntityLinksInput = z.infer<typeof listSdlcEntityLinksSchema>;

export const sdlcRepoIdsSchema = z.array(z.string().min(1)).max(50).optional();

export function sdlcRepoIds(input: {
  repoId?: string | undefined;
  repoIds?: string[] | undefined;
}): string[] {
  if (input.repoIds) return [...new Set(input.repoIds)];
  return input.repoId ? [input.repoId] : [];
}

export const createSdlcClawArtifactSchema = z.object({
  repoId: z.string().min(1).optional(),
  repoIds: sdlcRepoIdsSchema,
  // The hub to write into. A repository sits in several, so it cannot be inferred.
  channelId: z.string().min(1).optional(),
  folderId: z.string().min(1),
  title: z.string().trim().min(1).max(255),
  markdown: z.string().min(1).max(5_000_000),
  relatedCanvasIds: z.array(z.string().min(1)).optional(),
  trackId: z.string().min(1).optional(),
  sourceReferences: sdlcSourceReferencesSchema,
});
export type CreateSdlcClawArtifactInput = z.infer<
  typeof createSdlcClawArtifactSchema
>;

/** Every SDLC document is a Canvas plus an SdlcArtifact row; artifactType picks the placement. */
export const createSdlcClawDocumentSchema = z.union([
  createSdlcClawWikiPageSchema,
  createSdlcClawArtifactSchema,
]);
export type CreateSdlcClawDocumentInput = z.infer<
  typeof createSdlcClawDocumentSchema
>;

export const updateSdlcClawArtifactSchema = z.object({
  repoId: z.string().min(1).optional(),
  channelId: z.string().min(1).optional(),
  canvasId: z.string().min(1),
  title: z.string().trim().min(1).max(255).optional(),
  markdown: z.string().min(1).max(5_000_000),
  sourceReferences: sdlcSourceReferencesSchema,
});
export type UpdateSdlcClawArtifactInput = z.infer<
  typeof updateSdlcClawArtifactSchema
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

export const createSdlcClawLinkSchema = createSdlcLinkSchema.extend({
  channelId: z.string().min(1).optional(),
  repoId: z.string().min(1).optional(),
  repoIds: sdlcRepoIdsSchema,
});
export type CreateSdlcClawLinkInput = z.infer<typeof createSdlcClawLinkSchema>;

export const createSdlcTrackSchema = z.object({
  repoId: z.string().min(1).optional(),
  channelId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
});
export type CreateSdlcTrackInput = z.infer<typeof createSdlcTrackSchema>;

export const createSdlcArtifactTypeSchema = z.object({
  repoId: z.string().min(1).optional(),
  channelId: z.string().min(1),
  name: z.string().trim().min(1).max(80),
});
export type CreateSdlcArtifactTypeInput = z.infer<typeof createSdlcArtifactTypeSchema>;

export const renameSdlcArtifactTypeSchema = z.object({
  repoId: z.string().min(1).optional(),
  channelId: z.string().min(1),
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

export const SDLC_SECTIONS = [
  "overview",
  "wiki",
  "knowledge",
  "tracks",
  "tickets",
  "artifacts",
] as const;
export type SdlcSection = (typeof SDLC_SECTIONS)[number];

/** A schema because it crosses the wire. */
export const sdlcNavTargetSchema = z.object({
  channelId: z.string().min(1),
  section: z.enum(SDLC_SECTIONS),
  canvasId: z.string().min(1).optional(),
  folderId: z.string().min(1).optional(),
  trackId: z.string().min(1).optional(),
  ticketId: z.string().min(1).optional(),
  conversationId: z.string().min(1).optional(),
  messageId: z.string().min(1).optional(),
  blockId: z.string().min(1).optional(),
  commentThreadId: z.string().min(1).optional(),
});
export type SdlcNavTarget = z.infer<typeof sdlcNavTargetSchema>;

export function parseSdlcNavTarget(value: unknown): SdlcNavTarget | null {
  const parsed = sdlcNavTargetSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Hub Knowledge and the wiki get their own sections; every other artifact a folder. */
export function sdlcSectionForCanvas(
  artifactType: string | null | undefined,
  folderId: string | null | undefined,
): { section: SdlcSection; folderId?: string } {
  if (isHubKnowledgeArtifactType(artifactType)) return { section: "knowledge" };
  if (artifactType === "WIKI") return { section: "wiki" };
  return { section: "artifacts", ...(folderId ? { folderId } : {}) };
}

function messageAnchor(target: SdlcNavTarget): string {
  if (!target.conversationId) return "";
  const anchor = new URLSearchParams({ origin: target.conversationId });
  if (target.messageId) anchor.set("messageId", target.messageId);
  return `#${anchor.toString()}`;
}

/** The repository is chosen inside the screen; the workspace prefix by the caller. */
export function buildSdlcPath(target: SdlcNavTarget): string {
  const hub = `/sdlc/${encodeURIComponent(target.channelId)}`;
  if (target.ticketId) {
    return `${hub}/tickets/${encodeURIComponent(target.ticketId)}${messageAnchor(target)}`;
  }

  const search = new URLSearchParams();
  if (target.canvasId) search.set("canvas", target.canvasId);
  if (target.folderId) search.set("type", target.folderId);
  if (target.trackId) search.set("track", target.trackId);
  if (target.blockId) search.set("blockId", target.blockId);
  if (target.commentThreadId) search.set("commentThreadId", target.commentThreadId);

  // Opens on any artifact or track, showing that owner's threads when none is named.
  if (target.conversationId || target.canvasId || target.trackId) {
    search.set("discussion", "1");
    search.set("chat", "conversations");
  }
  if (target.conversationId) search.set("conversation", target.conversationId);
  const hash = messageAnchor(target);

  const query = search.toString();
  return `${hub}/${target.section}${query ? `?${query}` : ""}${hash}`;
}

const nullableNonEmpty = z.string().min(1).nullable();

export const SDLC_AGENT_OPERATIONS = ["interactive"] as const;
export const sdlcAgentOperationSchema = z.enum(SDLC_AGENT_OPERATIONS);
export type SdlcAgentOperation = z.infer<typeof sdlcAgentOperationSchema>;

export const sdlcAgentContextSchema = z.object({
  version: z.literal(1),
  operation: sdlcAgentOperationSchema,
  workspaceId: z.string().min(1),
  projectId: z.string().min(1),
  channelId: z.string().min(1),
  actorUserId: z.string().min(1),
  repository: z
    .object({
      id: z.string().min(1),
      name: z.string().min(1),
      url: z.string().min(1),
      baseBranch: z.string().min(1),
    })
    .optional(),
  execution: z.object({ conversationId: z.string().min(1) }),
  // Only the claw deployed before Actor-based access reads this.
  interactiveGrant: z.string().min(1).optional(),
  generationCommit: nullableNonEmpty.optional(),
});
export type SdlcAgentContext = z.infer<typeof sdlcAgentContextSchema>;

/**
 * What a hub file is allowed to be. Documents, media and the office formats
 * people actually file into a track — not archives or executables, which are
 * payloads rather than things anyone reads in place.
 *
 * The extension is the primary gate and the mime type only confirms it: a
 * browser hands us `application/octet-stream` (or nothing at all) for .md and
 * for the office formats often enough that trusting the mime type alone would
 * reject files the user can plainly see are documents.
 */
export const SDLC_UPLOAD_EXTENSIONS = [
  // documents
  "pdf",
  "md",
  "markdown",
  "txt",
  "rtf",
  "doc",
  "docx",
  "odt",
  "html",
  "htm",
  // spreadsheets
  "csv",
  "tsv",
  "xls",
  "xlsx",
  "xlsm",
  "ods",
  // presentations
  "ppt",
  "pptx",
  "odp",
  // images
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "bmp",
  "tif",
  "tiff",
  "heic",
  "heif",
  // video
  "mp4",
  "mov",
  "webm",
  "m4v",
  "avi",
  "mkv",
] as const;

/** `accept` for a file input, so the picker offers only what will be taken. */
export const SDLC_UPLOAD_ACCEPT = SDLC_UPLOAD_EXTENSIONS.map(
  (extension) => `.${extension}`,
).join(",");

/**
 * Active-content formats (html, and svg were it listed) are safe to accept only
 * because the attachment stream refuses to serve them inline — see
 * SAFE_INLINE_MIME_TYPES in safeAttachmentDownload.ts, which forces a download
 * and never echoes a client-supplied Content-Type. Opening one saves the file
 * rather than rendering it in our origin.
 */
export function isAllowedSdlcUpload(
  filename: string,
  mimetype: string,
): boolean {
  const extension = filename.includes(".")
    ? (filename.split(".").pop() ?? "").trim().toLowerCase()
    : "";
  if (!extension) return false;
  if (!(SDLC_UPLOAD_EXTENSIONS as readonly string[]).includes(extension)) {
    return false;
  }
  // The extension carries the decision, but an explicit archive or executable
  // mime type overrides it: that pairing is a rename, not a document.
  const mime = mimetype.split(";")[0]?.trim().toLowerCase() ?? "";
  if (/zip|x-tar|gzip|x-7z|x-rar|x-msdownload|x-executable|x-mach-binary/.test(mime)) {
    return false;
  }
  return true;
}
