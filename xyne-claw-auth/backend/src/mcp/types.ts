export interface McpToolInfo {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export interface McpServerTools {
  readonly serverType: string;
  readonly serverName: string;
  readonly tools: McpToolInfo[];
}

export interface McpCallResult {
  readonly content: string;
}

export interface CredentialField {
  readonly name: string;
  readonly label: string;
  readonly type: "text" | "password";
  readonly placeholder: string;
  readonly optional?: boolean;
}

export interface PennyDropTool {
  readonly name: string;
  readonly params: Record<string, unknown>;
}

export interface McpAdapter {
  readonly type: string;
  readonly credentialFields: readonly CredentialField[];
  readonly pennyDrop: PennyDropTool;
  buildCommand(credentials: Record<string, unknown>): { cmd: string; args: string[]; env: Record<string, string> };
}
