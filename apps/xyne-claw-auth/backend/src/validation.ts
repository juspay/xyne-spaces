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
    const val = credentials[field.name];
    if (field.optional && (val === undefined || val === null)) continue;
    if (typeof val !== "string" || val.trim().length === 0) {
      if (field.optional) continue;
      return { valid: false, error: `${serverType} requires '${field.name}'` };
    }
    // Credential values are interpolated verbatim into MCP connector spawn args
    // (e.g. `npx -y <pkg> --token=<val>`). A value beginning with '-' would be
    // reparsed as an extra CLI flag — argument injection into a process launched
    // inside the secret-holding gateway. Reject it.
    if (val.trim().startsWith("-")) {
      return { valid: false, error: `${serverType} field '${field.name}' must not start with '-'` };
    }
  }

  return { valid: true };
}
