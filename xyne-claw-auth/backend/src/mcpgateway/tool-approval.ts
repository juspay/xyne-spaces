type GatewayApprovalTool = {
  method?: unknown;
  requiresApproval?: unknown;
  isWriteTool?: unknown;
};

/**
 * Gateway approval is explicit registration metadata. HTTP method is transport
 * shape only: POST can be read-only search, and GET can still be sensitive.
 */
export function requiresGatewayToolApproval(tool: GatewayApprovalTool): boolean {
  if (typeof tool.requiresApproval === "boolean") return tool.requiresApproval;
  if (typeof tool.isWriteTool === "boolean") return tool.isWriteTool;
  return false;
}
