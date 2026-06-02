import { z } from 'zod';
import type { TriggerType } from '../types/trigger-types';
import { TriggerCategory } from '../types/categories';

export abstract class BaseTrigger<TConfig extends z.ZodSchema> {
  abstract readonly type: TriggerType;
  abstract readonly configSchema: TConfig;
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly outputSchema: z.ZodSchema;
  abstract readonly category: TriggerCategory;
  readonly icon?: string;
  readonly requiresScopeFilter?: boolean;
  readonly scopeFilterFields?: readonly string[];

  validate(config: unknown): z.infer<TConfig> {
    return this.configSchema.parse(config);
  }

  hydratePayload?(payload: Record<string, unknown>): Promise<Record<string, unknown>>;

  matchFilters(filter: Record<string, unknown>, payload: Record<string, unknown>): boolean {
    void filter;
    void payload;
    return true;
  }

  decorateConfigSchema(jsonSchema: Record<string, unknown>): Record<string, unknown> {
    return jsonSchema;
  }
}
