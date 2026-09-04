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
 * `argsHint` and `fieldsHint` are surfaced verbatim in the tool description —
 * they are the ONLY way the agent learns the arguments and the row shape, so
 * keep them accurate against apps/backend/src/zero/queries.ts and the Prisma
 * schema.
 *
 * `fieldsHint` exists because guessed field names have been the single largest
 * source of silently-wrong generated apps: an app read `status` (the column is
 * `statusV2`) and reported 0% completion on healthy data, and another read
 * `assignments[]` (empty in practice; assignment lives on `assignedTo`) and
 * showed every ticket as unassigned. Name the traps explicitly.
 */
/** Shared by every ticket-returning source. */
const TICKET_FIELDS =
  "id, xyneId (display id like JSP-42), title, description, " +
  "statusV2 (TODO|STARTED|PAUSED|COMPLETED|CANCELLED — NOT `status`), " +
  "priority (LOW|MEDIUM|HIGH|CRITICAL), " +
  "assignedTo (user id of the assignee, or null — this IS the assignment; the " +
  "`assignments[]` relation is unused and comes back empty, do NOT read it), " +
  "createdBy (user id), boardId, projectId, stageName, channelId, " +
  "eta (due date, epoch ms), createdAt, updatedAt, isArchived, ticketType";

export const ALLOWED_NAMED_QUERIES: Record<
  string,
  { argsHint: string; note?: string; fieldsHint?: string }
> = {
  getAllBoards: {
    argsHint: "{}",
    note: "Every board in the workspace, with project and stages.",
    fieldsHint: "id, name, projectId, project{id,name}, stages[]{id,name,sequenceNumber}",
  },
  boardsByProject: {
    argsHint: '{ "projectId": "<id>" }',
    note: "Boards of one project, with their stages.",
    fieldsHint: "id, name, projectId, stages[]{id,name,sequenceNumber}",
  },
  stagesByBoard: {
    argsHint: '{ "boardId": "<id>" }',
    note: "Ordered stages of one board — use for kanban columns.",
    fieldsHint: "id, name, boardId, sequenceNumber",
  },
  ticketsQueryV2: {
    argsHint:
      '{ "viewMode": "board" | "project" | "my-tickets", "boardId"?: "<id>", "projectId"?: "<id>" }',
    note: "Tickets. Scope with boardId/projectId — unbounded otherwise.",
    fieldsHint: TICKET_FIELDS,
  },
  allTickets: {
    argsHint: "{}",
    note: "Every non-archived ticket in the workspace. Unbounded — prefer ticketsQueryV2 with a scope.",
    fieldsHint: TICKET_FIELDS,
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
