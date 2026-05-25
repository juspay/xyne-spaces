import type { ControlFlowStepType } from './known-types';

export type StepType = ControlFlowStepType | (string & {});
