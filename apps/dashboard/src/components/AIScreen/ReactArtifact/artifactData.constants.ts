/**
 * XYNE_ARTIFACT_DATA_ALLOWLIST — dashboard mirror.
 *
 * Re-checked here before any request is made, because a saved app's payload was
 * validated whenever it was generated: a source removed from the allowlist since
 * then must fail locally rather than reach the API.
 *
 * Kept in step BY HAND with:
 *   • packages/xyne-claw-shared/src/tools/react-artifact/dataSources.ts
 *     (generation-time validation — the agent-facing copy)
 *   • apps/backend/src/services/pythonQuery/validator.ts
 *     (the real authority for the AST path)
 *
 * The dashboard deliberately does not depend on xyne-claw-shared — it mirrors
 * artifact types the same way (see ReactArtifact.types.ts). Keep the AST lists a
 * strict SUBSET of the server's; drift then degrades to a per-requirement error,
 * never a bypass.
 */

export const ARTIFACT_DATA_PROTOCOL_VERSION = 1;

export const ALLOWED_NAMED_QUERIES = [
  'getAllBoards',
  'boardsByProject',
  'stagesByBoard',
  'ticketsQueryV2',
  'allTickets',
] as const;

export const ALLOWED_AST_MODELS = [
  'ticket',
  'user',
  'project',
  'board',
  'stage',
  'channel',
  'message',
  'activity',
] as const;

export const ALLOWED_AST_OPERATIONS = ['findMany', 'count'] as const;

export const MAX_AST_TAKE = 500;

/** Rows above this are sliced before crossing postMessage. */
export const MAX_ROWS_PER_REQUIREMENT = 5000;

/** Minimum gap between resolutions, so app code cannot loop the database. */
export const REFRESH_THROTTLE_MS = 2000;

/** Concurrent writes per app. A cap on runaway generated code, not a permission. */
export const MAX_INFLIGHT_MUTATIONS = 5;

/**
 * Tool calls forwarded into an app for one run. Every invocation is
 * structured-cloned across postMessage, so an agent with a long tool loop would
 * otherwise stall the iframe. The server already caps its own store at 1000.
 */
export const MAX_AGENT_INVOCATIONS = 100;

/** Per-invocation result budget. Tool results can be whole result sets. */
export const MAX_AGENT_INVOCATION_RESULT_CHARS = 4000;

export interface ArtifactNamedQuerySource {
  kind: 'query';
  query: string;
  args?: Record<string, unknown>;
}

export interface ArtifactAstSource {
  kind: 'ast';
  model: string;
  operation?: 'findMany' | 'count';
  where?: Record<string, unknown>;
  orderBy?: Record<string, unknown> | Array<Record<string, unknown>>;
  take?: number;
}

export type ArtifactDataSource = ArtifactNamedQuerySource | ArtifactAstSource;

export interface ArtifactDataRequirement {
  name: string;
  description?: string;
  /** Absent on requirements authored before live data existed. */
  source?: ArtifactDataSource;
}

export interface ArtifactDataEntry {
  status: 'loading' | 'ready' | 'error';
  data?: unknown;
  error?: string;
  meta?: { truncated: true; totalRows: number };
}

export type ArtifactDataSnapshot = Record<string, ArtifactDataEntry>;

/** Host → app. Always carries the full snapshot; idempotent, last write wins. */
export interface HostDataMessage {
  source: 'xyne-artifact-host';
  v: number;
  type: 'data';
  payloads: ArtifactDataSnapshot;
}

/**
 * Host → app, answering a `mutate`. Writes are request/response (the app awaits
 * a result), unlike data snapshots which are fire-and-forget.
 */
export interface HostMutateResultMessage {
  source: 'xyne-artifact-host';
  v: number;
  type: 'mutate-result';
  requestId: string;
  ok: boolean;
  error?: string;
}

/**
 * Finished, display-ready names — never raw rows. Resolved host-side with the
 * same helpers the rest of Spaces uses, because two of the rules are not
 * guessable: `displayName` is usually null (fall back to name, then email), and
 * a DM channel's `name` column holds participant ids rather than a name.
 */
