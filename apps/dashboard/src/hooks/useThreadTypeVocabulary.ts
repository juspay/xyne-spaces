import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { THREAD_TYPES, type ThreadTypeEntry } from '@xyne/shared';
import { threadTypeVocabularyApi, type VocabularyEntry } from '../api/threadTypeVocabularyApi';
import { useShowThreadTags } from './useShowThreadTags';

export const THREAD_TYPE_VOCABULARY_KEY = ['thread-type-vocabulary'];

/**
 * The workspace's thread-type vocabulary — the list the picker offers, and the labels,
 * colours and order every chip renders with.
 *
 * One request per session, shared by every picker and chip: it changes only when an admin
 * edits it, so a long staleTime is right and refetching per thread would be waste.
 *
 * Falls back to the built-ins whenever the fetch has not landed — still loading, request
 * failed, or the endpoint is not there at all. That last case is the one that matters: a
 * dashboard deployed ahead of its backend would 404 and, without this, offer an empty picker
 * for as long as the skew lasts. The built-ins are what the server would have returned for an
 * uncustomised workspace anyway, so degrading to them is degrading to the truth.
 *
 * The cost is a workspace that RENAMED a type sees the built-in label for the few hundred ms
 * before the real vocabulary arrives. A brief wrong label is the cheaper failure.
 */
export const useThreadTypeVocabulary = (): {
  entries: ThreadTypeEntry[];
  entry: (name: string) => ThreadTypeEntry | undefined;
  /** Vocabulary order first, then anything unknown alphabetically. */
  sort: (names: string[]) => string[];
} => {
  const { showThreadTags } = useShowThreadTags();

  const { data } = useQuery({
    queryKey: THREAD_TYPE_VOCABULARY_KEY,
    enabled: showThreadTags,
    // Approved entries only, and deliberately so: candidates are unbounded — anyone can
    // invent a free-form tag — and pulling all of them into every client to resolve the two
    // or three on screen does not scale. A free-form chip renders from its stored name.
    queryFn: () => threadTypeVocabularyApi.get(),
    staleTime: 15 * 60 * 1000,
  });

  const entries = useMemo<VocabularyEntry[]>(() => data ?? [...THREAD_TYPES], [data]);

  const rank = useMemo(() => {
    const order = new Map(entries.map((entry, index) => [entry.name, index]));
    // Free-form tags and entries an admin has removed have no rank, so they trail the
    // vocabulary in alphabetical order rather than jumping around between renders.
    return (name: string): number => order.get(name) ?? entries.length;
  }, [entries]);

  // Undefined for a free-form tag: it has no approved entry, so the chip falls back to its
  // stored name and the tooltip simply omits the definition line.
  const entry = useCallback(
    (name: string) => entries.find(candidate => candidate.name === name),
    [entries],
  );

  const sort = useCallback(
    (names: string[]): string[] =>
      [...names].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)),
    [rank],
  );

  return { entries, entry, sort };
};
