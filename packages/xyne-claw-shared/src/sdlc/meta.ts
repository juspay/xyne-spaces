
export const SDLC_META_KEYS = {
  channelId: "sdlcChannelId",
  repositoryId: "sdlcRepositoryId",
  repositoryName: "sdlcRepositoryName",
  // The Actor, from backend context only: sdlc-repository-access sends these for the access check.
  workspaceId: "sdlcWorkspaceId",
  actorUserId: "sdlcActorUserId",
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
  const meta: Record<string, string> = {};

  const channelId = str(context["channelId"]);
  const workspaceId = str(context["workspaceId"]);
  const actorUserId = str(context["actorUserId"]);
  if (channelId) meta[SDLC_META_KEYS.channelId] = channelId;
  if (workspaceId) meta[SDLC_META_KEYS.workspaceId] = workspaceId;
  if (actorUserId) meta[SDLC_META_KEYS.actorUserId] = actorUserId;

  if (repository) {
    const id = str(repository["id"]);
    const name = str(repository["name"]);
    if (id) meta[SDLC_META_KEYS.repositoryId] = id;
    if (name) meta[SDLC_META_KEYS.repositoryName] = name;
  }

  return meta;
}

export function hasSdlcRepositoryMeta(meta: Record<string, string | undefined>): boolean {
  return Boolean(meta[SDLC_META_KEYS.repositoryId]);
}
