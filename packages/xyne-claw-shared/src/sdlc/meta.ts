
export const SDLC_META_KEYS = {
  channelId: "sdlcChannelId",
  repositoryId: "sdlcRepositoryId",
  repositoryName: "sdlcRepositoryName",
  repositoryUrl: "sdlcRepositoryUrl",
  repositoryBaseBranch: "sdlcRepositoryBaseBranch",
  conversationId: "sdlcConversationId",
  runtimeCredentialOperation: "sdlcRuntimeCredentialOperation",
  interactiveGrant: "sdlcInteractiveGrant",
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
  }

  const conversationId = str(execution?.["conversationId"]);
  const interactiveGrant = str(context["interactiveGrant"]);
  if (conversationId) meta[SDLC_META_KEYS.conversationId] = conversationId;
  if (interactiveGrant) {
    meta[SDLC_META_KEYS.runtimeCredentialOperation] = "INTERACTIVE";
    meta[SDLC_META_KEYS.interactiveGrant] = interactiveGrant;
  }

  return meta;
}

export function hasSdlcRepositoryMeta(meta: Record<string, string | undefined>): boolean {
  return Boolean(meta[SDLC_META_KEYS.repositoryId]);
}
