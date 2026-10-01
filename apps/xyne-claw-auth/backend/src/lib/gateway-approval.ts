import { GATEWAY_KEY_PREFIX, parseGatewayCatalogSource } from "../mcpgateway/key-format.js";
import { errMsg } from "./errors.js";

export function defaultGatewayTenant(): string | null {
  return (
    process.env["ALLOWED_TENANTS"]
      ?.split(",")
      .map((tenant) => tenant.trim())
      .find((tenant) => tenant.length > 0) ?? null
  );
}

export function parseGatewayServerTypeForApproval(serverType: string): { serviceName: string; backendId?: string } | null {
  const parsed = parseGatewayCatalogSource(serverType);
  if (parsed) return { serviceName: parsed.serviceName, backendId: parsed.backendId };

  if (!serverType.startsWith(GATEWAY_KEY_PREFIX)) return null;
  const raw = serverType.slice(GATEWAY_KEY_PREFIX.length).trim();
  if (!raw) return null;
  const parts = raw.split(":");
  if (parts.length !== 1) return null;
  const [serviceName] = parts;
  if (!serviceName) return null;
  return { serviceName };
}

export function formatGatewayApprovalExecutionError(
  execution: { error?: string; errorDetail?: unknown },
  serviceName: string,
  toolName: string,
): string {
  const detail = execution.errorDetail;
  if (detail && typeof detail === "object" && !Array.isArray(detail)) {
    const record = detail as Record<string, unknown>;
    const responseMessage = typeof record.responseMessage === "string" ? record.responseMessage.trim() : "";
    if (responseMessage.length > 0) return responseMessage;

    const message = typeof record.message === "string" ? record.message.trim() : "";
    if (message.length > 0) return message;

    const error = typeof record.error === "string" ? record.error.trim() : "";
    if (error.length > 0) return error;
  }

  const directError = typeof execution.error === "string" ? execution.error.trim() : "";
  if (directError.length > 0) return directError;

  return `Gateway execution failed for ${serviceName}/${toolName}`;
}

export function sanitizeApprovalToolError(err: unknown): string {
  const raw = errMsg(err);
  return raw
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\{[^{}]{20,}\}/g, "{...}")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240) || "tool execution failed";
}
