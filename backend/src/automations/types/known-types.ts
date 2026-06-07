import { z } from 'zod';

export enum KnownTriggerType {}

export const KnownTriggerTypeSchema = z.nativeEnum(KnownTriggerType);

export enum ControlFlowStepType {
  CONDITIONAL = 'CONDITIONAL',
  SWITCH = 'SWITCH',
}

export const ControlFlowStepTypeSchema = z.nativeEnum(ControlFlowStepType);

export const CONTROL_FLOW_STEP_TYPES: ReadonlySet<string> = new Set(
  Object.values(ControlFlowStepType),
);