export interface ArtifactDirectory {
  /** userId -> display name. */
  users: Record<string, string>;
  /** channelId -> channel name, with DMs already resolved to participant names. */
  channels: Record<string, string>;
}

/** Host -> app. Idempotent, last write wins - same contract as a data snapshot. */
export interface HostDirectoryMessage {
  source: 'xyne-artifact-host';
  v: number;
  type: 'directory';
  directory: ArtifactDirectory;
}

/**
 * Host → app: one event from a running agent, forwarded off the live
 * conversation stream. Fire-and-forget; the app accumulates them.
 */
export interface HostAgentEventMessage {
  source: 'xyne-artifact-host';
  v: number;
  type: 'agent-event';
  runKey: string;
  kind: 'accepted' | 'delta' | 'reasoning' | 'label' | 'invocation' | 'done' | 'error';
  runId?: string;
  /** `delta` / `reasoning`: appended. `done`: the final text when present. */
  text?: string;
  /** `label`: the tool the agent is currently running. */
  label?: string;
  /** `invocation`: one tool call. Capped and truncated before it is sent. */
  invocation?: unknown;
  /** `done` / `error`. */
  status?: string;
  error?: string;
}

/**
 * Host → app: the full state of a run key. Sent on attach and whenever the app
 * re-announces `ready`, so a reopened app is restored without app-side storage.
 * Idempotent, last write wins — same contract as a data snapshot.
 */
export interface HostAgentStateMessage {
  source: 'xyne-artifact-host';
  v: number;
  type: 'agent-state';
  runKey: string;
  available: boolean;
  agents: Array<{ slug: string; name: string; description: string; color: string }>;
  run: {
    runId: string | null;
    status: 'idle' | 'starting' | 'running' | 'completed' | 'failed' | 'cancelled';
    output: string;
    reasoning: string;
    invocations: unknown[];
    label: string | null;
    error: string | null;
  };
}

/** App → host. */
export interface AppArtifactMessage {
  source: 'xyne-artifact';
  v: number;
  type: 'ready' | 'refresh' | 'mutate' | 'agent-run' | 'agent-cancel' | 'agent-attach';
  /** `refresh`: which requirement (omitted = all). */
  name?: string;
  /** `mutate` only. */
  requestId?: string;
  args?: unknown;
  /** Agent messages: which conversation thread this concerns. */
  runKey?: string;
  /** `agent-run` only. */
  prompt?: string;
  agentSlug?: string;
}

export function isAppArtifactMessage(value: unknown): value is AppArtifactMessage {
  if (!value || typeof value !== 'object') return false;
  const msg = value as Partial<AppArtifactMessage>;
  if (msg.source !== 'xyne-artifact') return false;
  if (msg.type === 'ready' || msg.type === 'refresh') return true;
  if (msg.type === 'agent-attach' || msg.type === 'agent-cancel') {
    return typeof msg.runKey === 'string';
  }
  if (msg.type === 'agent-run') {
    return (
      typeof msg.runKey === 'string' && typeof msg.prompt === 'string' && msg.prompt.length > 0
    );
  }
  return msg.type === 'mutate' && typeof msg.requestId === 'string' && typeof msg.name === 'string';
}

/**
 * Reject anything the tool would not have accepted today. Returns an error
 * string, or null when the source is usable.
 */
export function validateDataSource(source: ArtifactDataSource): string | null {
  if (source.kind === 'query') {
    if (!(ALLOWED_NAMED_QUERIES as readonly string[]).includes(source.query)) {
      return `"${source.query}" is no longer an available data source.`;
    }
    return null;
  }

  if (source.kind === 'ast') {
    if (!(ALLOWED_AST_MODELS as readonly string[]).includes(source.model)) {
      return `"${source.model}" is not a queryable model.`;
    }
    if (
      source.operation &&
      !(ALLOWED_AST_OPERATIONS as readonly string[]).includes(source.operation)
    ) {
      return `"${source.operation}" is not a supported operation.`;
    }
    if (source.take !== undefined && (source.take < 1 || source.take > MAX_AST_TAKE)) {
      return `Row limit must be between 1 and ${MAX_AST_TAKE}.`;
    }
    return null;
  }

  return 'Unrecognised data source.';
}
