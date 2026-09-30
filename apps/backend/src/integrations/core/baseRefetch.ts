import { ExternalSource } from '@prisma/client';

export interface RefetchResult {
  processed: number;
  newTickets: number;
  skipped: number;
  errors: string[];
  /** True when a run budget (page cap / wall-clock) stopped the fetch early — rerun to continue. */
  partial?: boolean;
  /** True error count across the run when `errors` was truncated to its display cap. */
  totalErrors?: number;
}

export interface RefetchOptions {
  startDate?: string;
  endDate?: string;
  targetChannelId?: string;
  dlEmail?: string;
}

/**
 * Base class for manual refetch handlers.
 * Each adapter that supports the /refetch endpoint extends this.
 */
export abstract class BaseRefetch {
  abstract refetch(source: ExternalSource, options?: RefetchOptions): Promise<RefetchResult>;
}
