import { getAdapters } from "./mcp/runner.js";

interface ValidationResult {
  readonly valid: boolean;
  readonly error?: string;
}

export function isValidServerType(type: string): boolean {
  return type in getAdapters();
}

export function validateCredentials(
  serverType: string,
  credentials: Record<string, unknown>,
): ValidationResult {
  const adapters = getAdapters();
  const adapter = adapters[serverType];
  if (!adapter) {
    return { valid: false, error: `Unknown server type: ${serverType}` };
  }

  for (const field of adapter.credentialFields) {
    if (field.optional) continue;
    const val = credentials[field.name];
    if (typeof val !== "string" || val.trim().length === 0) {
      return { valid: false, error: `${serverType} requires '${field.name}'` };
    }
  }

  return { valid: true };
}
