import type { TrustedMcpToolBindings } from "./mcp.js";

const SDLC_WIKI_MCP_TOOLS = [
  "spaces-sdlc-wiki-list-pages",
  "spaces-sdlc-wiki-read-page",
  "spaces-sdlc-wiki-verify-sources",
  "spaces-sdlc-wiki-begin-checkpoint",
  "spaces-sdlc-wiki-write-page",
  "spaces-sdlc-wiki-move-page",
  "spaces-sdlc-wiki-finalize-commit",
] as const;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function trustedSdlcWikiToolBindings(
  sdlcContext: unknown,
): TrustedMcpToolBindings | undefined {
  const context = record(sdlcContext);
  if (context?.["operation"] !== "wiki") return undefined;
  const execution = record(context["execution"]);
  const repository = record(context["repository"]);
  if (
    typeof execution?.["workflowExecutionId"] !== "string" ||
    typeof execution["sessionId"] !== "string" ||
    typeof repository?.["id"] !== "string"
  ) {
    return undefined;
  }
  const identity = {
    executionId: execution["workflowExecutionId"],
    sessionId: execution["sessionId"],
    repoId: repository["id"],
  };
  return Object.fromEntries(SDLC_WIKI_MCP_TOOLS.map((toolName) => [toolName, identity]));
}
