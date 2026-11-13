import type { z } from 'zod';
import type { TriggerType } from '../types/trigger-types.js';
import type { TriggerCategory } from '../types/categories.js';
import type { CredentialSlot } from '../steps/base-step.js';
import type { CredentialRequirement } from '../connectors/core/credentials.js';
import type { ResolvedCredential } from '../common/credentials.js';
import type { ResourceAttributes } from '../authz/attributes.js';
import type { TriggerEvent } from '../ingest/types.js';
import type { FieldOptionsContext, FieldOptionsPage } from '../schema/options.js';
import type { ConfigIssue, ConfigValidationContext } from '../schema/config-check.js';

/**
 * What {@link BaseTrigger.hydrate} made of an event.
 *
 * `gone` is a result, not a failure: the ticket was deleted, the pull request
 * was force-pushed away. The runtime records it and ends the run with that
 * reason rather than letting the workflow act on ids that no longer resolve.
 */
export type HydrateResult<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> =
  | { readonly kind: 'payload'; readonly payload: TPayload }
  | { readonly kind: 'gone'; readonly reason: string };

/** What the engine hands a trigger's server-side methods. */
export interface TriggerExecutionContext {
  /** Credentials the trigger's slots resolved to, keyed by slot name. */
  readonly credentials: Readonly<Record<string, ResolvedCredential>>;
  /** The tenant the workflow belongs to. */
  readonly attributes: ResourceAttributes<'workflow'>;
  /** Base URL the deployment is reachable at. Empty when unconfigured. */
  readonly baseUrl: string;
}

/**
 * Abstract base for all triggers.
 *
 * A trigger defines:
 * - What starts a workflow (type + config)
 * - What data it produces (outputSchema)
 * - How to validate user config and match incoming events
 *
 * Host implements concrete triggers (e.g. TicketCreatedTrigger, CronTrigger)
 * and registers them into the TriggerRegistry.
 */
export abstract class BaseTrigger<
  TConfig extends z.ZodTypeAny,
  TOutput extends z.ZodTypeAny = z.ZodTypeAny,
  TRaw extends Record<string, unknown> = Record<string, unknown>,
  TCtx = unknown,
