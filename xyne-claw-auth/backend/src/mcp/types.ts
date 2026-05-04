export interface McpToolInfo {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export interface McpServerTools {
  readonly serverType: string;
  readonly serverName: string;
  readonly tools: McpToolInfo[];
  readonly writeTools: readonly string[];
}

export interface McpCallResult {
  readonly content: string;
  readonly citations?: import("xyne-claw-shared").Citation[];
}

export interface CredentialField {
  readonly name: string;
  readonly label: string;
  readonly type: "text" | "password";
  readonly placeholder: string;
  readonly optional?: boolean;
}

export interface CredentialFormDefinition {
  readonly fields: readonly CredentialField[];
}

export interface PennyDropTool {
  readonly name: string;
  readonly params: Record<string, unknown>;
}

export interface WriteToolPolicy {
  readonly mode?: "allowlist" | "denylist" | "allAsk" | "allowAll";
  readonly tools?: readonly string[];
}

export interface StdioLaunchConfig {
  readonly cmd: string;
  readonly args: readonly string[];
  readonly env: Record<string, string>;
}

export interface HttpLaunchConfig {
  readonly url: string;
  readonly headers: Record<string, string>;
}

/**
 * Adapter that spawns a local MCP server process and communicates via stdio.
 */
export interface StdioMcpAdapter {
  readonly transport: "stdio";
  readonly type: string;
  readonly credentialFields: readonly CredentialField[];
  readonly healthCheck: PennyDropTool;
  /** Tool names that are write operations — always require user approval, cannot be overridden */
  readonly writeTools?: readonly string[];
  buildCommand(credentials: Record<string, unknown>): { cmd: string; args: string[]; env: Record<string, string> };
}

/**
 * Adapter that connects to an already-running remote MCP server over Streamable HTTP.
 * The remote server exposes a single HTTP endpoint (e.g. /mcp) for JSON-RPC.
 */
export interface HttpMcpAdapter {
  readonly transport: "http";
  readonly type: string;
  readonly credentialFields: readonly CredentialField[];
  readonly healthCheck: PennyDropTool;
  /** Tool names that are write operations — always require user approval */
  readonly writeTools?: readonly string[];
  buildHttpUrl(credentials: Record<string, unknown>): { url: string; headers: Record<string, string> };
}

export type McpAdapter = StdioMcpAdapter | HttpMcpAdapter;

export interface ResolvedConnectorDefinition {
  readonly type: string;
  readonly transport: "stdio" | "http";
  readonly credentialFields: readonly CredentialField[];
  readonly healthCheck: PennyDropTool;
  readonly writeTools: readonly string[];
  buildStdioCommand(credentials: Record<string, unknown>): StdioLaunchConfig;
  buildHttpConfig(credentials: Record<string, unknown>): HttpLaunchConfig;
}
