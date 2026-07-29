export interface McpToolInfo {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly serviceName?: string;
  readonly backendId?: string;
  readonly selectionKey?: string;
}

export interface McpServerTools {
  readonly serverType: string;
  readonly serverName: string;
  readonly displayName?: string;
  readonly tools: McpToolInfo[];
  readonly writeTools: readonly string[];
}

export interface McpCallResult {
  readonly content: string;
  readonly citations?: import("xyne-claw-shared").Citation[];
  /** Binary files lifted out of the MCP result (EmbeddedResource blobs / image /
   *  audio) to forward to the user as attachments. Only populated for tools in
   *  the runner's FILE_FORWARDING_TOOLS allowlist. */
  readonly attachments?: ReadonlyArray<{ fileName: string; mimeType: string; data: string }>;
  /**
   * Optional debug metadata lifted from the MCP `_meta.debug` field. Currently
   * populated by `kb-search` and `spaces-search` with the Vespa YQL + bound
   * params that produced the response. Travels alongside `content` — claw
   * never includes it in the LLM-visible tool result, just stashes via
   * takeDebug() and pins on the persisted ToolInvocation row.
   */
  readonly debug?: Record<string, unknown>;
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
  /**
   * Tool names to expose in the agent-config picker even when the `tools` table
   * has not been synced for this server yet (e.g. a bot-token server whose
   * sync only fires at user-creation time). Independent of `writeTools` — does
   * NOT imply HITL gating. Use for autonomous/system tools that should still
   * be selectable in the UI without a per-user "Connect" round-trip.
   */
  readonly staticTools?: readonly string[];
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
  /** Picker-only fallback list; see StdioMcpAdapter.staticTools. */
  readonly staticTools?: readonly string[];
  buildHttpUrl(credentials: Record<string, unknown>): { url: string; headers: Record<string, string> };
}

export type McpAdapter = StdioMcpAdapter | HttpMcpAdapter;

export interface ResolvedConnectorDefinition {
  readonly type: string;
  readonly transport: "stdio" | "http";
  readonly credentialFields: readonly CredentialField[];
  readonly healthCheck: PennyDropTool;
  readonly writeTools: readonly string[];
  /** Picker-only fallback list; see StdioMcpAdapter.staticTools. */
  readonly staticTools: readonly string[];
  /** When true, binary content (EmbeddedResource blob / image / audio) returned
   *  by this server's tools is forwarded to the user as a file attachment. */
  readonly forwardFiles: boolean;
  buildStdioCommand(credentials: Record<string, unknown>): StdioLaunchConfig;
  buildHttpConfig(credentials: Record<string, unknown>): HttpLaunchConfig;
}
