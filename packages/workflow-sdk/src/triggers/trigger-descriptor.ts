/**
 * How a trigger describes itself to the builder — the `StepDescriptor`
 * counterpart, moved out of the deleted `TriggerRegistry` for the same reason:
 * connectors hold triggers now, but the palette still needs them described.
 */
import type { z } from 'zod';
import type { TriggerType } from '../types/trigger-types.js';
import type { TriggerCategory } from '../types/categories.js';
import { BaseTrigger } from './base-trigger.js';
import { WebhookTrigger } from './webhook-trigger.js';
import type { CredentialSlot } from '../steps/base-step.js';
import type { CredentialTypeRef } from '../common/credentials.js';
import { zodToJsonSchemaRecord } from '../util/schema-convert.js';
import { credentialTypeRefs } from '../util/credential-slot-schema.js';

type AnyTrigger = BaseTrigger<z.ZodTypeAny>;

// ─── Summary (lightweight, for list endpoints) ───

export interface TriggerSummary {
  type: TriggerType;
  name: string;
  description: string;
  category: TriggerCategory;
  icon?: string;
  /** The connector that provides this trigger. Stamped at registration. */
  connectorId?: string;
  connectorName?: string;
  /** Its icon name, for the palette's connector list. Absent when the connector sets none. */
  connectorIcon?: string;
}

// ─── Descriptor (full introspection, for detail endpoints + dashboard) ───

export interface TriggerDescriptor extends TriggerSummary {
  /** JSON Schema for the trigger's config — generated from the Zod schema. */
  configSchema: Record<string, unknown>;
  /** JSON Schema for the trigger's output — generated from the Zod schema. */
  outputSchema: Record<string, unknown>;
  /** Whether this trigger requires scope-based filtering in the UI. */
  requiresScopeFilter: boolean;
  /** Fields used for scope filtering (e.g. channelIds, boardIds). */
  scopeFilterFields: readonly string[];
  /** Credential slots this trigger declares. Empty array if none. */
  credentialSlots: readonly CredentialSlot[];
  /** Credential types the trigger accepts. Empty means any type. */
  credential: readonly CredentialTypeRef[];
  /** True for a webhook trigger, which an external provider calls. */
  webhook: boolean;
}

// ─── Builders ───

export function buildTriggerSummary(t: AnyTrigger): TriggerSummary {
  return {
    type: t.type,
    name: t.name,
    description: t.description,
    category: t.category,
    ...(t.icon !== undefined ? { icon: t.icon } : {}),
    ...(t.connectorId !== undefined ? { connectorId: t.connectorId } : {}),
    ...(t.connectorName !== undefined ? { connectorName: t.connectorName } : {}),
    ...(t.connectorIcon !== undefined ? { connectorIcon: t.connectorIcon } : {}),
  };
}

export function buildTriggerDescriptor(t: AnyTrigger): TriggerDescriptor {
  return {
    ...buildTriggerSummary(t),
    configSchema: t.decorateConfigSchema(zodToJsonSchemaRecord(t.configSchema)),
    outputSchema: zodToJsonSchemaRecord(t.outputSchema),
    requiresScopeFilter: t.requiresScopeFilter ?? false,
    scopeFilterFields: t.scopeFilterFields ?? [],
    credentialSlots: t.credentialSlots ?? [],
    credential: credentialTypeRefs(t.credential),
    webhook: t instanceof WebhookTrigger,
  };
}
