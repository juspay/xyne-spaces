import { resolveConnectorDefinition } from "./mcp/connector-definitions.js";

interface ValidationResult {
  readonly valid: boolean;
  readonly error?: string;
}

export async function isValidServerType(type: string): Promise<boolean> {
  return (await resolveConnectorDefinition(type)) !== undefined;
}

export async function validateCredentials(
  serverType: string,
  credentials: Record<string, unknown>,
): Promise<ValidationResult> {
  const definition = await resolveConnectorDefinition(serverType);
  if (!definition) {
    return { valid: false, error: `Unknown server type: ${serverType}` };
  }

  for (const field of definition.credentialFields) {
    if (field.optional) continue;
    const val = credentials[field.name];
    if (typeof val !== "string" || val.trim().length === 0) {
      return { valid: false, error: `${serverType} requires '${field.name}'` };
    }
  }

  return { valid: true };
}
