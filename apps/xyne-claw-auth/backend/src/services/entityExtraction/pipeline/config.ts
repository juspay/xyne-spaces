/**
 * Every threshold in one place. Defaults are deliberately conservative:
 * precision over recall throughout, because an unresolved mention degrades to
 * lexical search while a wrong link is silent.
 */

export interface BootstrapConfig {
  fetchMessages: {
    /** Messages shorter than this after cleaning are dropped. */
    minTextLength: number
    /** Weight applied to the channel name/description document. */
    channelMetaWeight: number
    messageWeight: number
    /** A thread longer than this splits into multiple documents at message boundaries. */
    maxThreadChars: number
  }

  typegen: {
    /** Label clusters below this share of total labels are treated as tail noise. */
    minLabelShare: number
    /**
     * Lexical similarity at which two free-form type labels merge. Deliberately
     * conservative: this grouping is a convenience for the reviewer, and type
     * synonyms that share no characters ("gateway" / "processor") will not be
     * caught here. Gate 1 is where the real merging happens.
     */
    labelMergeThreshold: number
    /** Upper bound on candidate types surfaced for curation. */
    maxCandidates: number
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
    /** Spans longer than this are almost always sentences, not entities. */
    maxSpanLength: number
  }

}

export const DEFAULT_CONFIG: BootstrapConfig = {
  fetchMessages: {
    minTextLength: 12,
    channelMetaWeight: 5,
    messageWeight: 1,
    maxThreadChars: 12_000,
  },
  typegen: {
    minLabelShare: 0.005,
    labelMergeThreshold: 0.62,
    maxCandidates: 40,
  },
  extract: {
    batchSize: 8,
    maxBatchChars: 24_000,
    maxDocChars: 12_000,
    concurrency: 4,
    maxSpanLength: 64,
  },
}

export function mergeConfig(
  overrides: DeepPartial<BootstrapConfig> = {},
): BootstrapConfig {
  return {
    fetchMessages: { ...DEFAULT_CONFIG.fetchMessages, ...overrides.fetchMessages },
    typegen: { ...DEFAULT_CONFIG.typegen, ...overrides.typegen },
    extract: { ...DEFAULT_CONFIG.extract, ...overrides.extract },
  }
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K]
}

