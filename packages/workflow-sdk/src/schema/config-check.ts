/**
 * Checking a configuration against the world it names.
 *
 * `validate()` answers what is true of a config by looking at it — shape,
 * ranges, one-of-these-fields. This answers what is true of the things it
 * NAMES: does that channel exist, may this person watch it, can this credential
 * reach that repository. Those need credentials, a tenant, a caller and a
 * network, so they cannot live in a Zod schema — which is pure, synchronous,
 * and converted to JSON Schema and shipped to the browser.
 *
 * Authoring time, not run time: this runs for a person configuring a workflow,
 * so it is the one place a component can ask about THEM. Note what that does and
 * does not buy — a run acts as the workflow, not as its author, so a check here
 * is a point in time, never an invariant. Treat it as catching the mistake
 * early, and put real enforcement in the authorizer and the credential's scope.
 */

import type { ResourceAttributes } from '../authz/attributes.js';
import type { ResolvedCredential } from '../common/credentials.js';
import type { ServiceRegistry } from '../engine/service-registry.js';
import type { Literal } from '../types/literal.js';

export interface ConfigValidationContext<
  TConfig = Record<string, unknown>,
  TServices extends Record<string, unknown> = Record<string, unknown>,
  TCtx = unknown,
> {
  /**
   * The config, verbatim and complete — the shape check has already passed, so
   * required fields are present. May still hold `{{trigger.x}}` in a field whose
   * type says `string`.
   */
  readonly config: Readonly<TConfig>;

  /**
   * The same config with every `{{…}}` reference removed — what can actually be
   * checked. A reference is a promise about run time; looking it up finds
   * nothing and would report a false problem on a perfectly good workflow.
   *
   * A missing key means "not checkable", whether it held a reference or was
   * never set. Both deserve the same answer: say nothing about it.
   */
  readonly known: Readonly<Literal<TConfig>>;

  /** Resolved from the component's declared slots. Empty if none could be resolved. */
  readonly credentials: Readonly<Record<string, ResolvedCredential>>;
  /** The tenant being configured — never widen a query beyond it. */
  readonly attributes: ResourceAttributes<'workflow'>;
  readonly services: ServiceRegistry<TServices>;

  /**
   * Who is configuring this. The reason the hook exists for host components: a
   * connector's authorization is its credential, but a host's is the person.
   */
  readonly caller: TCtx;

  /** Aborted if the caller goes away. */
  readonly signal?: AbortSignal;
}

/**
 * One reason this configuration will not work.
 *
 * No severity, deliberately. Whether something is worth blocking on is a
 * question about the domain — is a branch that does not exist yet a problem? —
 * and the component knows the answer. If it is not worth refusing over, do not
 * return it.
 */
export interface ConfigIssue {
  /** Dotted, relative to this component's own config: `'thread.parentId'`. */
  readonly path?: string;
  readonly message: string;
}
