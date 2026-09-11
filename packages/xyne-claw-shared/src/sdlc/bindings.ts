import { SDLC_TOOL_CAPABILITIES, SDLC_TOOL_NAMES } from "./registry.js";

export type TrustedMcpToolBindings = Record<string, Record<string, unknown>>;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function trustedSdlcToolBindings(
  sdlcContext: unknown,
  runChannelId?: string,
): TrustedMcpToolBindings | undefined {
  const context = record(sdlcContext);
  const repository = record(context?.["repository"]);
  const repoId = repository?.["id"];
  const contextChannelId = context?.["channelId"];
  const channelId =
    typeof contextChannelId === "string" && contextChannelId
      ? contextChannelId
      : runChannelId;
  const channelBinding = channelId ? { channelId } : {};

  if (typeof context?.["operation"] !== "string" || typeof repoId !== "string") {
    return channelId
      ? { [SDLC_TOOL_NAMES.listRepositories]: { channelId } }
      : undefined;
  }

  const execution = record(context["execution"]);
  const executionId = execution?.["workflowExecutionId"];
  const sessionId = execution?.["sessionId"];
  const hasExecution = typeof executionId === "string" && typeof sessionId === "string";
  const workspaceId = context["workspaceId"];
  const actorUserId = context["actorUserId"];
  const interactiveGrant = context["interactiveGrant"];
  const conversationId = execution?.["conversationId"];
  const hasRepositoryIdentity =
    typeof workspaceId === "string" && typeof actorUserId === "string";
  const bindings: TrustedMcpToolBindings = {};
  if (channelId) bindings[SDLC_TOOL_NAMES.listRepositories] = { channelId };

  for (const capability of SDLC_TOOL_CAPABILITIES) {
    if (capability.transport !== "direct" || capability.trustedBinding === "none") continue;
    if (
      context["operation"] === "wiki" &&
      hasExecution &&
      (capability.name === SDLC_TOOL_NAMES.listArtifacts ||
        capability.name === SDLC_TOOL_NAMES.mutateArtifact)
    ) {
      bindings[capability.name] = {
        executionId,
        sessionId,
        repoId,
        ...channelBinding,
        ...(hasRepositoryIdentity ? { workspaceId, actorUserId } : {}),
      };
      continue;
    }
    if (capability.trustedBinding === "hub" && hasRepositoryIdentity) {
      bindings[capability.name] = { workspaceId, actorUserId, ...channelBinding };
      continue;
    }
    if (capability.trustedBinding === "repository" && hasRepositoryIdentity) {
      bindings[capability.name] = {
        repoId,
        workspaceId,
        actorUserId,
        ...channelBinding,
      };
      continue;
    }
    if (
      hasExecution &&
      (capability.trustedBinding === "execution" ||
        capability.trustedBinding === "execution_or_interactive" ||
        (capability.trustedBinding === "wiki_execution" && context["operation"] === "wiki"))
    ) {
      bindings[capability.name] = { executionId, sessionId, repoId };
      continue;
    }
    if (
      capability.trustedBinding === "execution_or_interactive" &&
      context["operation"] === "interactive" &&
      typeof interactiveGrant === "string" &&
      typeof conversationId === "string"
    ) {
      bindings[capability.name] = { interactiveGrant, conversationId, repoId };
    }
  }

  return Object.keys(bindings).length > 0 ? bindings : undefined;
}
