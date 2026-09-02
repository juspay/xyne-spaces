import { z } from 'zod';
import type { StepType } from '../types/step-types';
import type { AutomationContext } from '../types/context';
import type { AutomationStepConfig } from '../types/automation-config';
import { StepCategory } from '../types/categories';

export interface ActionExecutionContext {
  runId: string;
  stepName: string;
  isResuming: boolean;
}

export interface ControlFlowExecutionContext {
  walkBranch(steps: AutomationStepConfig[], context: AutomationContext): Promise<void>;
}

export enum StepKind {
  ACTION = 'action',
  CONTROL = 'control',
}

export abstract class BaseStep<
  TConfig extends z.ZodSchema,
  TOutput extends Record<string, unknown> = Record<string, unknown>,
> {
  abstract readonly kind: StepKind;
  abstract readonly type: StepType;
  abstract readonly configSchema: TConfig;
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly outputSchema: z.ZodSchema;
  abstract readonly category: StepCategory;
  readonly icon?: string;

  validate(config: unknown): z.infer<TConfig> {
    return this.configSchema.parse(config);
  }

  redactInput?(input: Record<string, unknown>): Record<string, unknown>;

  declare readonly __outputPhantom?: TOutput;
}

export abstract class BaseActionStep<
  TConfig extends z.ZodSchema,
  TOutput extends Record<string, unknown> = Record<string, unknown>,
> extends BaseStep<TConfig, TOutput> {
  readonly kind: StepKind.ACTION = StepKind.ACTION;

  readonly mayEmit?: readonly string[];

  abstract execute(
    config: z.infer<TConfig>,
    context: AutomationContext,
    execution: ActionExecutionContext,
  ): Promise<TOutput>;

  onResume?(
    rowData: Record<string, unknown>,
    config: z.infer<TConfig>,
    context: AutomationContext,
    execution: ActionExecutionContext,
  ): Promise<TOutput>;
}

export abstract class BaseControlFlowStep<
  TConfig extends z.ZodSchema,
  TOutput extends Record<string, unknown> = Record<string, unknown>,
> extends BaseStep<TConfig, TOutput> {
  readonly kind: StepKind.CONTROL = StepKind.CONTROL;
  abstract readonly category: StepCategory.CONTROL;

  abstract execute(
    config: z.infer<TConfig>,
    context: AutomationContext,
    ctx: ControlFlowExecutionContext,
  ): Promise<TOutput>;
}
