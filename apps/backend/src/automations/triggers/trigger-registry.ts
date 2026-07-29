import { z } from 'zod';
import type { TriggerType } from '../types/trigger-types';
import type { TriggerCategory } from '../types/categories';
import { BaseTrigger } from './base-trigger';
import { logger } from '@/utils/logger';

export interface TriggerMetadata {
  type: TriggerType;
  name: string;
  description: string;
  category: TriggerCategory;
  icon?: string;
}

export class UnknownTriggerError extends Error {
  public readonly triggerType: TriggerType;

  constructor(triggerType: TriggerType) {
    super(`TriggerRegistry: unknown trigger type "${triggerType}". Is it registered at boot?`);
    this.name = 'UnknownTriggerError';
    this.triggerType = triggerType;
  }
}

export class TriggerRegistry {
  private readonly map = new Map<TriggerType, BaseTrigger<z.ZodSchema>>();

  register(instance: BaseTrigger<z.ZodSchema>): void {
    if (this.map.has(instance.type)) {
      logger.warn(`TriggerRegistry: overwriting existing trigger for type "${instance.type}"`);
    }
    this.map.set(instance.type, instance);
  }

  get(type: TriggerType): BaseTrigger<z.ZodSchema> {
    const impl = this.map.get(type);
    if (!impl) {
      throw new UnknownTriggerError(type);
    }
    return impl;
  }

  list(): BaseTrigger<z.ZodSchema>[] {
    return Array.from(this.map.values());
  }

  listMetadata(): TriggerMetadata[] {
    return this.list().map((t) => ({
      type: t.type,
      name: t.name,
      description: t.description,
      category: t.category,
      ...(t.icon !== undefined ? { icon: t.icon } : {}),
    }));
  }

  has(type: TriggerType): boolean {
    return this.map.has(type);
  }
}

export const triggerRegistry = new TriggerRegistry();
