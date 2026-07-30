/** Every threshold for fetching + extraction in one place. */

export interface BootstrapConfig {
  fetchMessages: {
    /** Messages shorter than this after cleaning are dropped. */
    minTextLength: number
    /** A thread longer than this splits into multiple documents at message boundaries. */
    maxThreadChars: number
  }

  extract: {
    /** Upper bound on documents per LLM call. */
    batchSize: number
    /**
     * Character budget per LLM call, applied before batchSize. With threads,
     * document size varies by orders of magnitude, so a fixed document count
     * produces wildly uneven batches.
     */
    maxBatchChars: number
    /** Per-document truncation inside a batch. */
    maxDocChars: number
    concurrency: number
  }
}

export const DEFAULT_CONFIG: BootstrapConfig = {
  fetchMessages: {
    minTextLength: 12,
    maxThreadChars: 12_000,
  },
  extract: {
    batchSize: 8,
    maxBatchChars: 24_000,
    maxDocChars: 12_000,
    concurrency: 4,
  },
}

export function mergeConfig(
  overrides: DeepPartial<BootstrapConfig> = {},
): BootstrapConfig {
  return {
    fetchMessages: { ...DEFAULT_CONFIG.fetchMessages, ...overrides.fetchMessages },
    extract: { ...DEFAULT_CONFIG.extract, ...overrides.extract },
  }
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K]
}

