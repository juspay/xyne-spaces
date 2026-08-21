/**
 * Live-data sources an artifact app may declare.
 *
 * An app never talks to the network itself — it runs in a bundler-origin iframe
 * with no cookies. Instead it DECLARES what it needs here, and the dashboard
 * resolves those declarations per-viewer at render time and posts the results in.
 * That is what makes published apps safe: every viewer's own ACLs run, rather
 * than everyone seeing a snapshot baked from the author's permissions.
 *
 * ── XYNE_ARTIFACT_DATA_ALLOWLIST ──────────────────────────────────────────────
 * These allowlists exist in three places and must be kept in step by hand
 * (neither the dashboard nor the backend depends on this package):
 *
 *   1. HERE — validated at generation time, so the agent gets a retryable error
 *      instead of a broken app.
 *   2. apps/dashboard/src/components/AIScreen/ReactArtifact/artifactData.constants.ts
 *      — re-checked before any request, catching payloads saved before a source
 *      was removed from the list.
 *   3. apps/backend/src/services/pythonQuery/validator.ts — the real authority
 *      for the AST path (ALLOWED_MODELS, ALLOWED_OPERATORS, MAX_TAKE,
 *      MAX_WHERE_DEPTH). Named queries have NO server allowlist at all: every
 *      `defineQuery` entry is reachable via /api/zero/query-fallback, so the
 *      list below is the only thing narrowing it.
 *
 * Keep the AST entries a strict SUBSET of the server's. Drift then degrades to a
 * per-requirement render-time error, never a bypass.
 */

/** postMessage envelope version shared by the runtime and the host bridge. */
export const ARTIFACT_DATA_PROTOCOL_VERSION = 1;

/** Requirements per artifact. The manifest is jsonb and is replayed on every
 *  history load, so this stays small. */
export const MAX_DATA_REQUIREMENTS = 8;

/**
 * Named backend queries an app may reference. Each runs with the viewer's own
 * context, so rows are ACL-filtered per viewer automatically.
 *
 * `argsHint` is surfaced verbatim in the tool description — it is how the agent
 * learns what to pass, so keep it accurate against
 * apps/backend/src/zero/queries.ts.
 */
export const ALLOWED_NAMED_QUERIES: Record<string, { argsHint: string; note?: string }> = {
  getAllBoards: {
    argsHint: "{}",
    note: "Every board in the workspace, with project and stages.",
  },
  boardsByProject: {
    argsHint: '{ "projectId": "<id>" }',
    note: "Boards of one project, with their stages.",
  },
  stagesByBoard: {
    argsHint: '{ "boardId": "<id>" }',
    note: "Ordered stages of one board — use for kanban columns.",
  },
  ticketsQueryV2: {
    argsHint:
      '{ "viewMode": "board" | "project" | "my-tickets", "boardId"?: "<id>", "projectId"?: "<id>" }',
    note: "Tickets with assignments and tags. Scope with boardId/projectId — unbounded otherwise.",
  },
  allTickets: {
    argsHint: "{}",
    note: "Every non-archived ticket in the workspace. Unbounded — prefer ticketsQueryV2 with a scope.",
  },
};

/**
 * Models reachable through the declarative AST gateway. Deliberately a small
 * subset of the server's ~35 — widen only with a reason.
 */
export const ALLOWED_AST_MODELS = [
  "ticket",
  "user",
  "project",
  "board",
  "stage",
  "channel",
  "message",
  "activity",
] as const;

export const ALLOWED_AST_OPERATIONS = ["findMany", "count"] as const;

/** Server allows 1000; we halve it, since every row crosses postMessage. */
export const MAX_AST_TAKE = 500;

/** Matches the server's MAX_WHERE_DEPTH. */
export const MAX_AST_WHERE_DEPTH = 5;

export type ArtifactAstOperation = (typeof ALLOWED_AST_OPERATIONS)[number];

export interface ArtifactNamedQuerySource {
  kind: "query";
  /** A key of ALLOWED_NAMED_QUERIES. */
  query: string;
  args?: Record<string, unknown>;
}

export interface ArtifactAstSource {
  kind: "ast";
  /** A member of ALLOWED_AST_MODELS. */
  model: string;
  operation?: ArtifactAstOperation;
  where?: Record<string, unknown>;
  orderBy?: Record<string, unknown> | Array<Record<string, unknown>>;
  take?: number;
}

export type ArtifactDataSource = ArtifactNamedQuerySource | ArtifactAstSource;

/**
 * `source` is optional for back-compat: requirements authored before live data
 * existed carry only {name, description} and are inert. The renderer surfaces
 * those as an explicit error rather than leaving the app loading forever.
 */
export interface ReactArtifactDataRequirement {
  name: string;
  description?: string;
  source?: ArtifactDataSource;
}
