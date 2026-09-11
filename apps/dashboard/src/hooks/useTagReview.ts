import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ThreadTypeEntry } from '@xyne/shared';
import {
  threadTypeVocabularyApi,
  type VocabularyEntry,
  type VocabularyPage,
  type VocabularyStatus,
} from '../api/threadTypeVocabularyApi';
import { THREAD_TYPE_VOCABULARY_KEY } from './useThreadTypeVocabulary';

export const TAG_REVIEW_KEY = ['tag-review'];
export const MY_PENDING_TAGS_KEY = ['tag-review', 'mine'];

/**
 * The whole vocabulary as a reviewer sees it — proposals, approved entries and turned-down
 * names alike, each with how many threads carry it.
 *
 * One request for everything rather than one per status: the toolbar filters across all three
 * and shows a count beside each option, which needs the full set in hand anyway.
 */
export interface TagReviewFilters {
  proposedBy: string[];
  status: string[];
}

export const useTagReview = (
  filters: TagReviewFilters,
  offset: number,
  limit: number,
): {
  entries: VocabularyEntry[];
  total: number;
  facets: VocabularyPage['facets'];
  isLoading: boolean;
  isFetching: boolean;
  reject: (names: string[]) => void;
  reconsider: (names: string[]) => void;
  save: (entry: ThreadTypeEntry, wasProposal: boolean) => void;
  remove: (name: string) => void;
  seed: () => void;
  isDeciding: boolean;
} => {
  const queryClient = useQueryClient();

  const { data, isLoading, isFetching } = useQuery({
    // The window and the filters are part of the identity of the result — two pages of the
    // same query are different data, not the same data refetched.
    queryKey: [...TAG_REVIEW_KEY, filters, offset, limit],
    queryFn: () =>
      threadTypeVocabularyApi.review({
        statuses: (filters.status.length
          ? filters.status
          : ['UNDER_REVIEW', 'APPROVED', 'REJECTED']) as VocabularyStatus[],
        proposedBy: filters.proposedBy,
        limit,
        offset,
      }),
    // Holding the previous page while the next one loads keeps the table from collapsing to
    // an empty state and back on every click of Next.
    placeholderData: previous => previous,
    // Short: a reviewer works through a queue and expects their own decisions to stick, but
    // someone else deciding in parallel should surface without a reload.
    staleTime: 30_000,
  });

  // A decision changes what the picker and classifier may use, so the vocabulary the rest of
  // the app holds is stale the moment one lands.
  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: TAG_REVIEW_KEY });
    void queryClient.invalidateQueries({ queryKey: THREAD_TYPE_VOCABULARY_KEY });
    void queryClient.invalidateQueries({ queryKey: MY_PENDING_TAGS_KEY });
  };

  const rejectMutation = useMutation({
    mutationFn: (names: string[]) => threadTypeVocabularyApi.reject(names),
    onSuccess: (decided, names) => {
      invalidate();
      // Rows, not names — one name can have several proposers, and all of them are answered.
      toast.success(
        names.length === 1
          ? `Turned down "${names[0]}"${decided > 1 ? ` (${decided} proposals)` : ''}`
          : `Turned down ${names.length} tags`,
      );
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : 'Could not turn that down'),
  });

  const reconsiderMutation = useMutation({
    mutationFn: (names: string[]) => threadTypeVocabularyApi.reconsider(names),
    onSuccess: (_decided, names) => {
      invalidate();
      toast.success(
        names.length === 1 ? `Reopened "${names[0]}"` : `Reopened ${names.length} tags`,
      );
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : 'Could not reopen that'),
  });

  // Approving and editing are the same write: an entry with its four fields, sent as an add.
  // The server upserts on name, and promoting a proposal retires it in the same transaction.
  const saveMutation = useMutation({
    mutationFn: ({ entry }: { entry: ThreadTypeEntry; wasProposal: boolean }) =>
      threadTypeVocabularyApi.patch({ add: [entry] }),
    onSuccess: (_result, { entry, wasProposal }) => {
      invalidate();
      toast.success(wasProposal ? `Approved as ${entry.name}` : `Saved ${entry.label}`);
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : 'Could not save that'),
  });

  const removeMutation = useMutation({
    mutationFn: (name: string) => threadTypeVocabularyApi.patch({ remove: [name] }),
    onSuccess: (_result, name) => {
      invalidate();
      toast.success(`Removed ${name} from the vocabulary`);
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : 'Could not remove that'),
  });

  const seedMutation = useMutation({
    mutationFn: () => threadTypeVocabularyApi.seed(),
    onSuccess: added => {
      invalidate();
      toast.success(
        added === 0 ? 'Every starting type is already here' : `Added ${added} starting types`,
      );
    },
    onError: (error: unknown) =>
      toast.error(error instanceof Error ? error.message : 'Could not add the starting types'),
  });

  return {
    entries: data?.entries ?? [],
    total: data?.total ?? 0,
    facets: data?.facets ?? { proposedBy: [], status: [] },
    isLoading,
    isFetching,
    reject: names => rejectMutation.mutate(names),
    reconsider: names => reconsiderMutation.mutate(names),
    save: (entry, wasProposal) => saveMutation.mutate({ entry, wasProposal }),
    remove: name => removeMutation.mutate(name),
    seed: () => seedMutation.mutate(),
    isDeciding:
      rejectMutation.isPending ||
      reconsiderMutation.isPending ||
      saveMutation.isPending ||
      removeMutation.isPending ||
      seedMutation.isPending,
  };
};

/**
 * Names the current user proposed that are still undecided.
 *
 * Drives the dashed "under review" chip on the author's own threads. Deliberately their list
 * and no one else's: a pending flag on the applied tag would go stale the moment an admin
 * decided it, and fetching every candidate in the workspace into every client does not scale.
 */
export const useMyPendingTags = (enabled: boolean): ((name: string) => boolean) => {
  const { data } = useQuery({
    queryKey: MY_PENDING_TAGS_KEY,
    enabled,
    queryFn: () => threadTypeVocabularyApi.mine(),
    staleTime: 5 * 60 * 1000,
  });

  const pending = useMemo(() => new Set(data ?? []), [data]);
  return (name: string) => pending.has(name);
};
