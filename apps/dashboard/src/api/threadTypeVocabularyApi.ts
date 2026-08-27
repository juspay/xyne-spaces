import type { ThreadTypeEntry } from '@xyne/shared';
import { apiInstance } from '../services/clients/apiClient';

export type VocabularyStatus = 'APPROVED' | 'UNDER_REVIEW' | 'REJECTED';

export interface VocabularyEntry extends ThreadTypeEntry {
  /** Only APPROVED entries are offered in the picker or given to the classifier. */
  status?: VocabularyStatus;
  /** Who proposed it. Null for entries resolved from the built-in list. */
  createdBy?: string | null;
  /** Threads carrying it across the whole workspace. Only present with counts. */
  threadCount?: number;
  /** When it was proposed, epoch ms. Null for built-ins, which nobody proposed. */
  proposedAt?: number | null;
  /** Newest thread carrying it, epoch ms. Null when unused. */
  lastUsedAt?: number | null;
}

/** One filter option, labelled by the server so the client needs no user lookup. */
export interface VocabularyFacet {
  value: string;
  label: string;
  /** Only present for proposers. What the "Proposed by" search matches on. */
  email?: string;
  count: number;
}

export interface VocabularyPage {
  entries: VocabularyEntry[];
  /** Rows matching the filters, ignoring the page window. */
  total: number;
  facets: {
    proposedBy: VocabularyFacet[];
    status: VocabularyFacet[];
  };
}

/**
 * The workspace's thread-type vocabulary — what the picker offers and how a chip is
 * labelled and coloured. Editable at runtime by admins, so it is fetched rather than
 * bundled.
 */
export const threadTypeVocabularyApi = {
  /**
   * The approved vocabulary. Bounded, so it is safe to hold for a session.
   *
   * Candidates are NOT fetched here. There is no limit on how many free-form tags a
   * workspace accumulates, and pulling all of them into every client to resolve a handful of
   * chips does not scale — `include=all` exists for the admin review queue, which can
   * paginate.
   */
  get: async (): Promise<VocabularyEntry[]> => {
    const res = await apiInstance.get<{ entries: VocabularyEntry[] }>('/thread-type-vocabulary');
    return res.data.entries ?? [];
  },

  /**
   * The review queue. Always paged — candidates are unbounded, so the full set is not
   * something a browser should ever hold. Filters and option counts are the server's job for
   * the same reason: one page cannot be counted to produce totals for the whole set.
   *
   * `counts` costs two extra Vespa round trips, so it is opt-in and only the review screen
   * asks for it — the picker has no use for thread counts.
   */
  review: async (params: {
    statuses: VocabularyStatus[];
    proposedBy?: string[];
    limit: number;
    offset: number;
    withCounts?: boolean;
  }): Promise<VocabularyPage> => {
    const res = await apiInstance.get<VocabularyPage>('/thread-type-vocabulary/review', {
      params: {
        status: params.statuses.join(','),
        // '' means the built-ins, and an empty string survives neither a query string nor the
        // comma split on the other end.
        ...(params.proposedBy?.length
          ? { proposedBy: params.proposedBy.map(value => value || 'BUILT_IN').join(',') }
          : {}),
        limit: params.limit,
        offset: params.offset,
        ...(params.withCounts === false ? {} : { counts: 'true' }),
      },
    });
    return {
      entries: res.data.entries ?? [],
      total: res.data.total ?? 0,
      facets: res.data.facets ?? { proposedBy: [], status: [] },
    };
  },

  /**
   * Copy the starting vocabulary into this workspace. Admin-only, idempotent — returns how
   * many names it actually added.
   */
  seed: async (): Promise<number> => {
    const res = await apiInstance.post<{ added: number }>('/thread-type-vocabulary/seed');
    return res.data.added ?? 0;
  },

  /** Turn down proposals, workspace-wide for each name. Admin-only. */
  reject: async (names: string[]): Promise<number> => {
    const res = await apiInstance.post<{ decided: number }>('/thread-type-vocabulary/reject', {
      names,
    });
    return res.data.decided ?? 0;
  },

  /** Put turned-down names back in the queue. Admin-only. */
  reconsider: async (names: string[]): Promise<number> => {
    const res = await apiInstance.post<{ decided: number }>('/thread-type-vocabulary/reconsider', {
      names,
    });
    return res.data.decided ?? 0;
  },

  /** Names the caller proposed that are still undecided — drives the author's pending chip. */
  mine: async (): Promise<string[]> => {
    const res = await apiInstance.get<{ names: string[] }>('/thread-type-vocabulary/mine');
    return res.data.names ?? [];
  },

  /**
   * Add or drop individual entries. Approving a proposal is an `add` of the promoted entry —
   * there is no approve verb, because approval IS authoring the four fields the classifier
   * needs, and the server retires everyone's proposal for that name as a side effect.
   */
  patch: async (payload: { add?: ThreadTypeEntry[]; remove?: string[] }): Promise<void> => {
    await apiInstance.patch('/thread-type-vocabulary', payload);
  },

  /** Sends the FULL list; order is meaningful. Admin-only server side. */
  set: async (entries: ThreadTypeEntry[]): Promise<VocabularyEntry[]> => {
    const res = await apiInstance.put<{ entries: VocabularyEntry[] }>('/thread-type-vocabulary', {
      entries,
    });
    return res.data.entries ?? [];
  },
};
