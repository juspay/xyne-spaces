/**
 * Choices for a config field — what turns "paste a channel id" into a picker.
 *
 * A step or trigger implements ONE method, {@link HasOptions.getOptions}, and the
 * field being edited arrives as `ctx.field`. The editor calls it as the author
 * types, shows what comes back, and stores **only `value`** — a picker is a way
 * to choose an id, not a reason to keep a copy of the thing it names.
 *
 * Authoring time, not run time: there is no execution here, no event and no prior
 * steps. What a loader gets is the half-filled form, the component's credentials,
 * and the caller's tenant.
 */

import type { ResourceAttributes } from '../authz/attributes.js';
import type { Literal } from '../types/literal.js';
import type { ResolvedCredential } from '../common/credentials.js';
import type { ServiceRegistry } from '../engine/service-registry.js';

/** One choice. Only `value` is ever written into the workflow's config. */
export interface FieldOption {
  readonly value: string;
  readonly label: string;
  /** A second line — what distinguishes two similarly named things. */
  readonly description?: string;
  /** Short trailing metadata: a count, a status, an owner. */
  readonly hint?: string;
  /** An icon name or URL; the editor decides what it can render. */
  readonly icon?: string;
  /** Section heading, for a list worth grouping ("Your channels", "Archived"). */
  readonly group?: string;
  /** Shown, but not choosable — say why, or the author is left guessing. */
  readonly disabled?: boolean;
  readonly disabledReason?: string;
}

export interface FieldOptionsPage {
  readonly items: readonly FieldOption[];
  /** Pass back as {@link FieldOptionsContext.cursor} for the next page. */
  readonly nextCursor?: string;
  /** How many there are in total, when the source knows — "20 of 340". */
  readonly total?: number;
  /**
   * Shown instead of an empty list, for when there is nothing to offer *yet*:
   * "choose a project first". An empty list means there is nothing; this means
   * the question cannot be answered.
   */
  readonly notice?: string;
}

export interface FieldOptionsContext<
  TConfig = Record<string, unknown>,
  TServices extends Record<string, unknown> = Record<string, unknown>,
  TCtx = unknown,
> {
  /** Which field is asking. One method serves them all. */
  readonly field: string;

  /**
   * The form as it stands, verbatim — partial, unvalidated, and possibly holding
   * `{{trigger.x}}` in a field whose type says `string`.
   *
   * Narrow by {@link literal} rather than this: a reference is not an id, and
   * treating it as one silently searches for nothing.
   */
  readonly config: Readonly<Partial<TConfig>>;

  /**
   * The same form with every `{{…}}` reference removed — the fields whose values
   * are actually known while editing. "Channels in the selected project" is a
   * question only these can answer.
   *
   * Nested objects are walked, so one reference does not cost you its neighbours.
   * A list holding a reference is dropped whole: a shorter list reads as a
   * narrower filter, not an unanswerable one.
   */
  readonly literal: Readonly<Literal<TConfig>>;

  /** What the author has typed into the picker. Filter at the source, not here. */
  readonly search?: string;
  /** Page token from a previous {@link FieldOptionsPage.nextCursor}. */
  readonly cursor?: string;

  /**
   * Ids to describe rather than search for.
   *
   * Set when the editor opens a saved workflow and holds ids with no labels.
   * Answer with one item per value it recognises, in any order; unknown ids are
   * simply absent, and the editor shows the bare id for those.
   */
  readonly values?: readonly string[];

  /** Resolved from the component's declared slots, for the caller's tenant. */
  readonly credentials: Readonly<Record<string, ResolvedCredential>>;
  /** The tenant being edited — never widen a query beyond it. */
  readonly attributes: ResourceAttributes<'workflow'>;
  readonly services: ServiceRegistry<TServices>;

  /**
   * Who is asking. This runs for a person editing a workflow, not for a run, so
   * anything read here is read as them — a loader must not offer what they could
   * not otherwise see.
   */
  readonly caller: TCtx;

  /** Aborted when the author types again, or navigates away. */
  readonly signal?: AbortSignal;
}

/**
 * Implemented by a step or trigger that has fields worth picking rather than
 * typing. Wrap those fields in `withOptions` in the config schema and the editor
 * does the rest — nothing needs adding to {@link decorateConfigSchema}.
 */
export interface HasOptions<
  TConfig = Record<string, unknown>,
  TServices extends Record<string, unknown> = Record<string, unknown>,
  TCtx = unknown,
> {
  getOptions?(ctx: FieldOptionsContext<TConfig, TServices, TCtx>): Promise<FieldOptionsPage>;
}
