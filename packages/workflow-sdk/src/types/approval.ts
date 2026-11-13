/**
 * Approval policy — which workflow configurations need a second pair of eyes
 * before they go live.
 */

/** Whether including a component obliges its workflow to be approved. */
export enum ApprovalRequirement {
  NOT_REQUIRED = 'notRequired',
  REQUIRED = 'required',
}

/**
 * Deployment policy — and the reason it is not declared on the components.
 *
 * A step lives in a package many deployments install. If `create_issue` itself
 * declared REQUIRED, its author would be writing every installer's security
 * policy, and a patch bump could change it under them. An override map would
 * not fix that: a default nobody overrides is not a default, it is the policy,
 * so the arrangement would only look governed while the decision stayed with
 * the package. The deployment names the types instead, in one file its own
 * reviewers read and its own review process gates.
 *
 * `steps` and `triggers` are separate maps because the registry keeps two
 * namespaces — one flat map would let a single entry silently govern both a
 * step and a trigger that happened to share a type string.
 *
 * Resolution is most-specific first: `steps`/`triggers`, then `default`. Keys
 * added later — by connector, by category, a callback for per-tenant policy —
 * slot in between without changing what an existing config means.
 */
export interface ApprovalConfig {
  /** Applies to any component not named in `steps` or `triggers`. */
  default: ApprovalRequirement;
  /** Per step type, e.g. `{ HTTP_REQUEST: ApprovalRequirement.REQUIRED }`. */
  steps?: Readonly<Record<string, ApprovalRequirement>>;
  /** Per trigger type, e.g. `{ WEBHOOK_V2: ApprovalRequirement.REQUIRED }`. */
  triggers?: Readonly<Record<string, ApprovalRequirement>>;
}

/** What the policy decided about one configuration. */
export interface ApprovalGate {
  readonly required: boolean;
  /**
   * The component types that asked for it, de-duplicated. This is what a
   * reviewer sees in the queue, so they can judge without opening the workflow.
   */
  readonly gatedBy: readonly string[];
}