> {
  abstract readonly type: TriggerType;
  abstract readonly configSchema: TConfig;
  abstract readonly name: string;
  abstract readonly description: string;
  /**
   * What a run started by this trigger receives as `context.trigger` — the shape
   * after {@link hydrate}, not the shape that arrived.
   *
   * Bound to `TOutput` rather than declared `z.ZodTypeAny`, so the schema is the
   * single source of truth for the payload type and the two cannot drift: the
   * type `matchFilters` judges and the type `hydrate` must return are both read
   * off this declaration.
   */
  abstract readonly outputSchema: TOutput;
  abstract readonly category: TriggerCategory;
  readonly icon?: string;

  /**
   * Which connector provides this trigger. Written by
   * `ConnectorRegistry.register()`, never by the trigger — see BaseStep.
   */
  readonly connectorId?: string;
  readonly connectorName?: string;
  readonly connectorIcon?: string;

  /**
   * Config fields holding a credential name, resolved by the engine. Same
   * contract as a step's slots.
   */
  readonly credentialSlots?: readonly CredentialSlot[];

  /**
   * Which credential types this trigger accepts. The registry checks each is
   * declared by the trigger's own connector.
   */
  readonly credential?: CredentialRequirement;

  /** Whether this trigger requires scope-based filtering in the UI. */
  readonly requiresScopeFilter?: boolean;

  /** Fields used for scope filtering (e.g. channelIds, boardIds). */
  readonly scopeFilterFields?: readonly string[];

  /** Validate raw config against the trigger's schema. */
  validate(config: unknown): z.infer<TConfig> {
    return this.configSchema.parse(config) as z.infer<TConfig>;
  }

  /**
   * Is this workflow watching this event at all?
   *
   * The trigger's ONLY say in what starts a run, and it is about the event rather
   * than the world: the actions a binding subscribes to, the boards a rule
   * follows, whether a transition happened. Those are facts of what arrived, so
   * all of them are knowable before any enrichment — which is why this is pure,
   * synchronous, and evaluated on the raw event.
   *
   * Questions about how things ARE — is the ticket still unassigned — are not a
   * trigger's to answer. They belong to the author's conditions, which the runtime
   * evaluates on enriched data at the moment the run acts. That split is what lets
   * a delayed rule arm now and decide later: judge a condition here and a rule
   * whose condition becomes true during the wait would never arm at all.
   */
  accepts(_event: TriggerEvent<TRaw>, _config: z.infer<TConfig>): boolean {
    return true;
  }

  /**
   * Resolve the event's ids into the objects the workflow works with.
   *
   * Runs once, when the run is admitted — which for a delayed start is when the
   * timer fires, not when the event arrived. So a rule that waits two hours
   * filters and runs against the world as it is then, and the payload frozen
   * into `context.trigger` is that same snapshot.
   *
   * A pure read: no side effects, and safe to call again for another workflow
   * bound to the same event (see {@link hydrationKey}).
   */
  hydrate?(
    event: TriggerEvent<TRaw>,
    config: z.infer<TConfig>,
    ctx: TriggerExecutionContext,
  ): Promise<HydrateResult<z.infer<TOutput>>>;

  /**
   * Identity of the thing {@link hydrate} would read, so one read serves every
   * workflow bound to the same event — fifty rules on one ticket update cost one
   * fetch, not fifty. Return `undefined` to opt out of sharing.
   */
  hydrationKey?(event: TriggerEvent<TRaw>): string | undefined;

  /**
   * Choices for one of this trigger's config fields — see {@link FieldOptionsContext}.
   *
   * One method for every field; `ctx.field` says which is asking, as a dotted
   * path for a field that sits inside an object or a row. Mark the fields it
   * answers for by wrapping them in `withOptions` in the config schema, and the
   * editor turns those from text boxes into pickers.
   */
  getOptions?(
    ctx: FieldOptionsContext<z.infer<TConfig>, Record<string, unknown>, TCtx>,
  ): Promise<FieldOptionsPage>;

  /**
   * Check this trigger's configuration against the world it names, when the
   * author saves or activates.
   *
   * For what {@link validate} cannot reach: does that channel exist, may this
   * person watch it, can this credential see that repository. Return an empty
   * array to pass; anything returned refuses activation.
   *
   * Three rules. READ-ONLY — never "test" by creating something. Skip anything
   * absent from `ctx.known`, which is how a `{{ref}}` says it cannot be checked
   * yet. And stay CHEAP: one or two lookups that decide whether runs will work,
   * not a round trip per field.
   */
  validateConfig?(
    ctx: ConfigValidationContext<z.infer<TConfig>, Record<string, unknown>, TCtx>,
  ): Promise<ConfigIssue[]>;

  /**
   * Customize the JSON Schema generated from configSchema for UI form rendering.
   * Override to add field metadata, ordering, conditional visibility, etc.
   */
  decorateConfigSchema(
    jsonSchema: Record<string, unknown>,
  ): Record<string, unknown> {
    return jsonSchema;
  }

  /**
   * Resolve a per-instance output JSON Schema from the trigger's saved config.
   *
   * Mirrors {@link BaseStep.resolveOutputJsonSchema}. Triggers that let
   * authors describe the shape of incoming data (`inputSchema` on the
   * manual trigger, `bodySchema` / `headersSchema` / `querySchema` on the
   * default webhook trigger) should override this to type the variable
   * picker for downstream steps.
   *
   * Default: not implemented — `available-context.ts` falls back to the
   * static `outputSchema`.
   */
  resolveOutputJsonSchema?(
    config: Record<string, unknown>,
  ): Record<string, unknown>;
}
