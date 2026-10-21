import { SDLC_DIRECT_TOOL_NAMES, SDLC_TOOL_NAMES } from "./registry.js";

export type TrustedMcpToolBindings = Record<string, Record<string, unknown>>;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Only who the run acts for is pinned; hub, repository and every other argument
 * are the LLM's choice, and the backend checks the Actor can reach them.
 */
export function trustedSdlcToolBindings(sdlcContext: unknown): TrustedMcpToolBindings | undefined {
  const context = record(sdlcContext);
  const workspaceId = context?.["workspaceId"];
  const actorUserId = context?.["actorUserId"];
  if (typeof context?.["channelId"] !== "string") return undefined;
  if (typeof workspaceId !== "string" || typeof actorUserId !== "string") return undefined;
  const bindings: TrustedMcpToolBindings = Object.fromEntries(
    SDLC_DIRECT_TOOL_NAMES.map((name) => [name, { workspaceId, actorUserId }]),
  );
  // A wiki workflow run pins the commit its pages describe.
  const generationCommit = context["generationCommit"];
  if (typeof generationCommit === "string" && generationCommit) {
    bindings[SDLC_TOOL_NAMES.writeArtifact] = { workspaceId, actorUserId, generationCommit };
  }
  return bindings;
}
