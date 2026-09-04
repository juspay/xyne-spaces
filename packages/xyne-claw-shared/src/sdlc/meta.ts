
export const SDLC_META_KEYS = {
  channelId: "sdlcChannelId",
  repositoryId: "sdlcRepositoryId",
  repositoryName: "sdlcRepositoryName",
  repositoryUrl: "sdlcRepositoryUrl",
  repositoryBaseBranch: "sdlcRepositoryBaseBranch",
  executionId: "sdlcExecutionId",
  sessionId: "sdlcSessionId",
  conversationId: "sdlcConversationId",
  runtimeCredentialOperation: "sdlcRuntimeCredentialOperation",
  interactiveGrant: "sdlcInteractiveGrant",
  wikiRun: "sdlcWikiRun",
  wikiRole: "sdlcWikiRole",
  wikiAssignedCommitShas: "sdlcWikiAssignedCommitShas",
  wikiBootstrapRef: "sdlcWikiBootstrapRef",
  wikiTargetHeadSha: "sdlcWikiTargetHeadSha",
} as const;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function packSdlcRunMeta(sdlcContext: unknown): Record<string, string> {
  const context = record(sdlcContext);
  if (!context) return {};
  const repository = record(context["repository"]);
  const execution = record(context["execution"]);
  const wiki = record(context["wiki"]);
  const meta: Record<string, string> = {};

  const channelId = str(context["channelId"]);
  if (channelId) meta[SDLC_META_KEYS.channelId] = channelId;

  if (repository) {
    const id = str(repository["id"]);
    const name = str(repository["name"]);
    const url = str(repository["url"]);
    const baseBranch = str(repository["baseBranch"]);
    if (id) meta[SDLC_META_KEYS.repositoryId] = id;
    if (name) meta[SDLC_META_KEYS.repositoryName] = name;
    if (url) meta[SDLC_META_KEYS.repositoryUrl] = url;
    if (baseBranch) meta[SDLC_META_KEYS.repositoryBaseBranch] = baseBranch;

    const executionId = str(execution?.["workflowExecutionId"]);
    const sessionId = str(execution?.["sessionId"]);
    const conversationId = str(execution?.["conversationId"]);
    if (executionId) meta[SDLC_META_KEYS.executionId] = executionId;
    if (sessionId) meta[SDLC_META_KEYS.sessionId] = sessionId;
    if (conversationId) meta[SDLC_META_KEYS.conversationId] = conversationId;

    const interactiveGrant = str(context["interactiveGrant"]);
    if (executionId && sessionId) {
      meta[SDLC_META_KEYS.runtimeCredentialOperation] =
        context["operation"] === "work" ? "PUSH" : "CLONE";
    } else if (context["operation"] === "interactive" && interactiveGrant) {
      meta[SDLC_META_KEYS.runtimeCredentialOperation] = "INTERACTIVE";
      meta[SDLC_META_KEYS.interactiveGrant] = interactiveGrant;
    }
  }

  if (context["operation"] === "wiki" && wiki) {
    meta[SDLC_META_KEYS.wikiRun] = "true";
    const role = str(wiki["role"]);
    const bootstrapRef = str(wiki["bootstrapRef"]);
    const targetHeadSha = str(wiki["targetHeadSha"]);
    if (role) meta[SDLC_META_KEYS.wikiRole] = role;
    if (Array.isArray(wiki["assignedCommitShas"])) {
      meta[SDLC_META_KEYS.wikiAssignedCommitShas] = JSON.stringify(
        wiki["assignedCommitShas"].filter((value) => typeof value === "string"),
      );
    }
    if (bootstrapRef) meta[SDLC_META_KEYS.wikiBootstrapRef] = bootstrapRef;
    if (targetHeadSha) meta[SDLC_META_KEYS.wikiTargetHeadSha] = targetHeadSha;
  }

  return meta;
}

export function hasSdlcRepositoryMeta(meta: Record<string, string | undefined>): boolean {
  return Boolean(meta[SDLC_META_KEYS.repositoryId]);
}
