import { SDLC_DIRECT_TOOL_NAMES, SDLC_MCP_SERVER_TYPE } from "xyne-claw-shared";

const SDLC_TOOLS = new Set<string>(SDLC_DIRECT_TOOL_NAMES);

export function approvalServerType(serverType: string, tool: string): string {
  return serverType === "xyne-spaces" && SDLC_TOOLS.has(tool) ? SDLC_MCP_SERVER_TYPE : serverType;
}

export function approvalToolFailureMessage(errText: string, params: Record<string, unknown>): string {
  const targetsConversation = typeof params["conversationId"] === "string" && params["conversationId"].trim() !== "";
  if (/conversation not found/i.test(errText) || (targetsConversation && /Spaces API 404/i.test(errText))) {
    return "target conversation not found — re-run the agent to regenerate this approval";
  }
  return errText;
}
