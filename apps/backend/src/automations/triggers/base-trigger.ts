import { z } from 'zod';
import type { TriggerType } from '../types/trigger-types';
import { TriggerCategory } from '../types/categories';

/** Filter verdict; `failed` names the filter that rejected, for the skip log. */
export interface FilterMatchResult {
  matched: boolean;
  failed?: string;
}

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

  /**
   * Shape the payload for one candidate automation before it is persisted.
   * Return null to drop the event for that automation before any execution row
   * is created — the trigger owns that decision, the router stays generic.
   */
  projectPayload?(
    config: Record<string, unknown>,
    payload: Record<string, unknown>,
  ): Record<string, unknown> | null;

  matchFilters(filter: Record<string, unknown>, payload: Record<string, unknown>): boolean {
    void filter;
    void payload;
    return true;
  }

  /**
   * The same verdict as matchFilters, plus the name of the filter that rejected.
   * A trigger that does not override this reports no reason, and the skip log
   * says `unspecified` rather than guessing.
   */
  matchFiltersDetailed(
    filter: Record<string, unknown>,
    payload: Record<string, unknown>,
  ): FilterMatchResult {
    return { matched: this.matchFilters(filter, payload) };
  }

  decorateConfigSchema(jsonSchema: Record<string, unknown>): Record<string, unknown> {
    return jsonSchema;
  }
}
