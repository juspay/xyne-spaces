/**
 * How a step describes itself to the builder.
 *
 * These shapes and the two builders below used to sit inside `StepRegistry`,
 * which did two unrelated jobs: HOLD the steps, and DESCRIBE them. Connectors
 * hold them now, so only the describing half survives — the palette and the
 * step-detail endpoint still ask exactly these questions.
 *
 * The logic is unchanged from the registry.
 */
import type { z } from 'zod';
import type { StepType } from '../types/step-types.js';
import type { StepCategory } from '../types/categories.js';
import type { BranchModel, CredentialSlot, DeclaredOutput, JumpBehavior } from './base-step.js';
import { BaseStep, BaseActionStep, BaseControlFlowStep, StepKind } from './base-step.js';
import { zodToJsonSchemaRecord } from '../util/schema-convert.js';
import { credentialTypeRefs } from '../util/credential-slot-schema.js';
import type { CredentialTypeRef } from '../common/credentials.js';

/** Widened so any BaseStep subclass can be described. */
type AnyStep = BaseStep<z.ZodTypeAny, Record<string, unknown>>;

// ─── Summary (lightweight, for list endpoints) ───

export interface StepSummary {
  type: StepType;
  name: string;
  description: string;
  category: StepCategory;
  kind: StepKind;
  icon?: string;
  /** The connector that provides this step. Stamped at registration. */
  connectorId?: string;
  /** Its display name, for the palette heading. */
  connectorName?: string;
  /** Its icon name, for the palette's connector list. Absent when the connector sets none. */
  connectorIcon?: string;
  /** Control-flow steps only: 'iterate' for LOOP, 'fanout' for everything else. Absent for action steps. */
  branchModel?: BranchModel;
  /** Control-flow steps only: how CONTINUE/FINISH treat its branches. `'catch'` steps are the jump targets a builder offers. */
  jumps?: JumpBehavior;
}

// ─── Descriptor (full introspection, for detail endpoints + dashboard) ───

export interface StepDescriptor extends StepSummary {
  /** JSON Schema for the step's config — generated from the Zod schema. */
  configSchema: Record<string, unknown>;
  /** JSON Schema for the step's output — generated from the Zod schema. */
  outputSchema: Record<string, unknown>;
  /** Credential slots this step declares. Empty array if none. */
  credentialSlots: readonly CredentialSlot[];
  /** Credential types the step accepts. Empty means any type. */
  credential: readonly CredentialTypeRef[];
  /** Output branches (for control-flow steps). Empty array for action steps. */
  declaredOutputs: readonly DeclaredOutput[];
  /** Service names this step requires at runtime. Empty array if none. */
  requiredServices: readonly string[];
  /** Event types this step may emit (action steps only). Empty array if none. */
  mayEmit: readonly string[];
}

// ─── Builders ───

export function buildStepSummary(s: AnyStep): StepSummary {
  return {
    type: s.type,
    name: s.name,
    description: s.description,
    category: s.category,
    kind: s.kind,
    ...(s.icon !== undefined ? { icon: s.icon } : {}),
    // Spread-when-present, not `?? undefined`: a consumer tests presence rather
    // than comparing against a placeholder.
    ...(s.connectorId !== undefined ? { connectorId: s.connectorId } : {}),
    ...(s.connectorName !== undefined ? { connectorName: s.connectorName } : {}),
    ...(s.connectorIcon !== undefined ? { connectorIcon: s.connectorIcon } : {}),
    ...(s instanceof BaseControlFlowStep ? { branchModel: s.branchModel, jumps: s.jumps } : {}),
  };
}

export function buildStepDescriptor(s: AnyStep): StepDescriptor {
  return {
    ...buildStepSummary(s),
    configSchema: s.decorateConfigSchema(zodToJsonSchemaRecord(s.configSchema)),
    outputSchema: zodToJsonSchemaRecord(s.outputSchema),
    credentialSlots: s.credentialSlots ?? [],
    credential: credentialTypeRefs(s.credential),
    declaredOutputs: s.declaredOutputs ?? [],
    requiredServices: s.requiredServices ?? [],
    mayEmit: s instanceof BaseActionStep ? (s.mayEmit ?? []) : [],
  };
}
