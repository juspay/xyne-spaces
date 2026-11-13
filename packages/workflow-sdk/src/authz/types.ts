/**
 * Authorization port — the single, host-implemented surface for access control.
 *
 * Authorization asks three genuinely different questions, so the port has three
 * answers:
 *
 *  1. **INSTANCE** — {@link WorkflowAuthorizer.permissions}: what may this caller
 *     do to THIS resource? It guards point operations AND is the projection the
 *     UI gates on. One computation, two uses — so "what we show" and "what we
 *     enforce" cannot drift apart.
 *
 *  2. **LIST** — {@link WorkflowAuthorizer.visibleFilter}: an opaque, host-defined
 *     predicate the persistence adapter pushes INTO its query. The SDK never
 *     interprets it; it only guarantees the filter comes from the authorizer and
 *     reaches the adapter. Listing stays a single paginated query instead of
 *     materialising every visible id.
 *
 *  3. **CREATE** — an action on the CONTAINER: `permissions(ctx, folderRef)` /
 *     `permissions(ctx, { type: 'root' })` includes `workflow:create` /
 *     `folder:create`. A resource that does not exist yet cannot be pointed at,
 *     but its container can — and the container is the only thing a client can
 *     ask about *before* rendering a "New…" button.
 *
 * Both `TCtx` (the caller) and `TFilter` (the list predicate) are **opaque**: the
 * SDK never reads a field off either. The host owns its identity model and its
 * query language; the SDK owns only *where* decisions are enforced.
 *
 * Invariants a host must uphold (see the conformance kit):
 *  - `list ⊆ readable` — anything `visibleFilter` admits must have `read` in `permissions`.
 *  - `display ⇔ enforce` — if `permissions` grants an action, performing it must succeed.
 */

import type {
  WorkflowRecord,
  ExecutionRecord,
  FolderRecord,
  CredentialRecord,
} from '../persistence/types.js';

// ─── Actions ───

/**
 * Actions on an existing workflow. `workflow:create` is a CONTAINER action.
 *
 * `workflow:approve` is the one an authorizer should think about before
 * returning this tuple wholesale: it is the checker's action in maker-checker,
 * so granting it to everyone leaves the gate in place and nobody behind it.
 */
export const WORKFLOW_ACTIONS = [
  'workflow:read',
  'workflow:update',
  'workflow:delete',
  'workflow:activate',
  'workflow:approve',
  'workflow:run',
  'workflow:share',
] as const;

/** Actions on an existing folder. `folder:create` is a CONTAINER action. */
export const FOLDER_ACTIONS = [
  'folder:read',
  'folder:update',
  'folder:delete',
  'folder:share',
] as const;

/**
 * Actions on a CONTAINER — a `folder` ref, or the `root` ref for top level.
 * "May I add this kind of thing here?" These are what make create projectable:
 * a folder's `permittedActions` tells the client whether to show "New workflow".
 */
export const CONTAINER_ACTIONS = ['workflow:create', 'folder:create'] as const;

export const EXECUTION_ACTIONS = [
  'execution:read',
  'execution:approve',
  'execution:rerun',
  'execution:cancel',
] as const;

export const CREDENTIAL_ACTIONS = ['credential:read', 'credential:manage'] as const;

/** The fixed action vocabulary. These are the SDK's own verbs; the UI gates on them. */
export type Action =
  | (typeof WORKFLOW_ACTIONS)[number]
  | (typeof FOLDER_ACTIONS)[number]
  | (typeof CONTAINER_ACTIONS)[number]
  | (typeof EXECUTION_ACTIONS)[number]
  | (typeof CREDENTIAL_ACTIONS)[number];

/** Every known action — the default grant used by `AllowAllAuthorizer`. */
export const ALL_ACTIONS: readonly Action[] = [
  ...WORKFLOW_ACTIONS,
  ...FOLDER_ACTIONS,
  ...CONTAINER_ACTIONS,
  ...EXECUTION_ACTIONS,
  ...CREDENTIAL_ACTIONS,
];

// ─── Resource references ───

/**
 * The list anchors — what `visibleFilter` is asked about. Executions, analytics
 * and counts are NOT anchors: they derive from `workflow` visibility.
 */
export type ResourceType = 'workflow' | 'folder' | 'credential' | 'approval';

/**
 * The record handed to the authorizer for an approval/pause step. Carries the
 * denormalized ancestry so the authorizer can reach the workflow anchor, plus
 * the opaque host-authored `assignee` the workflow's author declared.
 */
export interface ApprovalStepRecord {
  stepId: string;
  executionId: string;
  workflowId: string;
  folderId: string;
  /** Opaque host-authored assignee (e.g. `{ kind: 'team', id: 'finance' }`). */
  assignee?: unknown;
}

/**
 * Identity (`type` + `id`) plus the full record the runtime already fetched. The
 * authorizer reads whatever it needs off `record` — including the typed
 * `record.attributes` (the product's per-resource scoping data, resolved from
 * `Register`). `execution` and `approvalStep` carry no attributes of their own;
 * navigate to the workflow anchor via `record.workflowId`.
 *
 * Every ref denotes something that **exists**:
 *  - `root` — the workspace/top level. A container with no instance; used to ask
 *    "may I create at the top level?" (and for credentials, which live nowhere else).
 *  - `folder` — both an *instance* (rename/delete/share it) and a *container*
 *    (may I add workflows/subfolders to it?). Its action set spans both.
 */
export type ResourceRef =
  | { type: 'root' }
  | { type: 'workflow'; id: string; record: WorkflowRecord }
  | { type: 'folder'; id: string; record: FolderRecord }
  | { type: 'execution'; id: string; record: ExecutionRecord }
  | { type: 'credential'; id: string; record: CredentialRecord }
  | { type: 'approvalStep'; id: string; record: ApprovalStepRecord };

/** Human-readable label for errors/logs. `root` has no id. */
export function refLabel(ref: ResourceRef): string {
  return ref.type === 'root' ? 'root' : `${ref.type}:${ref.id}`;
}

// ─── The port ───

export interface WorkflowAuthorizer<TCtx, TFilter> {
  /**
   * INSTANCE + CONTAINER decision. What may `ctx` do to this resource? Used both
   * to guard an operation (does the set include the attempted action?) and,
   * unchanged, as the resource's `permittedActions` for the UI.
   *
   * For a `folder` or `root` ref, include {@link CONTAINER_ACTIONS} to allow (and
   * advertise) creation inside it.
   */
  permissions(ctx: TCtx, ref: ResourceRef): Promise<readonly Action[]>;

  /**
   * Batch form of {@link permissions} — one action array per ref, in order. The
   * runtime uses it to populate per-row `permittedActions` on list results in a
   * single round-trip. Optional; defaults to mapping {@link permissions}.
   */
  permissionsBatch?(
    ctx: TCtx,
    refs: readonly ResourceRef[],
  ): Promise<ReadonlyArray<readonly Action[]>>;

  /**
   * LIST decision, as a predicate — NOT a set of ids. Returns whatever your
   * persistence adapter needs to filter its query (a tenant key, a principal, a
   * query fragment…). The SDK passes it to the adapter verbatim and never looks
   * inside, so listing stays one indexed, paginated query.
   */
  visibleFilter(ctx: TCtx, type: ResourceType): Promise<TFilter>;
}
