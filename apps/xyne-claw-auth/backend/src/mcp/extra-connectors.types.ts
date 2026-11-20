import type { McpAdapter } from "./types.js";

/** Credentials for a connector, read from deployment env. */
export interface EnvCredentials {
  connectionId: string;
  credentials: Record<string, unknown>;
}

/** Additional MCP connectors added to the built-in ones. */
export interface ExtraConnectors {
  /** Adapters by server type, added to STATIC_ADAPTERS. */
  adapters: Readonly<Record<string, McpAdapter>>;
  /** Server types whose tool list is shared by every user. */
  sharedToolListTypes: readonly string[];
  /** Server types apps may not use. */
  platformInternalTypes: readonly string[];
  /** Connectors added to every agent, when their catalog row is enabled and `available()` is true. */
  globalConnectors: ReadonlyArray<{ serverType: string; available(): boolean }>;
  /**
   * Env credentials for a server type: `undefined` when the type is not handled
   * here, `null` when it is but nothing is configured.
   */
  envCredentials(serverType: string): EnvCredentials | null | undefined;
}
