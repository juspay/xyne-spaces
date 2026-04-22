import { ExternalSource } from '@prisma/client';

export interface RefetchResult {
  processed: number;
  skipped: number;
  errors: string[];
}

/**
 * Base class for manual refetch handlers.
 * Each adapter that supports the /refetch endpoint extends this.
 */
export abstract class BaseRefetch {
  abstract refetch(source: ExternalSource): Promise<RefetchResult>;
}
