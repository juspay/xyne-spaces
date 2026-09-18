import { SDLC_TOOL_CAPABILITIES, SDLC_TOOL_NAMES } from "./registry.js";

export type TrustedMcpToolBindings = Record<string, Record<string, unknown>>;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Hub and Actor come only from backend context; a run without it gets no bindings. */
export function trustedSdlcToolBindings(sdlcContext: unknown): TrustedMcpToolBindings | undefined {
  const context = record(sdlcContext);
  const repository = record(context?.["repository"]);
  const rawRepoId = repository?.["id"];
  const repoId = typeof rawRepoId === "string" ? rawRepoId : undefined;
  const repoBinding = repoId ? { repoId } : {};
  const contextChannelId = context?.["channelId"];
  const channelId =
    typeof contextChannelId === "string" && contextChannelId ? contextChannelId : undefined;
  const channelBinding = channelId ? { channelId } : {};

  if (typeof context?.["operation"] !== "string") return undefined;

  const workspaceId = context["workspaceId"];
  const actorUserId = context["actorUserId"];
  const generationCommit = context["generationCommit"];
  const hasRepositoryIdentity =
    typeof workspaceId === "string" && typeof actorUserId === "string";
  const bindings: TrustedMcpToolBindings = {};
  if (channelId) bindings[SDLC_TOOL_NAMES.listRepositories] = { channelId };

  for (const capability of SDLC_TOOL_CAPABILITIES) {
    if (capability.transport !== "direct" || capability.trustedBinding === "none") continue;
    if (capability.trustedBinding === "hub" && hasRepositoryIdentity) {
      bindings[capability.name] = { workspaceId, actorUserId, ...channelBinding };
      continue;
    }
    if (capability.trustedBinding === "repository" && hasRepositoryIdentity) {
      bindings[capability.name] = {
        ...repoBinding,
        workspaceId,
        actorUserId,
        ...channelBinding,
        ...(capability.name === SDLC_TOOL_NAMES.mutateArtifact && typeof generationCommit === "string" && generationCommit
          ? { generationCommit }
          : {}),
      };
      continue;
    }
    // The repository is the LLM's choice; the backend checks the Actor can reach it.
    if (capability.trustedBinding === "actor" && hasRepositoryIdentity) {
      bindings[capability.name] = { workspaceId, actorUserId };
    }
  }

  return Object.keys(bindings).length > 0 ? bindings : undefined;
}
