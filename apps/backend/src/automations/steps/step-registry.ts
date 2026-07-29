import { z } from 'zod';
import type { StepType } from '../types/step-types';
import type { StepCategory } from '../types/categories';
import { BaseStep, StepKind } from './base-step';
import { logger } from '@/utils/logger';

export interface StepMetadata {
  type: StepType;
  name: string;
  description: string;
  category: StepCategory;
  kind: StepKind;
  icon?: string;
}

export class UnknownStepError extends Error {
  public readonly stepType: StepType;

  constructor(stepType: StepType) {
    super(`StepRegistry: unknown step type "${stepType}". Is it registered at boot?`);
    this.name = 'UnknownStepError';
    this.stepType = stepType;
  }
}

export class StepRegistry {
  private readonly map = new Map<StepType, BaseStep<z.ZodSchema, Record<string, unknown>>>();

  register(instance: BaseStep<z.ZodSchema, Record<string, unknown>>): void {
    if (this.map.has(instance.type)) {
      logger.warn(`StepRegistry: overwriting existing step for type "${instance.type}"`);
    }
    this.map.set(instance.type, instance);
  }

  get(type: StepType): BaseStep<z.ZodSchema, Record<string, unknown>> {
    const impl = this.map.get(type);
    if (!impl) {
      throw new UnknownStepError(type);
    }
    return impl;
  }

  list(): BaseStep<z.ZodSchema, Record<string, unknown>>[] {
    return Array.from(this.map.values());
  }

  listMetadata(): StepMetadata[] {
    return this.list().map((s) => ({
      type: s.type,
      name: s.name,
      description: s.description,
      category: s.category,
      kind: s.kind,
      ...(s.icon !== undefined ? { icon: s.icon } : {}),
    }));
  }

  has(type: StepType): boolean {
    return this.map.has(type);
  }
}

export const stepRegistry = new StepRegistry();
