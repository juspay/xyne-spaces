import type { z } from 'zod';
import type { BaseStep } from '../../steps/base-step.js';
import type { BaseTrigger } from '../../triggers/base-trigger.js';
import type { CredentialDefinition } from './credentials.js';


export type AnyStep = BaseStep<z.ZodTypeAny, Record<string, unknown>>;

/** A trigger of any config shape. Widened for the same reason as {@link AnyStep}. */
export type AnyTrigger = BaseTrigger<z.ZodTypeAny>;

export abstract class BaseConnector {
  /**
   * Stable connector ID — `"gmail"`, `"http"`, `"builtin"`.
   *
   * Unique across the registry: registering two connectors under one ID is
   * rejected at boot, since it is almost always a duplicated wiring line.
   */
  abstract readonly id: string;

  /** Connector version, e.g. `"1.0.0"`. Independent of the SDK's version. */
  abstract readonly version: string;

  /** Display name for the builder's palette group — `"Gmail"`. */
  abstract readonly name: string;

  abstract readonly description: string;

  /**
   * Icon name for the connector's palette entry — `"git-branch"`. The builder
   * lists connectors before their steps and triggers, so each needs its own mark.
   */
  readonly icon?: string;



  /**
   * Every credential type this connector offers.
   *
   * The superset: a single step accepts a SUBSET of these through its own
   * `credential` requirement, and the registry rejects a step that accepts one
   * this connector never declared. Build each with `defineCredential` so the ID
   * is derived from `id` above rather than written by hand.
   *
   * Empty is the common answer — a connector whose steps talk to nothing
   * outside the deployment has no secret to hold.
   */
  abstract readonly credentials: readonly CredentialDefinition[];

  /** The implemented steps this connector provides. */
  abstract readonly steps: readonly AnyStep[];

  /**
   * The implemented triggers this connector provides.
   *
   * Empty is a legitimate, common answer — Gmail has no trigger, and plan §7 is
   * explicit that one must not be invented before working trigger behavior
   * exists. An empty array here says "this connector starts no workflows",
   * which is different from not having thought about it.
   */
  abstract readonly triggers: readonly AnyTrigger[];
}
