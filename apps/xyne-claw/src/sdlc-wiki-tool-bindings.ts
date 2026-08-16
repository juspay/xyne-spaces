import { SDLC_TOOL_CAPABILITIES, SDLC_TOOL_NAMES } from "xyne-claw-shared";
import type { TrustedMcpToolBindings } from "./mcp.js";

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Build server-owned argument bindings from trusted SDLC run context. */
export function trustedSdlcToolBindings(
  sdlcContext: unknown,
): TrustedMcpToolBindings | undefined {
  const context = record(sdlcContext);
  const repository = record(context?.["repository"]);
  const repoId = repository?.["id"];
  if (typeof context?.["operation"] !== "string" || typeof repoId !== "string") {
    return undefined;
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
        ...(hasRepositoryIdentity ? { workspaceId, actorUserId } : {}),
      };
      continue;
    }
    if (capability.trustedBinding === "repository" && hasRepositoryIdentity) {
      bindings[capability.name] = {
        repoId,
        workspaceId,
        actorUserId,
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

/** Wiki checkpoint projection retained for callers that only need Wiki bindings. */
export function trustedSdlcWikiToolBindings(
  sdlcContext: unknown,
): TrustedMcpToolBindings | undefined {
  const bindings = trustedSdlcToolBindings(sdlcContext);
  if (!bindings) return undefined;
  const wikiBindings = Object.fromEntries(
    Object.entries(bindings).filter(([toolName]) => toolName.startsWith("spaces-sdlc-wiki-")),
  );
  return Object.keys(wikiBindings).length > 0 ? wikiBindings : undefined;
}
